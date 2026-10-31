(() => {
    'use strict';

    const PAGE_SIZE = 200;
    const TRACK_PROPERTIES_COMMAND = '{6F441057-1D18-4A58-9AC4-8F409CDA7DFD}';

    // Keep metadata formatting separate from playlist and playback state.
    // The playlist row number and playing marker are supplied by the API state.
    const PLAYLIST_FORMATS = {
        duration:
            "$ifgreater($div(%length_seconds%,3600),9," +
            "$div(%length_seconds%,3600)," +
            "0$div(%length_seconds%,3600))" +
            ":" +
            "$ifgreater($mod($div(%length_seconds%,60),60),9," +
            "$mod($div(%length_seconds%,60),60)," +
            "0$mod($div(%length_seconds%,60),60))" +
            ":" +
            "$ifgreater($mod(%length_seconds%,60),9," +
            "$mod(%length_seconds%,60)," +
            "0$mod(%length_seconds%,60))",
        details:
            "$if(%length%,$substr(%path%,14,17). ,00. )" +
            "$if(%length%,%filename% ,$if(%Artist%,%Artist% - )%Title%)" +
            "$if($strstr(%filename_ext%,.mp4),$ascii('[')Video$ascii(']') ,)" +
            "$ifgreater(%totaltracks%,1,$ascii('[[')%title%$ascii(']]') ,)"
    };

    const state = {
        playlistIndex: -1,
        playlistGuid: '',
        playlists: [],
        items: [],
        focusedItem: -1,
        playingItemIndex: -1,
        playbackState: 'stopped',
        contextMenuId: '',
        contextMenuItemIndex: -1,
        refreshTimer: 0,
        refreshing: false,
        refreshAgain: false
    };

    const byId = (id) => document.getElementById(id);
    const api = () => window.fb2k;

    async function invoke(method, params) {
        const bridge = api();
        if (!bridge || typeof bridge.invoke !== 'function') {
            throw new Error('No se encontró la API fb2k.invoke de foo_ui_webview2.');
        }

        const result = await bridge.invoke(method, params || {});
        if (result && result.success === false) {
            const error = new Error(result.error || ('Falló ' + method));
            error.code = result.code;
            throw error;
        }
        return result || {};
    }

    function fileName(path) {
        const value = String(path || '').replace(/\\/g, '/');
        const tail = value.slice(value.lastIndexOf('/') + 1);
        try {
            return decodeURIComponent(tail) || value;
        } catch (_) {
            return tail || value;
        }
    }

    function setStatus(message, error) {
        const detail = error ? (error.message || String(error)) : '';
        byId('PlaylistStatus').textContent = detail
            ? message + ' · ' + detail
            : message;
    }

    function renderPlaylists() {
        const picker = byId('PlaylistPicker');
        picker.replaceChildren();

        state.playlists.forEach((playlist) => {
            const option = document.createElement('option');
            option.value = playlist.guid;
            option.textContent = playlist.name + ' (' + playlist.trackCount + ')';
            picker.appendChild(option);
        });

        picker.value = state.playlistGuid;
        picker.disabled = state.playlists.length === 0;
    }

    function playbackMarker(itemIndex) {
        if (itemIndex !== state.playingItemIndex) return '        ';
        return state.playbackState === 'paused' ? '❚❚   ' : '▶  ️ ';
    }

    function formatItemLine(item) {
        const duration = item.duration || '00:00:00';
        const details = item.details || fileName(item.path) || '(sin nombre)';
        return playbackMarker(item.index) + '[' + duration + ']  '
            + (item.index + 1) + ' :: ' + details;
    }

    function renderItems() {
        const query = byId('PlaylistFilter').value.trim().toLocaleLowerCase();
        const rows = state.items.filter((item) => {
            const line = formatItemLine(item);
            return !query || line.toLocaleLowerCase().includes(query)
                || String(item.path || '').toLocaleLowerCase().includes(query);
        });

        const fragment = document.createDocumentFragment();

        rows.forEach((item) => {
            const row = document.createElement('tr');
            row.dataset.index = String(item.index);

            if (item.index === state.focusedItem) {
                row.classList.add('focused');
            }
            if (item.index === state.playingItemIndex) {
                row.classList.add('playing');
            }

            const cell = document.createElement('td');
            cell.className = 'playlist-line';
            cell.textContent = formatItemLine(item);
            cell.title = cell.textContent;

            row.appendChild(cell);
            fragment.appendChild(row);
        });

        byId('PlaylistRows').replaceChildren(fragment);
        byId('PlaylistEmpty').classList.toggle('visible', rows.length === 0);
        byId('PlaylistEmpty').textContent = state.items.length === 0
            ? 'No hay pistas en la playlist activa.'
            : 'No hay coincidencias para el filtro.';

        byId('PlaylistSummary').textContent = state.playlistIndex < 0
            ? 'Sin playlist activa'
            : rows.length === state.items.length
                ? state.items.length + ' pistas'
                : rows.length + ' / ' + state.items.length + ' pistas';
    }

    async function readPlaylistItems(playlist) {
        const items = [];
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
                items.push({
                    index: Number(track.index),
                    path: track.path ? String(track.path) : '',
                    duration: formats.duration ? String(formats.duration) : '',
                    details: formats.details ? String(formats.details) : ''
                });
            });

            if (tracks.length === 0) break;
        }

        return items;
    }

    async function refreshPlaylistOnce() {
        const result = await invoke('playlist.getAll');
        state.playlists = Array.isArray(result.playlists) ? result.playlists : [];

        const active = state.playlists.find((playlist) => playlist.isActive);
        if (!active) {
            state.playlistIndex = -1;
            state.playlistGuid = '';
            state.items = [];
            state.focusedItem = -1;
            state.playingItemIndex = -1;
            state.playbackState = 'stopped';
            renderPlaylists();
            renderItems();
            setStatus('No hay playlist activa');
            return;
        }

        state.playlistIndex = active.index;
        state.playlistGuid = active.guid;

        const [items, focus, playingTrack, playback] = await Promise.all([
            readPlaylistItems(active),
            invoke('playlist.getFocusedTrack', { playlistGuid: active.guid }),
            invoke('playback.getCurrentTrackIndex'),
            invoke('playback.getState')
        ]);

        state.items = items;
        state.focusedItem = Number.isInteger(focus.index) ? focus.index : -1;
        state.playbackState = playback.state || 'stopped';
        state.playingItemIndex = playingTrack.found
            && playingTrack.playlistGuid === active.guid
            && state.playbackState !== 'stopped'
            ? Number(playingTrack.index)
            : -1;

        renderPlaylists();
        renderItems();
        setStatus('Playlist: ' + active.name);
    }

    async function refreshPlaylist() {
        if (state.refreshing) {
            state.refreshAgain = true;
            return;
        }

        state.refreshing = true;
        try {
            do {
                state.refreshAgain = false;
                await refreshPlaylistOnce();
            } while (state.refreshAgain);
        } catch (error) {
            setStatus('No se pudo leer la playlist', error);
        } finally {
            state.refreshing = false;
        }
    }

    function schedulePlaylistRefresh() {
        window.clearTimeout(state.refreshTimer);
        state.refreshTimer = window.setTimeout(refreshPlaylist, 120);
    }

    async function selectItem(index) {
        if (!state.playlistGuid) return;

        try {
            await invoke('playlist.setSelection', {
                playlistGuid: state.playlistGuid,
                indices: [index],
                clearOthers: true
            });
            await invoke('playlist.setFocusedTrack', {
                playlistGuid: state.playlistGuid,
                index
            });

            state.focusedItem = index;
            renderItems();
            setStatus('Seleccionada: ' + (index + 1));
        } catch (error) {
            setStatus('No se pudo seleccionar la pista', error);
        }
    }

    async function playItem(index) {
        if (!state.playlistGuid) return;

        try {
            await invoke('playlist.playTrack', {
                playlistGuid: state.playlistGuid,
                index
            });
            state.focusedItem = index;
            renderItems();
            setStatus('Reproduciendo pista: ' + (index + 1));
            schedulePlaylistRefresh();
        } catch (error) {
            setStatus('No se pudo reproducir la pista', error);
        }
    }

    async function showTrackProperties(index) {
        if (!state.playlistGuid) return;

        await invoke('playlist.setSelection', {
            playlistGuid: state.playlistGuid,
            indices: [index],
            clearOthers: true
        });
        await invoke('playlist.setFocusedTrack', {
            playlistGuid: state.playlistGuid,
            index
        });
        await invoke('menu.runContextCommand', {
            command: TRACK_PROPERTIES_COMMAND
        });
        setStatus('Propiedades de la pista: ' + (index + 1));
    }

    async function copyTrackFilename(index) {
        const item = state.items.find((track) => track.index === index);
        const name = item ? fileName(item.path) : '';
        if (!name) throw new Error('No se encontró el nombre del archivo.');

        await invoke('clipboard.write', { text: name });
        setStatus('Nombre copiado: ' + name);
    }

    async function openContextMenu(index, event) {
        event.preventDefault();
        if (!state.playlistGuid) return;

        try {
            await invoke('playlist.setSelection', {
                playlistGuid: state.playlistGuid,
                indices: [index],
                clearOthers: true
            });
            await invoke('playlist.setFocusedTrack', {
                playlistGuid: state.playlistGuid,
                index
            });

            state.focusedItem = index;
            renderItems();

            const result = await invoke('menu.show', {
                items: [
                    { id: 'play', label: 'Play' },
                    { id: 'copy-filename', label: 'Copy Filename' },
                    { type: 'separator' },
                    { id: 'properties', label: 'Properties' }
                ],
                x: Math.round(event.screenX * (window.devicePixelRatio || 1)),
                y: Math.round(event.screenY * (window.devicePixelRatio || 1)),
                windowModel: 'contentSized',
                backdrop: 'none'
            });

            state.contextMenuItemIndex = index;
            state.contextMenuId = result.menuId || '';
        } catch (error) {
            state.contextMenuId = '';
            state.contextMenuItemIndex = -1;
            setStatus('No se pudo abrir el menú contextual', error);
        }
    }

    async function handleContextMenuSelection(event) {
        if (!event || event.menuId !== state.contextMenuId) return;

        const action = event.itemId;
        const index = state.contextMenuItemIndex;
        state.contextMenuId = '';
        state.contextMenuItemIndex = -1;

        try {
            if (action === 'play') {
                await playItem(index);
            } else if (action === 'copy-filename') {
                await copyTrackFilename(index);
            } else if (action === 'properties') {
                await showTrackProperties(index);
            }
        } catch (error) {
            setStatus('No se pudo ejecutar la acción', error);
        }
    }

    byId('PlaylistRows').addEventListener('click', (event) => {
        const row = event.target.closest('tr[data-index]');
        if (row) selectItem(Number(row.dataset.index));
    });

    byId('PlaylistRows').addEventListener('dblclick', (event) => {
        const row = event.target.closest('tr[data-index]');
        if (row) playItem(Number(row.dataset.index));
    });

    byId('PlaylistRows').addEventListener('contextmenu', (event) => {
        const row = event.target.closest('tr[data-index]');
        if (row) openContextMenu(Number(row.dataset.index), event);
    });

    byId('PlaylistPicker').addEventListener('change', async (event) => {
        const playlistGuid = event.target.value;
        if (!playlistGuid) return;

        try {
            await invoke('playlist.setActive', { playlistGuid });
            schedulePlaylistRefresh();
        } catch (error) {
            setStatus('No se pudo cambiar la playlist', error);
        }
    });

    byId('PlaylistFilter').addEventListener('input', renderItems);
    byId('PlaylistRefresh').addEventListener('click', refreshPlaylist);

    const refreshEvents = [
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

    if (api() && typeof api().on === 'function') {
        refreshEvents.forEach((eventName) => {
            api().on(eventName, schedulePlaylistRefresh);
        });
        api().on('menu:select', handleContextMenuSelection);
        api().on('menu:dismiss', (event) => {
            if (event && event.menuId === state.contextMenuId) {
                state.contextMenuId = '';
                state.contextMenuItemIndex = -1;
            }
        });
    }

    refreshPlaylist();
})();
