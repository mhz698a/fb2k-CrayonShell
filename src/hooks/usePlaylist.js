import { useCallback, useEffect, useRef, useState } from 'react';
import {
    hasBridge,
    isDemoMode,
    invoke,
    subscribe
} from '../services/foobarApi.js';
import { PLAYLIST_FORMATS } from '../services/playlistFormats.js';
import { resolvePlayingTrackIndex } from '../utils/trackIdentity.js';
import {
    findUnmatchedPlaylistRows,
    reconcilePlaylistItems,
    resolveInitialSelectionIndex
} from '../utils/playlistReconciliation.js';
import {
    prepareDspPresetForTrack,
    cancelPreparedDspPresetTrack
} from '../features/dspAutoPreset/dspAutoActivationController.js';
import {
    buildPlaylistSession,
    readPlaylistSession,
    resolveSavedFocusIndex,
    writePlaylistSession
} from '../services/playlistSession.js';

const PAGE_SIZE = 200;
const CONTENT_SYNC_DELAY = 100;
const PLAYBACK_SYNC_DELAY = 80;

const CONTENT_EVENTS = [
    'playlist:itemsAdded',
    'playlist:itemsRemoved',
    'playlist:itemsReordered',
    'playlist:itemsReplaced'
];

const PLAYBACK_EVENTS = [
    'playback:trackChanged',
    'playback:edited',
    'playback:paused',
    'playback:stopped',
    'playback:stateChanged',
    'playback:dynamicInfoTrack'
];

function normalizePlaylistTrack(track) {
    const formats = track.formats || {};
    return {
        index: Number(track.index),
        handle: track.handle ? String(track.handle) : '',
        path: track.path ? String(track.path) : '',
        absolutePath: track.absolutePath ? String(track.absolutePath) : '',
        subsong: track.subsong === null || track.subsong === undefined
            ? null
            : Number(track.subsong),
        duration: formats.duration ? String(formats.duration) : '',
        title: formats.title ? String(formats.title) : '',
        artist: formats.artist ? String(formats.artist) : '',
        details: formats.details ? String(formats.details) : ''
    };
}

function normalizeIndex(value) {
    const index = Number(value);
    return Number.isInteger(index) && index >= 0 ? index : -1;
}

function mapPlaylistList(playlists, activeGuid) {
    return playlists.map((playlist) => ({
        ...playlist,
        isActive: playlist.guid === activeGuid
    }));
}

export function usePlaylist() {
    const [playlists, setPlaylists] = useState([]);
    const [activePlaylistGuid, setActivePlaylistGuid] = useState('');
    const [items, setItems] = useState([]);
    const [focusedItem, setFocusedItem] = useState(-1);
    const [playingItemIndex, setPlayingItemIndex] = useState(-1);
    const [playbackState, setPlaybackState] = useState('stopped');
    const [status, setStatus] = useState('Esperando WebView2…');
    const [scrollRequest, setScrollRequest] = useState({ version: 0, target: 'playing' });
    const [sessionReady, setSessionReady] = useState(false);

    const mountedRef = useRef(false);
    const itemsRef = useRef(items);
    const focusedItemRef = useRef(focusedItem);
    const playingItemIndexRef = useRef(playingItemIndex);
    const activePlaylistGuidRef = useRef(activePlaylistGuid);
    itemsRef.current = items;
    focusedItemRef.current = focusedItem;
    playingItemIndexRef.current = playingItemIndex;
    activePlaylistGuidRef.current = activePlaylistGuid;

    const initializationStartedRef = useRef(false);
    const initializationCompletedRef = useRef(false);
    const initializationInProgressRef = useRef(false);
    const initializationGenerationRef = useRef(0);
    const lifecycleGenerationRef = useRef(0);
    const pendingActivatedGuidRef = useRef('');
    const pendingContentSyncRef = useRef(false);
    const activationRequestRef = useRef(0);
    const activationTargetGuidRef = useRef('');
    const focusRevisionRef = useRef(0);

    const fullRefreshControlRef = useRef({
        running: false,
        queued: false,
        pendingInitial: false,
        waiters: []
    });
    const contentSyncControlRef = useRef({ running: false, queued: false });
    const contentSyncTimerRef = useRef(null);
    const playbackSyncTimerRef = useRef(null);
    const playlistListTimerRef = useRef(null);
    const pendingPlaybackScrollRef = useRef(false);
    const scrollRequestVersionRef = useRef(0);
    const selectionQueueRef = useRef(Promise.resolve());
    const sessionSnapshotRef = useRef(null);

    const setStatusMessage = useCallback((message, error) => {
        const detail = error ? (error.message || String(error)) : '';
        setStatus(detail ? message + ' · ' + detail : message);
    }, []);

    const commitItems = useCallback((nextItems) => {
        itemsRef.current = nextItems;
        setItems(nextItems);
    }, []);

    const commitFocusedItem = useCallback((index) => {
        const nextIndex = Number.isInteger(index) && index >= 0 ? index : -1;
        focusRevisionRef.current += 1;
        focusedItemRef.current = nextIndex;
        setFocusedItem(nextIndex);
    }, []);

    const commitPlayingItem = useCallback((index) => {
        const nextIndex = Number.isInteger(index) && index >= 0 ? index : -1;
        playingItemIndexRef.current = nextIndex;
        setPlayingItemIndex(nextIndex);
    }, []);

    const requestScroll = useCallback((target) => {
        scrollRequestVersionRef.current += 1;
        setScrollRequest({
            version: scrollRequestVersionRef.current,
            target
        });
    }, []);

    const readPlaylistItems = useCallback(async (playlist) => {
        const nextItems = [];
        let start = 0;
        let total = Number(playlist.trackCount) || 0;

        while (start < total) {
            const page = await invoke('playlist.getTracks', {
                playlistGuid: playlist.guid,
                start,
                count: PAGE_SIZE,
                formats: PLAYLIST_FORMATS
            });

            if (Number.isFinite(Number(page.total))) {
                total = Number(page.total);
            }

            const tracks = Array.isArray(page.tracks) ? page.tracks : [];
            tracks.forEach((track) => nextItems.push(normalizePlaylistTrack(track)));

            if (tracks.length === 0) break;
            start += tracks.length;
        }

        return nextItems;
    }, []);

    const readPlaylistIdentityRows = useCallback(async (playlistGuid) => {
        const identityRows = [];
        let start = 0;
        let total = 0;
        let expectedVersion = '';

        do {
            const page = await invoke('playlist.getTracks', {
                playlistGuid,
                start,
                count: PAGE_SIZE,
                fields: ['handle']
            });

            if (page.playlistGuid && page.playlistGuid !== playlistGuid) {
                throw new Error('La playlist cambió mientras se sincronizaban sus pistas.');
            }

            const pageVersion = page.contentVersion ? String(page.contentVersion) : '';
            if (expectedVersion && pageVersion && expectedVersion !== pageVersion) {
                const error = new Error('La playlist cambió durante la lectura incremental.');
                error.code = 'STALE_SNAPSHOT';
                throw error;
            }
            if (!expectedVersion && pageVersion) expectedVersion = pageVersion;

            total = Math.max(0, Number(page.total) || 0);
            const tracks = Array.isArray(page.tracks) ? page.tracks : [];
            identityRows.push(...tracks.map((track) => ({
                index: Number(track.index),
                handle: track.handle ? String(track.handle) : ''
            })));

            if (tracks.length === 0) {
                if (start < total) {
                    const error = new Error('La playlist cambió mientras se leían sus identificadores.');
                    error.code = 'STALE_SNAPSHOT';
                    throw error;
                }
                break;
            }

            start += tracks.length;
        } while (start < total);

        if (identityRows.length !== total) {
            const error = new Error('La lista de identificadores quedó incompleta durante la sincronización.');
            error.code = 'STALE_SNAPSHOT';
            throw error;
        }

        return identityRows;
    }, []);

    const readPlaylistRowsAt = useCallback(async (playlistGuid, rows) => {
        const hydratedItems = [];

        for (let start = 0; start < rows.length; start += PAGE_SIZE) {
            const batch = rows.slice(start, start + PAGE_SIZE);
            const page = await invoke('playlist.getTracksAt', {
                playlistGuid,
                rows: batch.map((row) => Number(row.index)),
                formats: PLAYLIST_FORMATS
            });

            const tracks = Array.isArray(page.tracks) ? page.tracks : [];
            tracks.forEach((track) => hydratedItems.push(normalizePlaylistTrack(track)));
        }

        return hydratedItems;
    }, []);

    const refreshPlaybackSnapshot = useCallback(async ({ scrollToPlaying = false } = {}) => {
        const playlistGuid = activePlaylistGuidRef.current;
        if (!playlistGuid || !hasBridge()) return;

        try {
            const [playingTrack, playback, currentTrackResponse] = await Promise.all([
                invoke('playback.getCurrentTrackIndex'),
                invoke('playback.getState'),
                invoke('playback.getCurrentTrack').catch(() => null)
            ]);

            if (!mountedRef.current || activePlaylistGuidRef.current !== playlistGuid) return;

            const nextPlayingIndex = resolvePlayingTrackIndex({
                items: itemsRef.current,
                playingTrackIndex: playingTrack,
                currentTrackResponse,
                activePlaylistGuid: playlistGuid,
                playbackState: playback.state || 'stopped'
            });

            commitPlayingItem(nextPlayingIndex);
            setPlaybackState(playback.state || 'stopped');

            if (scrollToPlaying && nextPlayingIndex >= 0) {
                requestScroll('playing');
            }
        } catch (error) {
            setStatusMessage('No se pudo actualizar el estado de reproducción', error);
        }
    }, [commitPlayingItem, requestScroll, setStatusMessage]);

    const schedulePlaybackSync = useCallback((scrollToPlaying = false) => {
        pendingPlaybackScrollRef.current = pendingPlaybackScrollRef.current || scrollToPlaying;
        window.clearTimeout(playbackSyncTimerRef.current);
        playbackSyncTimerRef.current = window.setTimeout(async () => {
            playbackSyncTimerRef.current = null;
            const shouldScroll = pendingPlaybackScrollRef.current;
            pendingPlaybackScrollRef.current = false;
            await refreshPlaybackSnapshot({ scrollToPlaying: shouldScroll });
        }, PLAYBACK_SYNC_DELAY);
    }, [refreshPlaybackSnapshot]);

    const refreshPlaylistOnce = useCallback(async ({ initial = false, generation = 0 } = {}) => {
        const result = await invoke('playlist.getAll');
        const nextPlaylists = Array.isArray(result.playlists) ? result.playlists : [];

        if (!mountedRef.current || (initial && generation !== initializationGenerationRef.current)) return;

        const savedSession = initial
            ? readPlaylistSession()
            : buildPlaylistSession(
                activePlaylistGuidRef.current,
                focusedItemRef.current,
                itemsRef.current
            );

        let active = nextPlaylists.find((playlist) => playlist.isActive);
        const savedPlaylist = savedSession
            ? nextPlaylists.find((playlist) => playlist.guid === savedSession.playlistGuid)
            : null;

        if (initial && savedPlaylist && active?.guid !== savedPlaylist.guid) {
            try {
                await invoke('playlist.setActive', { playlistGuid: savedPlaylist.guid });
                active = savedPlaylist;
            } catch (error) {
                setStatusMessage('No se pudo restaurar la playlist anterior', error);
            }
        } else if (initial && savedPlaylist) {
            active = savedPlaylist;
        }

        if (!mountedRef.current || (initial && generation !== initializationGenerationRef.current)) return;

        if (!active) {
            activePlaylistGuidRef.current = '';
            setPlaylists(nextPlaylists);
            setActivePlaylistGuid('');
            commitItems([]);
            commitFocusedItem(-1);
            commitPlayingItem(-1);
            setPlaybackState('stopped');
            setSessionReady(true);
            setStatusMessage('No hay playlist activa');
            return;
        }

        activePlaylistGuidRef.current = active.guid;
        setPlaylists(mapPlaylistList(nextPlaylists, active.guid));

        const [nextItems, focus, playingTrack, playback, currentTrackResponse] = await Promise.all([
            readPlaylistItems(active),
            invoke('playlist.getFocusedTrack', { playlistGuid: active.guid }),
            invoke('playback.getCurrentTrackIndex'),
            invoke('playback.getState'),
            invoke('playback.getCurrentTrack').catch(() => null)
        ]);

        if (!mountedRef.current || (initial && generation !== initializationGenerationRef.current)) return;

        const nextPlayingIndex = resolvePlayingTrackIndex({
            items: nextItems,
            playingTrackIndex: playingTrack,
            currentTrackResponse,
            activePlaylistGuid: active.guid,
            playbackState: playback.state || 'stopped'
        });

        const savedFocusIndex = savedSession?.playlistGuid === active.guid
            ? resolveSavedFocusIndex(savedSession, active.guid, nextItems)
            : -1;
        const nativeFocusIndex = normalizeIndex(focus.index);
        const restoredIndex = initial
            ? resolveInitialSelectionIndex({
                playingIndex: nextPlayingIndex,
                savedFocusIndex,
                focusedIndex: nativeFocusIndex,
                itemCount: nextItems.length
            })
            : resolveInitialSelectionIndex({
                playingIndex: -1,
                savedFocusIndex,
                focusedIndex: nativeFocusIndex,
                itemCount: nextItems.length
            });

        let nextFocusedIndex = restoredIndex;
        if (initial && restoredIndex >= 0) {
            try {
                await invoke('playlist.setSelection', {
                    playlistGuid: active.guid,
                    indices: [restoredIndex],
                    clearOthers: true
                });
                await invoke('playlist.setFocusedTrack', {
                    playlistGuid: active.guid,
                    index: restoredIndex
                });
            } catch (error) {
                setStatusMessage('No se pudo restaurar la selección de la playlist', error);
            }
        }

        if (!mountedRef.current || (initial && generation !== initializationGenerationRef.current)) return;

        commitItems(nextItems);
        commitFocusedItem(nextFocusedIndex);
        commitPlayingItem(nextPlayingIndex);
        setActivePlaylistGuid(active.guid);
        setPlaybackState(playback.state || 'stopped');
        setSessionReady(true);
        setStatusMessage('Playlist: ' + active.name);
    }, [
        commitFocusedItem,
        commitItems,
        commitPlayingItem,
        readPlaylistItems,
        setStatusMessage
    ]);

    const refreshPlaylist = useCallback(async ({ initial = false, generation = 0 } = {}) => {
        if (!hasBridge()) {
            setStatusMessage('Abre la versión de desarrollo o carga CrayonShell desde foobar2000.');
            return;
        }

        const control = fullRefreshControlRef.current;
        if (control.running) {
            control.queued = true;
            control.pendingInitial = control.pendingInitial || initial;
            return new Promise((resolve) => control.waiters.push(resolve));
        }

        control.running = true;
        let runInitial = initial;
        let runGeneration = generation;

        try {
            do {
                control.queued = false;
                await refreshPlaylistOnce({
                    initial: runInitial,
                    generation: runGeneration
                });
                runInitial = control.pendingInitial;
                control.pendingInitial = false;
                runGeneration = initializationGenerationRef.current;
            } while (control.queued && mountedRef.current);
        } catch (error) {
            setStatusMessage('No se pudo leer la playlist', error);
        } finally {
            control.running = false;
            const waiters = control.waiters.splice(0);
            waiters.forEach((resolve) => resolve());
        }
    }, [refreshPlaylistOnce, setStatusMessage]);

    const loadActivatedPlaylist = useCallback(async (playlistGuid) => {
        if (!playlistGuid || !hasBridge()) return;
        if (initializationInProgressRef.current) {
            pendingActivatedGuidRef.current = playlistGuid;
            return;
        }
        if (
            playlistGuid === activePlaylistGuidRef.current
            || activationTargetGuidRef.current === playlistGuid
        ) return;

        activationTargetGuidRef.current = playlistGuid;
        const requestId = ++activationRequestRef.current;

        try {
            const result = await invoke('playlist.getAll');
            const nextPlaylists = Array.isArray(result.playlists) ? result.playlists : [];
            const active = nextPlaylists.find((playlist) => playlist.guid === playlistGuid);

            if (!active) {
                setPlaylists(nextPlaylists);
                return;
            }

            const [nextItems, focus, playingTrack, playback, currentTrackResponse] = await Promise.all([
                readPlaylistItems(active),
                invoke('playlist.getFocusedTrack', { playlistGuid }),
                invoke('playback.getCurrentTrackIndex'),
                invoke('playback.getState'),
                invoke('playback.getCurrentTrack').catch(() => null)
            ]);

            if (
                !mountedRef.current
                || requestId !== activationRequestRef.current
                || activationTargetGuidRef.current !== playlistGuid
            ) return;

            const nextPlayingIndex = resolvePlayingTrackIndex({
                items: nextItems,
                playingTrackIndex: playingTrack,
                currentTrackResponse,
                activePlaylistGuid: playlistGuid,
                playbackState: playback.state || 'stopped'
            });

            let nextFocusedIndex = normalizeIndex(focus.index);
            let selectionError = null;
            activePlaylistGuidRef.current = playlistGuid;
            commitItems(nextItems);

            if (nextPlayingIndex >= 0) {
                try {
                    await invoke('playlist.setSelection', {
                        playlistGuid,
                        indices: [nextPlayingIndex],
                        clearOthers: true
                    });
                    nextFocusedIndex = nextPlayingIndex;
                    await invoke('playlist.setFocusedTrack', {
                        playlistGuid,
                        index: nextPlayingIndex
                    });
                } catch (error) {
                    selectionError = error;
                }
            }

            if (
                !mountedRef.current
                || requestId !== activationRequestRef.current
                || activationTargetGuidRef.current !== playlistGuid
            ) return;

            setPlaylists(mapPlaylistList(nextPlaylists, playlistGuid));
            setActivePlaylistGuid(playlistGuid);
            commitFocusedItem(nextFocusedIndex);
            commitPlayingItem(nextPlayingIndex);
            setPlaybackState(playback.state || 'stopped');
            setSessionReady(true);
            setStatusMessage(
                selectionError
                    ? 'No se pudo seleccionar la pista en reproducción'
                    : 'Playlist: ' + active.name,
                selectionError
            );

            if (nextPlayingIndex >= 0) requestScroll('playing');
        } catch (error) {
            setStatusMessage('No se pudo activar la playlist', error);
        } finally {
            if (activationTargetGuidRef.current === playlistGuid) {
                activationTargetGuidRef.current = '';
            }
        }
    }, [
        commitFocusedItem,
        commitItems,
        commitPlayingItem,
        readPlaylistItems,
        requestScroll,
        setStatusMessage
    ]);

    const reconcileActivePlaylistOnce = useCallback(async () => {
        const playlistGuid = activePlaylistGuidRef.current;
        if (!playlistGuid || !hasBridge()) return;

        const currentItems = itemsRef.current;
        let identityRows = null;
        let hydratedItems = [];

        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                identityRows = await readPlaylistIdentityRows(playlistGuid);
                const rowsToHydrate = findUnmatchedPlaylistRows(currentItems, identityRows);
                hydratedItems = rowsToHydrate.length
                    ? await readPlaylistRowsAt(playlistGuid, rowsToHydrate)
                    : [];
                break;
            } catch (error) {
                if (error.code !== 'STALE_SNAPSHOT' || attempt > 0) throw error;
            }
        }

        const nextItems = reconcilePlaylistItems({
            currentItems,
            identityRows: identityRows || [],
            hydratedItems
        });

        if (!mountedRef.current || activePlaylistGuidRef.current !== playlistGuid) return;

        if (nextItems !== currentItems) commitItems(nextItems);
        setPlaylists((previous) => previous.map((playlist) => (
            playlist.guid === playlistGuid
                ? { ...playlist, trackCount: nextItems.length }
                : playlist
        )));

        const focusRevision = focusRevisionRef.current;
        const focus = await invoke('playlist.getFocusedTrack', { playlistGuid }).catch(() => null);
        if (
            mountedRef.current
            && activePlaylistGuidRef.current === playlistGuid
            && focusRevision === focusRevisionRef.current
            && focus
        ) {
            commitFocusedItem(normalizeIndex(focus.index));
        }

        await refreshPlaybackSnapshot();
    }, [
        commitFocusedItem,
        commitItems,
        readPlaylistIdentityRows,
        readPlaylistRowsAt,
        refreshPlaybackSnapshot
    ]);

    const reconcileActivePlaylist = useCallback(async () => {
        const control = contentSyncControlRef.current;
        if (control.running) {
            control.queued = true;
            return;
        }

        control.running = true;
        try {
            do {
                control.queued = false;
                await reconcileActivePlaylistOnce();
            } while (control.queued && mountedRef.current);
        } catch (error) {
            setStatusMessage('No se pudo sincronizar el contenido de la playlist', error);
        } finally {
            control.running = false;
        }
    }, [reconcileActivePlaylistOnce, setStatusMessage]);

    const scheduleContentReconciliation = useCallback(() => {
        window.clearTimeout(contentSyncTimerRef.current);
        contentSyncTimerRef.current = window.setTimeout(() => {
            contentSyncTimerRef.current = null;
            if (initializationInProgressRef.current) {
                pendingContentSyncRef.current = true;
                return;
            }
            reconcileActivePlaylist();
        }, CONTENT_SYNC_DELAY);
    }, [reconcileActivePlaylist]);

    const refreshPlaylistList = useCallback(async () => {
        if (!hasBridge() || initializationInProgressRef.current) return;

        try {
            const result = await invoke('playlist.getAll');
            const nextPlaylists = Array.isArray(result.playlists) ? result.playlists : [];
            if (!mountedRef.current) return;

            const currentGuid = activePlaylistGuidRef.current;
            const stillExists = nextPlaylists.some((playlist) => playlist.guid === currentGuid);
            setPlaylists(mapPlaylistList(nextPlaylists, currentGuid));

            if (!stillExists) {
                const nextActive = nextPlaylists.find((playlist) => playlist.isActive);
                if (nextActive) loadActivatedPlaylist(nextActive.guid);
                else {
                    activePlaylistGuidRef.current = '';
                    setActivePlaylistGuid('');
                    commitItems([]);
                    commitFocusedItem(-1);
                    commitPlayingItem(-1);
                    setPlaybackState('stopped');
                }
            }
        } catch (error) {
            setStatusMessage('No se pudo actualizar la lista de playlists', error);
        }
    }, [
        commitFocusedItem,
        commitItems,
        commitPlayingItem,
        loadActivatedPlaylist,
        setStatusMessage
    ]);

    const schedulePlaylistListRefresh = useCallback(() => {
        window.clearTimeout(playlistListTimerRef.current);
        playlistListTimerRef.current = window.setTimeout(() => {
            playlistListTimerRef.current = null;
            refreshPlaylistList();
        }, CONTENT_SYNC_DELAY);
    }, [refreshPlaylistList]);

    const handleContentEvent = useCallback((eventName, payload = {}) => {
        const playlistGuid = String(payload.playlistGuid || '');
        if (!playlistGuid) return;

        setPlaylists((previous) => previous.map((playlist) => {
            if (playlist.guid !== playlistGuid) return playlist;

            if (eventName === 'playlist:itemsAdded') {
                return {
                    ...playlist,
                    trackCount: (Number(playlist.trackCount) || 0) + (Number(payload.count) || 0)
                };
            }
            if (eventName === 'playlist:itemsRemoved' && Number.isFinite(Number(payload.newCount))) {
                return { ...playlist, trackCount: Number(payload.newCount) };
            }
            return playlist;
        }));

        if (playlistGuid !== activePlaylistGuidRef.current) return;
        if (initializationInProgressRef.current) {
            pendingContentSyncRef.current = true;
            return;
        }
        scheduleContentReconciliation();
    }, [scheduleContentReconciliation]);

    const setSelectedItem = useCallback((index) => {
        const requestedPlaylistGuid = activePlaylistGuid;

        const operation = async () => {
            if (!requestedPlaylistGuid) {
                throw new Error('No hay una playlist activa.');
            }

            if (activePlaylistGuidRef.current !== requestedPlaylistGuid) {
                throw new Error('La playlist activa cambió antes de completar la selección.');
            }

            await invoke('playlist.setSelection', {
                playlistGuid: requestedPlaylistGuid,
                indices: [index],
                clearOthers: true
            });
            await invoke('playlist.setFocusedTrack', {
                playlistGuid: requestedPlaylistGuid,
                index
            });

            if (mountedRef.current && activePlaylistGuidRef.current === requestedPlaylistGuid) {
                commitFocusedItem(index);
            }
        };

        const queued = selectionQueueRef.current.then(operation, operation);
        selectionQueueRef.current = queued.catch(() => {});
        return queued;
    }, [activePlaylistGuid, commitFocusedItem]);

    const selectItem = useCallback(async (index) => {
        if (!activePlaylistGuid) return;

        try {
            await setSelectedItem(index);
            setStatusMessage('Seleccionada: ' + (index + 1));
        } catch (error) {
            setStatusMessage('No se pudo seleccionar la pista', error);
        }
    }, [activePlaylistGuid, setSelectedItem, setStatusMessage]);

    const playItem = useCallback(async (index) => {
        if (!activePlaylistGuid) return;

        let preparedDsp = false;
        try {
            await setSelectedItem(index);
            const targetTrack = itemsRef.current.find((item) => item.index === index);
            const targetTrackPath = targetTrack?.absolutePath || targetTrack?.path || '';
            if (!isDemoMode && targetTrackPath) {
                const dspResult = await prepareDspPresetForTrack(targetTrackPath);
                preparedDsp = Boolean(dspResult?.prepared);
                if (dspResult?.success === false && dspResult.error) {
                    setStatusMessage('No se pudo preparar el DSP Preset; se iniciará la canción igualmente', new Error(dspResult.error));
                }
            }

            await invoke('playlist.playTrack', {
                playlistGuid: activePlaylistGuid,
                index
            });

            setStatusMessage('Reproduciendo pista: ' + (index + 1));
            schedulePlaybackSync(true);
        } catch (error) {
            if (preparedDsp) {
                const currentTrack = itemsRef.current.find((item) => item.index === playingItemIndexRef.current);
                await cancelPreparedDspPresetTrack(currentTrack?.path || '');
            }
            setStatusMessage('No se pudo reproducir la pista', error);
        }
    }, [activePlaylistGuid, isDemoMode, schedulePlaybackSync, setSelectedItem, setStatusMessage]);

    const openNativeContextMenu = useCallback(async (index) => {
        if (!activePlaylistGuid) return;

        if (isDemoMode) {
            setStatusMessage('El menú nativo de foobar2000 solo está disponible en el reproductor.');
            return;
        }

        try {
            await setSelectedItem(index);
            await invoke('menu.showNativePopup', { mode: 'selection' });
        } catch (error) {
            setStatusMessage('No se pudo abrir el menú contextual de foobar2000', error);
        }
    }, [activePlaylistGuid, isDemoMode, setSelectedItem, setStatusMessage]);

    const changePlaylist = useCallback(async (playlistGuid) => {
        if (!playlistGuid || playlistGuid === activePlaylistGuidRef.current) return;

        try {
            await invoke('playlist.setActive', { playlistGuid });
            if (
                activePlaylistGuidRef.current !== playlistGuid
                && activationTargetGuidRef.current !== playlistGuid
            ) {
                await loadActivatedPlaylist(playlistGuid);
            }
        } catch (error) {
            setStatusMessage('No se pudo cambiar la playlist', error);
        }
    }, [loadActivatedPlaylist, setStatusMessage]);

    useEffect(() => {
        if (!sessionReady || !activePlaylistGuid) return;

        const snapshot = buildPlaylistSession(activePlaylistGuid, focusedItem, items);
        if (!snapshot) return;

        sessionSnapshotRef.current = snapshot;
        writePlaylistSession(snapshot);
    }, [sessionReady, activePlaylistGuid, focusedItem, items]);

    useEffect(() => {
        const persistSession = () => {
            if (sessionSnapshotRef.current) {
                writePlaylistSession(sessionSnapshotRef.current);
            }
        };

        window.addEventListener('pagehide', persistSession);
        window.addEventListener('beforeunload', persistSession);
        return () => {
            window.removeEventListener('pagehide', persistSession);
            window.removeEventListener('beforeunload', persistSession);
        };
    }, []);

    useEffect(() => {
        if (!hasBridge()) {
            setStatusMessage('No se detectó el puente fb2k. Abre CrayonShell desde foobar2000.');
            return undefined;
        }

        mountedRef.current = true;
        const lifecycle = ++lifecycleGenerationRef.current;
        const unsubscribers = [];

        CONTENT_EVENTS.forEach((eventName) => {
            unsubscribers.push(subscribe(eventName, (payload) => {
                handleContentEvent(eventName, payload);
            }));
        });

        PLAYBACK_EVENTS.forEach((eventName) => {
            unsubscribers.push(subscribe(eventName, () => {
                schedulePlaybackSync(eventName === 'playback:trackChanged');
            }));
        });

        unsubscribers.push(subscribe('playlist:focusChanged', (payload = {}) => {
            if (
                initializationInProgressRef.current
                || payload.playlistGuid !== activePlaylistGuidRef.current
            ) return;
            commitFocusedItem(normalizeIndex(payload.to));
        }));

        unsubscribers.push(subscribe('playlist:activated', (payload = {}) => {
            const playlistGuid = String(payload.playlistGuid || '');
            if (!playlistGuid) return;

            if (initializationInProgressRef.current) {
                pendingActivatedGuidRef.current = playlistGuid;
                return;
            }
            loadActivatedPlaylist(playlistGuid);
        }));

        ['playlist:created', 'playlist:removed', 'playlist:reordered', 'playlist:renamed']
            .forEach((eventName) => {
                unsubscribers.push(subscribe(eventName, () => {
                    schedulePlaylistListRefresh();
                }));
            });

        if (!initializationStartedRef.current) {
            initializationStartedRef.current = true;
            initializationInProgressRef.current = true;
            const generation = ++initializationGenerationRef.current;

            refreshPlaylist({ initial: true, generation }).finally(() => {
                if (
                    !mountedRef.current
                    || lifecycle !== lifecycleGenerationRef.current
                    || generation !== initializationGenerationRef.current
                ) return;

                initializationInProgressRef.current = false;
                initializationCompletedRef.current = true;

                const pendingGuid = pendingActivatedGuidRef.current;
                pendingActivatedGuidRef.current = '';
                if (pendingGuid && pendingGuid !== activePlaylistGuidRef.current) {
                    loadActivatedPlaylist(pendingGuid);
                }

                if (pendingContentSyncRef.current) {
                    pendingContentSyncRef.current = false;
                    scheduleContentReconciliation();
                }

                schedulePlaybackSync(false);
            });
        }

        return () => {
            unsubscribers.forEach((unsubscribe) => unsubscribe());
            mountedRef.current = false;
            lifecycleGenerationRef.current += 1;

            if (!initializationCompletedRef.current) {
                initializationStartedRef.current = false;
                initializationInProgressRef.current = false;
                initializationGenerationRef.current += 1;
            }

            window.clearTimeout(contentSyncTimerRef.current);
            window.clearTimeout(playbackSyncTimerRef.current);
            window.clearTimeout(playlistListTimerRef.current);
        };
    }, [
        commitFocusedItem,
        handleContentEvent,
        loadActivatedPlaylist,
        refreshPlaylist,
        scheduleContentReconciliation,
        schedulePlaybackSync,
        schedulePlaylistListRefresh,
        setStatusMessage
    ]);

    return {
        playlists,
        activePlaylistGuid,
        items,
        focusedItem,
        playingItemIndex,
        playbackState,
        status,
        scrollRequest,
        isDemoMode,
        refreshPlaylist,
        changePlaylist,
        selectItem,
        playItem,
        openNativeContextMenu
    };
}
