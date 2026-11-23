import { useCallback, useEffect, useRef, useState } from 'react';
import {
    hasBridge,
    isDemoMode,
    invoke,
    subscribe
} from '../services/foobarApi.js';
import { PLAYLIST_FORMATS } from '../services/playlistFormats.js';

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

    const mountedRef = useRef(true);
    const refreshControlRef = useRef({ running: false, queued: false });
    const refreshTimerRef = useRef(null);
    const scrollRequestVersionRef = useRef(0);
    const pendingScrollTargetRef = useRef(null);

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
                    path: track.path ? String(track.path) : '',
                    duration: formats.duration ? String(formats.duration) : '',
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

        setPlaylists(nextPlaylists);

        const active = nextPlaylists.find((playlist) => playlist.isActive);

        if (!active) {
            setActivePlaylistGuid('');
            setItems([]);
            setFocusedItem(-1);
            setPlayingItemIndex(-1);
            setPlaybackState('stopped');
            setStatusMessage('No hay playlist activa');
            return;
        }

        const [nextItems, focus, playingTrack, playback] = await Promise.all([
            readPlaylistItems(active),
            invoke('playlist.getFocusedTrack', { playlistGuid: active.guid }),
            invoke('playback.getCurrentTrackIndex'),
            invoke('playback.getState')
        ]);

        if (!mountedRef.current) return;

        setActivePlaylistGuid(active.guid);
        setItems(nextItems);
        setFocusedItem(Number.isInteger(focus.index) ? focus.index : -1);
        setPlaybackState(playback.state || 'stopped');
        setPlayingItemIndex(
            playingTrack.found
                && playingTrack.playlistGuid === active.guid
                && playback.state !== 'stopped'
                ? Number(playingTrack.index)
                : -1
        );
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
            return;
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

    const setSelectedItem = useCallback(async (index) => {
        if (!activePlaylistGuid) {
            throw new Error('No hay una playlist activa.');
        }

        await invoke('playlist.setSelection', {
            playlistGuid: activePlaylistGuid,
            indices: [index],
            clearOthers: true
        });
        await invoke('playlist.setFocusedTrack', {
            playlistGuid: activePlaylistGuid,
            index
        });

        setFocusedItem(index);
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

        try {
            await setSelectedItem(index);
            await invoke('playlist.playTrack', {
                playlistGuid: activePlaylistGuid,
                index
            });

            setStatusMessage('Reproduciendo pista: ' + (index + 1));
            schedulePlaylistRefresh();
        } catch (error) {
            setStatusMessage('No se pudo reproducir la pista', error);
        }
    }, [activePlaylistGuid, schedulePlaylistRefresh, setSelectedItem, setStatusMessage]);

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
