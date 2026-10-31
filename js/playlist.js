(() => {
    'use strict';

    const PAGE_SIZE = 200;

    // Evaluated by playlist.getTracks for each playlist row.
    const PLAYLIST_LINE_FORMAT =
        "$if(%isplaying%, $if(%ispaused%,❚❚   ,▶  ️ ),       ) " +
        "$ascii('[')" +
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
        "0$mod(%length_seconds%,60))" +
        "$ascii(']')  " +
        "%list_index% :: " +
        "$if(%length%,$substr(%path%,14,17). ,00. )" +
        "$if(%length%,%filename% ,$if(%Artist%,%Artist% - )%Title%)" +
        "$if($strstr(%filename_ext%,.mp4),$ascii('[')Video$ascii(']') ,)" +
        "$ifgreater(%totaltracks%,1,$ascii('[[')%title%$ascii(']]') ,)";

    const state = {
        playlistIndex: -1,
        playlistGuid: '',
        playlists: [],
        items: [],
        focusedItem: -1,
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

    function renderItems() {
        const query = byId('PlaylistFilter').value.trim().toLocaleLowerCase();
        const rows = state.items.filter((item) => {
            const line = item.line || fileName(item.path);
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

            const cell = document.createElement('td');
            cell.className = 'playlist-line';
            cell.textContent = item.line || fileName(item.path) || '(sin nombre)';
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
                formats: {
                    playlistLine: PLAYLIST_LINE_FORMAT
                }
            });

            const tracks = Array.isArray(page.tracks) ? page.tracks : [];
            tracks.forEach((track) => {
                items.push({
                    index: Number(track.index),
                    path: track.path ? String(track.path) : '',
                    line: track.formats && track.formats.playlistLine
                        ? String(track.formats.playlistLine)
                        : ''
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
            renderPlaylists();
            renderItems();
            setStatus('No hay playlist activa');
            return;
        }

        state.playlistIndex = active.index;
        state.playlistGuid = active.guid;

        const [items, focus] = await Promise.all([
            readPlaylistItems(active),
            invoke('playlist.getFocusedTrack', { playlistGuid: active.guid })
        ]);

        state.items = items;
        state.focusedItem = Number.isInteger(focus.index) ? focus.index : -1;

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
                indices: [index]
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
        } catch (error) {
            setStatus('No se pudo reproducir la pista', error);
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
    }

    refreshPlaylist();
})();
