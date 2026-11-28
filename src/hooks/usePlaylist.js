import { useCallback, useEffect, useRef, useState } from 'react';
import {
    hasBridge,
    isDemoMode,
    invoke,
    subscribe
} from '../services/foobarApi.js';
import { PLAYLIST_FORMATS } from '../services/playlistFormats.js';
import { resolveCurrentTrackIndex, resolvePlayingTrackIndex } from '../utils/trackIdentity.js';
import {
    findUnmatchedPlaylistRows,
    reconcilePlaylistItems,
    resolveInitialSelectionIndex,
    resolveActivatedPlaylistGuid,
    resolvePlaylistGuidFromEvent,
} from '../utils/playlistReconciliation.js';
import {
    readPlaylistActivationSnapshot,
    applyPlaylistActivationSelection
} from '../features/playlist/playlistActivationController.js';
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
    const [selectedIndices, setSelectedIndices] = useState([]);
    const [playingItemIndex, setPlayingItemIndex] = useState(-1);
    const [playbackState, setPlaybackState] = useState('stopped');
    const [status, setStatus] = useState('Esperando WebView2…');
    const [scrollRequest, setScrollRequest] = useState({ version: 0, target: 'playing' });
    const [sessionReady, setSessionReady] = useState(false);

    const mountedRef = useRef(false);
    const playlistsRef = useRef(playlists);
    const itemsRef = useRef(items);
    const focusedItemRef = useRef(focusedItem);
    const selectedIndicesRef = useRef(selectedIndices);
    const playingItemIndexRef = useRef(playingItemIndex);
    const activePlaylistGuidRef = useRef(activePlaylistGuid);
    playlistsRef.current = playlists;
    itemsRef.current = items;
    focusedItemRef.current = focusedItem;
    selectedIndicesRef.current = selectedIndices;
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
    const activationEventRequestRef = useRef(0);
    const activationTargetGuidRef = useRef('');
    const activationLoadRef = useRef(null);
    const nativeSelectionMutationRef = useRef(new Set());
    const focusRevisionRef = useRef(0);
    const selectionReadRevisionRef = useRef(0);

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

    const commitSelectedIndices = useCallback((indices, sourceItems = itemsRef.current) => {
        const validIndices = new Set(sourceItems.map((item) => Number(item.index)));
        const nextIndices = Array.from(new Set(
            (Array.isArray(indices) ? indices : [])
                .map(Number)
                .filter((index) => Number.isInteger(index) && index >= 0 && validIndices.has(index))
        )).sort((left, right) => left - right);
        selectedIndicesRef.current = nextIndices;
        setSelectedIndices(nextIndices);
        return nextIndices;
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

            if (page.playlistGuid !== playlistGuid || !page.contentVersion) {
                const error = new Error('La playlist dejó de estar disponible durante la sincronización.');
                error.code = 'STALE_SNAPSHOT';
                throw error;
            }

            const pageVersion = String(page.contentVersion);
            if (expectedVersion && expectedVersion !== pageVersion) {
                const error = new Error('La playlist cambió durante la lectura incremental.');
                error.code = 'STALE_SNAPSHOT';
                throw error;
            }
            expectedVersion = pageVersion;

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

        return { rows: identityRows, contentVersion: expectedVersion, total };
    }, []);

    const readPlaylistRowsAt = useCallback(async (playlistGuid, rows, expectedVersion) => {
        const hydratedItems = [];

        for (let start = 0; start < rows.length; start += PAGE_SIZE) {
            const batch = rows.slice(start, start + PAGE_SIZE);
            const page = await invoke('playlist.getTracksAt', {
                playlistGuid,
                rows: batch.map((row) => Number(row.index)),
                formats: PLAYLIST_FORMATS
            });

            if (
                page.playlistGuid !== playlistGuid
                || String(page.contentVersion || '') !== expectedVersion
            ) {
                const error = new Error('La playlist cambió antes de completar la lectura de los elementos nuevos.');
                error.code = 'STALE_SNAPSHOT';
                throw error;
            }

            const tracks = Array.isArray(page.tracks) ? page.tracks : [];
            if (tracks.length !== batch.length) {
                const error = new Error('La lectura de los elementos nuevos quedó incompleta.');
                error.code = 'STALE_SNAPSHOT';
                throw error;
            }

            tracks.forEach((track) => hydratedItems.push(normalizePlaylistTrack(track)));
        }

        return hydratedItems;
    }, []);

    const refreshPlaybackSnapshot = useCallback(async ({ scrollToPlaying = false } = {}) => {
        const playlistGuid = activePlaylistGuidRef.current;
        if (!playlistGuid || !hasBridge()) return;

        try {
            const [playingTrack, playback, currentTrackResponse] = await Promise.all([
                invoke('playback.getCurrentTrackIndex', { includeTrackInfo: true }),
                invoke('playback.getState'),
                invoke('playback.getCurrentTrack').catch(() => null)
            ]);

            if (!mountedRef.current || activePlaylistGuidRef.current !== playlistGuid) return;

            const nextPlayingIndex = resolvePlayingTrackIndex({
                items: itemsRef.current,
                playingTrackIndex: playingTrack,
                currentTrackResponse,
                activePlaylistGuid: playlistGuid,
                playlists: playlistsRef.current,
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
            commitSelectedIndices([]);
            commitPlayingItem(-1);
            setPlaybackState('stopped');
            setSessionReady(true);
            setStatusMessage('No hay playlist activa');
            return;
        }

        activePlaylistGuidRef.current = active.guid;
        setPlaylists(mapPlaylistList(nextPlaylists, active.guid));

        const [nextItems, focus, nativeSelection, playingTrack, playback, currentTrackResponse] = await Promise.all([
            readPlaylistItems(active),
            invoke('playlist.getFocusedTrack', { playlistGuid: active.guid }),
            invoke('playlist.getSelection', { playlistGuid: active.guid }).catch(() => ({ items: [] })),
            invoke('playback.getCurrentTrackIndex', { includeTrackInfo: true }),
            invoke('playback.getState'),
            invoke('playback.getCurrentTrack').catch(() => null)
        ]);

        if (!mountedRef.current || (initial && generation !== initializationGenerationRef.current)) return;

        const nextPlayingIndex = resolvePlayingTrackIndex({
            items: nextItems,
            playingTrackIndex: playingTrack,
            currentTrackResponse,
            activePlaylistGuid: active.guid,
            playlists: nextPlaylists,
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

        const nextFocusedIndex = restoredIndex;

        if (restoredIndex >= 0) {
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
        commitSelectedIndices(restoredIndex >= 0 ? [restoredIndex] : nativeSelection.items, nextItems);
        commitPlayingItem(nextPlayingIndex);
        setActivePlaylistGuid(active.guid);
        setPlaybackState(playback.state || 'stopped');
        setSessionReady(true);
        setStatusMessage('Playlist: ' + active.name);
    }, [
        commitFocusedItem,
        commitItems,
        commitSelectedIndices,
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

    const loadActivatedPlaylist = useCallback((playlistGuid, { force = false, source = 'internal' } = {}) => {
        console.info('[CrayonShell][playlist-activation] load requested', {
            playlistGuid,
            source,
            reactActivePlaylistGuid: activePlaylistGuidRef.current,
            force
        });
        if (!playlistGuid || !hasBridge()) {
            console.info('[CrayonShell][playlist-activation] load skipped: missing GUID or bridge', { playlistGuid, source });
            return Promise.resolve();
        }
        if (initializationInProgressRef.current) {
            pendingActivatedGuidRef.current = playlistGuid;
            return Promise.resolve();
        }

        const inFlight = activationLoadRef.current;
        if (inFlight?.playlistGuid === playlistGuid) {
            console.info('[CrayonShell][playlist-activation] joined in-flight load', { playlistGuid, source });
            return inFlight.promise;
        }
        if (!force && playlistGuid === activePlaylistGuidRef.current) {
            console.info('[CrayonShell][playlist-activation] skipped: React already shows target playlist', { playlistGuid, source });
            return Promise.resolve();
        }

        activationTargetGuidRef.current = playlistGuid;
        const requestId = ++activationRequestRef.current;

        const operation = (async () => {
            try {
                const result = await invoke('playlist.getAll');
                const nextPlaylists = Array.isArray(result.playlists) ? result.playlists : [];
                const targetPlaylist = nextPlaylists.find((playlist) => playlist.guid === playlistGuid);

                if (
                    !mountedRef.current
                    || requestId !== activationRequestRef.current
                    || activationTargetGuidRef.current !== playlistGuid
                ) return;

                if (!targetPlaylist) {
                    console.warn('[CrayonShell][playlist-activation] target playlist missing', {
                        requestedPlaylistGuid: playlistGuid,
                        availableGuids: nextPlaylists.map((playlist) => playlist.guid)
                    });
                    return;
                }

                const nextItems = await readPlaylistItems(targetPlaylist);

                if (
                    !mountedRef.current
                    || requestId !== activationRequestRef.current
                    || activationTargetGuidRef.current !== playlistGuid
                ) return;

                const activation = await readPlaylistActivationSnapshot({
                    invoke,
                    playlistGuid,
                    items: nextItems
                });

                if (
                    !mountedRef.current
                    || requestId !== activationRequestRef.current
                    || activationTargetGuidRef.current !== playlistGuid
                ) return;

                console.info('[CrayonShell][playlist-activation] resolved', {
                    requestedPlaylistGuid: playlistGuid,
                    activePlaylistGuid: activation.activePlaylistGuid,
                    activeMatches: activation.activeMatches,
                    playingPlaylistGuid: activation.playingPlaylistGuid,
                    playingLocationFound: activation.playingLocationFound,
                    locatedTrackIndex: activation.locatedTrackIndex,
                    playbackState: activation.playbackState,
                    nativeFocusIndex: activation.nativeFocusIndex,
                    selectionIndex: activation.selectionIndex,
                    selectionSource: activation.selectionSource,
                    itemCount: nextItems.length
                });

                if (!activation.activeMatches) {
                    console.warn('[CrayonShell][playlist-activation] activation target is not active; native writes skipped', {
                        requestedPlaylistGuid: playlistGuid,
                        activePlaylistGuid: activation.activePlaylistGuid
                    });
                    return;
                }

                const nextPlayingIndex = activation.playingItemIndex;
                const nextFocusedIndex = activation.selectionIndex;
                const mappedPlaylists = mapPlaylistList(nextPlaylists, playlistGuid);
                playlistsRef.current = mappedPlaylists;
                activePlaylistGuidRef.current = playlistGuid;
                commitItems(nextItems);
                setPlaylists(mappedPlaylists);
                setActivePlaylistGuid(playlistGuid);
                commitFocusedItem(nextFocusedIndex);
                commitPlayingItem(nextPlayingIndex);
                setPlaybackState(activation.playbackState);
                setSessionReady(true);

                let verification = null;
                let selectionError = null;
                if (nextFocusedIndex >= 0) {
                    nativeSelectionMutationRef.current.add(playlistGuid);
                    try {
                        verification = await applyPlaylistActivationSelection({
                            invoke,
                            playlistGuid,
                            index: nextFocusedIndex
                        });
                    } catch (error) {
                        selectionError = error;
                    } finally {
                        nativeSelectionMutationRef.current.delete(playlistGuid);
                    }
                }

                if (
                    !mountedRef.current
                    || requestId !== activationRequestRef.current
                    || activationTargetGuidRef.current !== playlistGuid
                ) return;

                if (verification?.applied) {
                    console.info('[CrayonShell][playlist-activation] native verification', {
                        playlistGuid,
                        requestedIndex: nextFocusedIndex,
                        nativeSelection: verification.nativeSelection,
                        nativeFocusIndex: verification.nativeFocusIndex,
                        selectionMatches: verification.selectionMatches,
                        focusMatches: verification.focusMatches
                    });
                } else if (verification?.reason === 'active-playlist-changed') {
                    console.warn('[CrayonShell][playlist-activation] playlist changed before native selection', {
                        playlistGuid,
                        activePlaylistGuid: verification.activePlaylistGuid
                    });
                }

                const currentSelection = verification?.applied
                    ? verification.nativeSelection
                    : (await invoke('playlist.getSelection', { playlistGuid }).catch(() => ({ items: [] }))).items;
                commitSelectedIndices(currentSelection, nextItems);

                if (selectionError) {
                    console.error('[CrayonShell][playlist-activation] native selection failed', selectionError);
                    setStatusMessage('No se pudo restaurar la selección nativa', selectionError);
                } else if (
                    verification?.applied
                    && (!verification.selectionMatches || !verification.focusMatches)
                ) {
                    setStatusMessage('La selección o el foco nativo no coinciden con la pista restaurada.');
                } else {
                    setStatusMessage('Playlist: ' + targetPlaylist.name);
                }

                if (nextPlayingIndex >= 0) requestScroll('playing');
                else if (nextFocusedIndex >= 0) requestScroll('focused');
            } catch (error) {
                setStatusMessage('No se pudo activar la playlist', error);
            } finally {
                if (
                    activationTargetGuidRef.current === playlistGuid
                    && requestId === activationRequestRef.current
                ) {
                    activationTargetGuidRef.current = '';
                }
            }
        })();

        const sharedPromise = operation.finally(() => {
            if (activationLoadRef.current?.requestId === requestId) {
                activationLoadRef.current = null;
            }
        });
        activationLoadRef.current = {
            playlistGuid,
            requestId,
            promise: sharedPromise
        };
        return sharedPromise;
    }, [
        commitFocusedItem,
        commitItems,
        commitSelectedIndices,
        commitPlayingItem,
        readPlaylistItems,
        requestScroll,
        setStatusMessage
    ]);

    const reconcileActivePlaylistOnce = useCallback(async () => {
        const playlistGuid = activePlaylistGuidRef.current;
        if (!playlistGuid || !hasBridge()) return;

        const currentItems = itemsRef.current;
        const selectedHandleCounts = new Map();
        currentItems
            .filter((item) => selectedIndicesRef.current.includes(Number(item.index)))
            .map((item) => item.handle)
            .filter(Boolean)
            .forEach((handle) => {
                selectedHandleCounts.set(handle, (selectedHandleCounts.get(handle) || 0) + 1);
            });
        let identityRows = null;
        let hydratedItems = [];
        let contentVersion = '';

        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const snapshot = await readPlaylistIdentityRows(playlistGuid);
                const rowsToHydrate = findUnmatchedPlaylistRows(currentItems, snapshot.rows);
                const nextHydratedItems = rowsToHydrate.length
                    ? await readPlaylistRowsAt(
                        playlistGuid,
                        rowsToHydrate,
                        snapshot.contentVersion
                    )
                    : [];

                identityRows = snapshot.rows;
                hydratedItems = nextHydratedItems;
                contentVersion = snapshot.contentVersion;
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

        const preservedSelection = nextItems.reduce((indices, item) => {
            const remaining = selectedHandleCounts.get(item.handle) || 0;
            if (remaining > 0) {
                indices.push(item.index);
                selectedHandleCounts.set(item.handle, remaining - 1);
            }
            return indices;
        }, []);
        commitSelectedIndices(preservedSelection, nextItems);

        const focusRevision = focusRevisionRef.current;
        const [focus, nativeSelection, playingTrack, playback, currentTrackResponse] = await Promise.all([
            invoke('playlist.getFocusedTrack', { playlistGuid }).catch(() => null),
            invoke('playlist.getSelection', { playlistGuid }).catch(() => ({ items: [] })),
            invoke('playback.getCurrentTrackIndex', { includeTrackInfo: true })
                .catch(() => ({ found: false })),
            invoke('playback.getState').catch(() => ({ state: 'stopped' })),
            invoke('playback.getCurrentTrack').catch(() => null)
        ]);

        if (!mountedRef.current || activePlaylistGuidRef.current !== playlistGuid) return;

        // Facets/Refacets keep Library Viewer Selection active while replacing
        // its rows. The playback source index can therefore point at a different
        // track after a subfolder change; resolve by native identity, then handle/path.
        const currentTrackIndex = resolveCurrentTrackIndex({
            items: nextItems,
            playingTrackIndex: playingTrack,
            currentTrackResponse,
            activePlaylistGuid: playlistGuid,
            playlists: playlistsRef.current
        });
        const playbackState = playback.state || 'stopped';
        const nextPlayingIndex = playbackState === 'stopped' ? -1 : currentTrackIndex;

        commitPlayingItem(nextPlayingIndex);
        setPlaybackState(playbackState);

        if (currentTrackIndex >= 0) {
            let selectionResult = null;
            console.info('[CrayonShell][facets-selection] current track found in updated playlist content', {
                playlistGuid,
                index: currentTrackIndex,
                contentVersion,
                itemCount: nextItems.length,
                playbackState: playback.state || 'stopped'
            });

            nativeSelectionMutationRef.current.add(playlistGuid);
            try {
                selectionResult = await applyPlaylistActivationSelection({
                    invoke,
                    playlistGuid,
                    index: currentTrackIndex,
                    expectedVersion: contentVersion
                });
            } catch (error) {
                if (error?.code === 'STALE_TARGET') {
                    // A newer Facets result arrived between reading rows and
                    // applying the selection. Reconcile again against its version.
                    contentSyncControlRef.current.queued = true;
                    console.info('[CrayonShell][facets-selection] discarded stale content snapshot', {
                        playlistGuid,
                        expectedVersion: contentVersion,
                        error
                    });
                    return;
                }
                throw error;
            } finally {
                nativeSelectionMutationRef.current.delete(playlistGuid);
            }

            if (!mountedRef.current || activePlaylistGuidRef.current !== playlistGuid) return;

            if (selectionResult?.applied) {
                commitFocusedItem(currentTrackIndex);
                commitSelectedIndices(selectionResult.nativeSelection, nextItems);
                requestScroll(nextPlayingIndex >= 0 ? 'playing' : 'focused');
                console.info('[CrayonShell][facets-selection] restored current track selection', {
                    playlistGuid,
                    requestedIndex: currentTrackIndex,
                    contentVersion,
                    nativeSelection: selectionResult.nativeSelection,
                    nativeFocusIndex: selectionResult.nativeFocusIndex,
                    selectionMatches: selectionResult.selectionMatches,
                    focusMatches: selectionResult.focusMatches
                });
            } else {
                console.info('[CrayonShell][facets-selection] selection restore skipped', {
                    playlistGuid,
                    index: currentTrackIndex,
                    reason: selectionResult?.reason,
                    activePlaylistGuid: selectionResult?.activePlaylistGuid
                });
            }
        } else if (
            focusRevision === focusRevisionRef.current
            && focus
        ) {
            // The playing track is outside the current Facets result. Preserve
            // the viewer's own focus until a later result contains that track.
            commitFocusedItem(normalizeIndex(focus.index));
            commitSelectedIndices(nativeSelection.items, nextItems);
        }
    }, [
        commitFocusedItem,
        commitItems,
        commitSelectedIndices,
        commitPlayingItem,
        readPlaylistIdentityRows,
        readPlaylistRowsAt,
        requestScroll
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
                    commitSelectedIndices([]);
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
        commitSelectedIndices,
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

            try {
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
                    commitSelectedIndices([index]);
                }
            } catch (error) {
                throw error;
            }
        };

        const queued = selectionQueueRef.current.then(operation, operation);
        selectionQueueRef.current = queued.catch(() => {});
        return queued;
    }, [activePlaylistGuid, commitFocusedItem, commitSelectedIndices]);

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

    const focusPlayingTrack = useCallback(async () => {
        const playlistGuid = activePlaylistGuidRef.current;
        if (!playlistGuid || !hasBridge()) return;

        try {
            const [playingTrack, currentTrackResponse] = await Promise.all([
                invoke('playback.getCurrentTrackIndex', { includeTrackInfo: true })
                    .catch(() => ({ found: false })),
                invoke('playback.getCurrentTrack').catch(() => null)
            ]);

            if (!mountedRef.current || activePlaylistGuidRef.current !== playlistGuid) return;

            const index = resolveCurrentTrackIndex({
                items: itemsRef.current,
                playingTrackIndex: playingTrack,
                currentTrackResponse,
                activePlaylistGuid: playlistGuid,
                playlists: playlistsRef.current
            });

            if (index < 0) {
                setStatusMessage('La canción en reproducción no está en la playlist activa.');
                return;
            }

            let result = null;
            nativeSelectionMutationRef.current.add(playlistGuid);
            try {
                result = await applyPlaylistActivationSelection({
                    invoke,
                    playlistGuid,
                    index
                });
            } finally {
                nativeSelectionMutationRef.current.delete(playlistGuid);
            }

            if (!mountedRef.current || activePlaylistGuidRef.current !== playlistGuid) return;

            if (result?.applied) {
                commitFocusedItem(index);
                commitSelectedIndices(result.nativeSelection, itemsRef.current);
                requestScroll('focused');
                setStatusMessage('Active Now Playing: pista ' + (index + 1));
            } else if (result?.reason === 'active-playlist-changed') {
                setStatusMessage('La playlist activa cambió antes de enfocar la canción.');
            }
        } catch (error) {
            setStatusMessage('No se pudo enfocar la canción en reproducción', error);
        }
    }, [commitFocusedItem, commitSelectedIndices, requestScroll, setStatusMessage]);

    const changePlaylist = useCallback(async (playlistGuid) => {
        if (!playlistGuid) return;

        const eventRequestBefore = activationEventRequestRef.current;
        console.info('[CrayonShell][playlist-activation] picker change requested', {
            playlistGuid,
            reactActivePlaylistGuid: activePlaylistGuidRef.current
        });

        try {
            const nativeActive = await invoke('playlist.getActive').catch(() => null);
            if (nativeActive?.guid !== playlistGuid) {
                await invoke('playlist.setActive', { playlistGuid });
            }

            if (activationEventRequestRef.current !== eventRequestBefore) {
                const inFlight = activationLoadRef.current;
                if (inFlight?.playlistGuid === playlistGuid) {
                    await inFlight.promise;
                } else if (activePlaylistGuidRef.current !== playlistGuid) {
                    await loadActivatedPlaylist(playlistGuid, {
                        force: true,
                        source: 'picker-fallback-after-event'
                    });
                }
                return;
            }

            await loadActivatedPlaylist(playlistGuid, {
                force: true,
                source: 'picker'
            });
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
            const playlistGuid = resolvePlaylistGuidFromEvent(payload, playlistsRef.current);
            console.info('[CrayonShell][playlist-navigation] focusChanged received', {
                payload,
                resolvedPlaylistGuid: playlistGuid,
                activePlaylistGuid: activePlaylistGuidRef.current,
                ignoredDuringInitialization: initializationInProgressRef.current,
                ignoredDuringNativeWrite: Boolean(playlistGuid && nativeSelectionMutationRef.current.has(playlistGuid))
            });
            if (
                initializationInProgressRef.current
                || !playlistGuid
                || playlistGuid !== activePlaylistGuidRef.current
                || nativeSelectionMutationRef.current.has(playlistGuid)
            ) return;

            if (Object.prototype.hasOwnProperty.call(payload, 'to')) {
                commitFocusedItem(normalizeIndex(payload.to));
            }
        }));

        unsubscribers.push(subscribe('playlist:selectionChanged', async (payload = {}) => {
            const playlistGuid = resolvePlaylistGuidFromEvent(payload, playlistsRef.current);
            if (
                !playlistGuid
                || playlistGuid !== activePlaylistGuidRef.current
                || nativeSelectionMutationRef.current.has(playlistGuid)
            ) return;

            const selectionRequest = ++selectionReadRevisionRef.current;
            try {
                const selection = await invoke('playlist.getSelection', { playlistGuid });
                if (
                    selectionRequest !== selectionReadRevisionRef.current
                    || playlistGuid !== activePlaylistGuidRef.current
                ) return;
                const selected = commitSelectedIndices(selection.items, itemsRef.current);
                console.info('[CrayonShell][playlist-navigation] selectionChanged received', {
                    payload,
                    resolvedPlaylistGuid: playlistGuid,
                    activePlaylistGuid: activePlaylistGuidRef.current,
                    selectedIndices: selected,
                    count: Number(selection.count) || 0
                });
            } catch (error) {
                console.warn('[CrayonShell][playlist-navigation] could not read selection after event', {
                    playlistGuid,
                    error
                });
            }
        }));

        unsubscribers.push(subscribe('playlist:activated', (payload = {}) => {
            const eventRequest = ++activationEventRequestRef.current;
            const requestedIndex = Number(payload.newIndex ?? payload.index);
            console.info('[CrayonShell][playlist-activation] event received', {
                payload,
                reactActivePlaylistGuid: activePlaylistGuidRef.current,
                eventRequest
            });

            const resolveAndLoadActivatedPlaylist = async () => {
                let playlistGuid = String(payload.newGuid || payload.playlistGuid || '');

                // Some bridge versions publish only oldIndex/newIndex. Resolve
                // that payload against a fresh list, not a stale cached index map.
                if (!playlistGuid && Number.isInteger(requestedIndex) && requestedIndex >= 0) {
                    console.info('[CrayonShell][playlist-activation] resolving index-only event', { requestedIndex });
                    const result = await invoke('playlist.getAll');
                    const nextPlaylists = Array.isArray(result.playlists) ? result.playlists : [];
                    if (
                        !mountedRef.current
                        || eventRequest !== activationEventRequestRef.current
                    ) return;

                    playlistGuid = resolveActivatedPlaylistGuid(payload, nextPlaylists);
                    playlistsRef.current = nextPlaylists;
                    setPlaylists(mapPlaylistList(nextPlaylists, playlistGuid));
                }

                if (
                    !mountedRef.current
                    || eventRequest !== activationEventRequestRef.current
                ) return;

                if (!playlistGuid && requestedIndex === -1) {
                    activePlaylistGuidRef.current = '';
                    setActivePlaylistGuid('');
                    playlistsRef.current = mapPlaylistList(playlistsRef.current, '');
                    setPlaylists((previous) => mapPlaylistList(previous, ''));
                    commitItems([]);
                    commitFocusedItem(-1);
                    commitSelectedIndices([]);
                    commitPlayingItem(-1);
                    setPlaybackState('stopped');
                    setSessionReady(true);
                    return;
                }

                if (!playlistGuid) {
                    console.warn('[CrayonShell][playlist-activation] event has no resolvable playlist GUID', {
                        payload,
                        requestedIndex
                    });
                    return;
                }

                console.info('[CrayonShell][playlist-activation] event target resolved', {
                    playlistGuid,
                    requestedIndex,
                    eventRequest
                });

                if (initializationInProgressRef.current) {
                    pendingActivatedGuidRef.current = playlistGuid;
                    return;
                }

                loadActivatedPlaylist(playlistGuid, {
                    force: true,
                    source: 'playlist:activated'
                });
            };

            resolveAndLoadActivatedPlaylist().catch((error) => {
                setStatusMessage('No se pudo resolver la playlist activada', error);
            });
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
        commitSelectedIndices,
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
        selectedIndices,
        playingItemIndex,
        playbackState,
        status,
        scrollRequest,
        isDemoMode,
        refreshPlaylist,
        changePlaylist,
        focusPlayingTrack,
        selectItem,
        playItem,
        openNativeContextMenu
    };
}
