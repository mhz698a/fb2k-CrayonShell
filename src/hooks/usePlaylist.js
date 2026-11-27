import { useCallback, useEffect, useRef, useState } from 'react';
import {
    hasBridge,
    isDemoMode,
    invoke,
    subscribe
} from '../services/foobarApi.js';
import { PLAYLIST_FORMATS } from '../services/playlistFormats.js';
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

const REFRESH_EVENTS = [
    'playlist:defaultFormatChanged',
    'playlist:itemsAdded',
    'playlist:itemsRemoved',
    'playlist:itemsReordered',
    'playlist:selectionChanged',
    'playlist:focusChanged',
    'playlist:itemsReplaced',
    'playlist:created',
    'playlist:removed',
    'playlist:reordered',
    'playlist:activated',
    'playlist:renamed',
    'playback:trackChanged',
    'playback:edited',
    'playback:paused',
    'playback:stopped',
    'playback:stateChanged',
    'playback:dynamicInfoTrack'
];

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

    const mountedRef = useRef(true);
    const refreshControlRef = useRef({ running: false, queued: false, waiters: [] });
    const refreshTimerRef = useRef(null);
    const scrollRequestVersionRef = useRef(0);
    const pendingScrollTargetRef = useRef(null);
    const selectionQueueRef = useRef(Promise.resolve());
    const sessionRestoreAttemptedRef = useRef(false);
    const sessionSnapshotRef = useRef(null);
    const activePlaylistGuidRef = useRef(activePlaylistGuid);
    activePlaylistGuidRef.current = activePlaylistGuid;

    const setStatusMessage = useCallback((message, error) => {
        const detail = error ? (error.message || String(error)) : '';
        setStatus(detail ? message + ' · ' + detail : message);
    }, []);

    const readPlaylistItems = useCallback(async (playlist) => {
        const nextItems = [];
        const total = Number(playlist.trackCount) || 0;

        for (let start = 0; start < total; start += PAGE_SIZE) {
            const page = await invoke('playlist.getTracks', {
                playlistGuid: playlist.guid,
                start,
                count: PAGE_SIZE,
                formats: PLAYLIST_FORMATS
            });

            const tracks = Array.isArray(page.tracks) ? page.tracks : [];

            tracks.forEach((track) => {
                const formats = track.formats || {};
                nextItems.push({
                    index: Number(track.index),
                    handle: track.handle ? String(track.handle) : '',
                    path: track.path ? String(track.path) : '',
                    absolutePath: track.absolutePath ? String(track.absolutePath) : '',
                    duration: formats.duration ? String(formats.duration) : '',
                    title: formats.title ? String(formats.title) : '',
                    artist: formats.artist ? String(formats.artist) : '',
                    details: formats.details ? String(formats.details) : ''
                });
            });

            if (tracks.length === 0) break;
        }

        return nextItems;
    }, []);

    const refreshPlaylistOnce = useCallback(async () => {
        const result = await invoke('playlist.getAll');
        const nextPlaylists = Array.isArray(result.playlists)
            ? result.playlists
            : [];

        if (!mountedRef.current) return;

        let savedSession = null;
        if (!sessionRestoreAttemptedRef.current) {
            sessionRestoreAttemptedRef.current = true;
            savedSession = readPlaylistSession();
        }

        let active = nextPlaylists.find((playlist) => playlist.isActive);
        const savedPlaylist = savedSession
            ? nextPlaylists.find((playlist) => playlist.guid === savedSession.playlistGuid)
            : null;

        if (savedPlaylist && active?.guid !== savedPlaylist.guid) {
            try {
                await invoke('playlist.setActive', { playlistGuid: savedPlaylist.guid });
                active = savedPlaylist;
            } catch (error) {
                setStatusMessage('No se pudo restaurar la playlist anterior', error);
            }
        } else if (savedPlaylist) {
            active = savedPlaylist;
        }

        if (!active) {
            setPlaylists(nextPlaylists);
            setActivePlaylistGuid('');
            setItems([]);
            setFocusedItem(-1);
            setPlayingItemIndex(-1);
            setPlaybackState('stopped');
            setSessionReady(true);
            setStatusMessage('No hay playlist activa');
            return;
        }

        setPlaylists(nextPlaylists.map((playlist) => ({
            ...playlist,
            isActive: playlist.guid === active.guid
        })));

        const [nextItems, focus, playingTrack, playback] = await Promise.all([
            readPlaylistItems(active),
            invoke('playlist.getFocusedTrack', { playlistGuid: active.guid }),
            invoke('playback.getCurrentTrackIndex'),
            invoke('playback.getState')
        ]);

        if (!mountedRef.current) return;

        let nextFocusedIndex = Number.isInteger(focus.index) ? focus.index : -1;
        if (savedSession?.playlistGuid === active.guid) {
            const restoredIndex = resolveSavedFocusIndex(
                savedSession,
                active.guid,
                nextItems
            );

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
                    nextFocusedIndex = restoredIndex;
                } catch (error) {
                    setStatusMessage('No se pudo restaurar el elemento seleccionado', error);
                }
            }
        }

        if (!mountedRef.current) return;

        setActivePlaylistGuid(active.guid);
        setItems(nextItems);
        setFocusedItem(nextFocusedIndex);
        setPlaybackState(playback.state || 'stopped');
        setPlayingItemIndex(
            playingTrack.found
                && playingTrack.playlistGuid === active.guid
                && playback.state !== 'stopped'
                ? Number(playingTrack.index)
                : -1
        );
        setSessionReady(true);
        setStatusMessage('Playlist: ' + active.name);
    }, [readPlaylistItems, setStatusMessage]);

    const refreshPlaylist = useCallback(async () => {
        if (!hasBridge()) {
            setStatusMessage('Abre la versión de desarrollo o carga CrayonShell desde foobar2000.');
            return;
        }

        const control = refreshControlRef.current;

        if (control.running) {
            control.queued = true;
            return new Promise((resolve) => {
                control.waiters.push(resolve);
            });
        }

        control.running = true;

        try {
            do {
                control.queued = false;
                await refreshPlaylistOnce();
            } while (control.queued && mountedRef.current);
        } catch (error) {
            setStatusMessage('No se pudo leer la playlist', error);
        } finally {
            control.running = false;
            const waiters = control.waiters.splice(0);
            waiters.forEach((resolve) => resolve());
        }
    }, [refreshPlaylistOnce, setStatusMessage]);

    const schedulePlaylistRefresh = useCallback((scrollTarget = null) => {
        if (scrollTarget === 'playing' || scrollTarget === 'focused') {
            pendingScrollTargetRef.current = scrollTarget;
        }

        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = window.setTimeout(async () => {
            refreshTimerRef.current = null;
            await refreshPlaylist();

            const target = pendingScrollTargetRef.current;
            pendingScrollTargetRef.current = null;
            if (target && mountedRef.current) {
                scrollRequestVersionRef.current += 1;
                setScrollRequest({
                    version: scrollRequestVersionRef.current,
                    target
                });
            }
        }, 120);
    }, [refreshPlaylist]);

    useEffect(() => {
        mountedRef.current = true;

        return () => {
            mountedRef.current = false;
            window.clearTimeout(refreshTimerRef.current);
        };
    }, []);

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

        const unsubscribe = REFRESH_EVENTS.map((eventName) =>
            subscribe(eventName, () => {
                const scrollTarget = eventName === 'playback:trackChanged'
                    || eventName === 'playlist:activated'
                    ? 'playing'
                    : eventName === 'playlist:focusChanged'
                        ? 'focused'
                        : null;
                schedulePlaylistRefresh(scrollTarget);
            })
        );

        refreshPlaylist();

        return () => {
            unsubscribe.forEach((stop) => stop());
        };
    }, [refreshPlaylist, schedulePlaylistRefresh, setStatusMessage]);

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
                setFocusedItem(index);
            }
        };

        const queued = selectionQueueRef.current.then(operation, operation);
        selectionQueueRef.current = queued.catch(() => {});
        return queued;
    }, [activePlaylistGuid]);

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
            const targetTrack = items.find((item) => item.index === index);
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
            schedulePlaylistRefresh();
        } catch (error) {
            if (preparedDsp) {
                const currentTrack = items.find((item) => item.index === playingItemIndex);
                await cancelPreparedDspPresetTrack(currentTrack?.path || '');
            }
            setStatusMessage('No se pudo reproducir la pista', error);
        }
    }, [activePlaylistGuid, items, isDemoMode, playingItemIndex, schedulePlaylistRefresh, setSelectedItem, setStatusMessage]);

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
    }, [activePlaylistGuid, setSelectedItem, setStatusMessage]);

    const changePlaylist = useCallback(async (playlistGuid) => {
        if (!playlistGuid) return;

        try {
            await invoke('playlist.setActive', { playlistGuid });
            schedulePlaylistRefresh();
        } catch (error) {
            setStatusMessage('No se pudo cambiar la playlist', error);
        }
    }, [schedulePlaylistRefresh, setStatusMessage]);

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
