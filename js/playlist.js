(() => {
    'use strict';

    const hostSync = () => chrome.webview.hostObjects.sync.foo_uie_webview;
    const hostAsync = () => chrome.webview.hostObjects.foo_uie_webview;

    const state = {
        playlistIndex: -1,
        playlists: [],
        items: [],
        focusedItem: -1,
        refreshTimer: 0,
        refreshing: false,
        refreshAgain: false
    };

    const byId = (id) => document.getElementById(id);

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
        byId('PlaylistStatus').textContent = error
            ? message + ' · ' + (error.message || String(error))
            : message;
    }

    function renderPlaylists() {
        const picker = byId('PlaylistPicker');
        picker.replaceChildren();

        state.playlists.forEach((playlist) => {
            const option = document.createElement('option');
            option.value = String(playlist.index);
            option.textContent = playlist.name + ' (' + playlist.count + ')';
            picker.appendChild(option);
        });

        if (state.playlistIndex >= 0) {
            picker.value = String(state.playlistIndex);
        }

        picker.disabled = state.playlists.length === 0;
    }

    function renderItems() {
        const query = byId('PlaylistFilter').value.trim().toLocaleLowerCase();
        const rows = state.items.filter((item) => {
            const title = fileName(item.path);
            return !query || title.toLocaleLowerCase().includes(query)
                || String(item.path || '').toLocaleLowerCase().includes(query);
        });

        const fragment = document.createDocumentFragment();

        rows.forEach((item) => {
            const index = item.index;
            const row = document.createElement('tr');
            row.dataset.index = String(index);

            if (index === state.focusedItem) {
                row.classList.add('focused');
            }

            const number = document.createElement('td');
            number.className = 'playlist-number';
            number.textContent = String(index + 1);

            const title = document.createElement('td');
            title.textContent = fileName(item.path) || '(sin nombre)';
            title.title = title.textContent;

            const path = document.createElement('td');
            path.textContent = item.path || '';
            path.title = path.textContent;

            row.append(number, title, path);
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

    async function readPlaylistItems(index) {
        const text = await hostAsync().getPlaylistItems(index);
        const items = JSON.parse(text || '[]');

        if (!Array.isArray(items)) {
            throw new Error('getPlaylistItems no devolvió una lista JSON válida.');
        }

        return items.map((item, itemIndex) => ({
            index: itemIndex,
            path: item && item.path ? String(item.path) : '',
            subsong: item && Number.isFinite(Number(item.subsong)) ? Number(item.subsong) : 0
        }));
    }

    async function refreshPlaylistOnce() {
        const host = hostSync();
        const count = Number(host.playlistCount) || 0;
        const active = Number(host.activePlaylist);

        state.playlists = [];
        for (let index = 0; index < count; index += 1) {
            state.playlists.push({
                index,
                name: String(host.getPlaylistName(index)),
                count: Number(host.getPlaylistItemCount(index)) || 0
            });
        }

        state.playlistIndex = Number.isInteger(active) && active >= 0 && active < count
            ? active
            : -1;

        if (state.playlistIndex < 0) {
            state.items = [];
            state.focusedItem = -1;
            renderPlaylists();
            renderItems();
            setStatus('No hay playlist activa');
            return;
        }

        const playlistName = state.playlists[state.playlistIndex].name;
        const [items, focused] = await Promise.all([
            readPlaylistItems(state.playlistIndex),
            Promise.resolve(Number(host.getFocusedPlaylistItem(state.playlistIndex)))
        ]);

        state.items = items;
        state.focusedItem = Number.isInteger(focused) ? focused : -1;

        renderPlaylists();
        renderItems();
        setStatus('Playlist: ' + playlistName);
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
        if (state.playlistIndex < 0) return;

        try {
            await hostAsync().selectPlaylistItem(state.playlistIndex, index);
            await hostAsync().setFocusedPlaylistItem(state.playlistIndex, index);
            await hostAsync().ensurePlaylistItemVisible(state.playlistIndex, index);
            state.focusedItem = index;
            renderItems();
            setStatus('Seleccionada: ' + (index + 1));
        } catch (error) {
            setStatus('No se pudo seleccionar la pista', error);
        }
    }

    async function playItem(index) {
        if (state.playlistIndex < 0) return;

        try {
            await hostAsync().executePlaylistDefaultAction(state.playlistIndex, index);
            state.focusedItem = index;
            renderItems();
            setStatus('Acción de reproducción enviada: ' + (index + 1));
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

    byId('PlaylistPicker').addEventListener('change', (event) => {
        const index = Number(event.target.value);
        if (!Number.isInteger(index) || index < 0 || index >= state.playlists.length) return;

        try {
            hostSync().activePlaylist = index;
            schedulePlaylistRefresh();
        } catch (error) {
            setStatus('No se pudo cambiar la playlist', error);
        }
    });

    byId('PlaylistFilter').addEventListener('input', renderItems);
    byId('PlaylistRefresh').addEventListener('click', refreshPlaylist);

    // foo_webview2 legacy playlist callbacks are global page functions.
    window.onPlaylistItemsAdded = schedulePlaylistRefresh;
    window.onPlaylistItemsReordered = schedulePlaylistRefresh;
    window.onPlaylistItemsRemoving = schedulePlaylistRefresh;
    window.onPlaylistItemsRemoved = schedulePlaylistRefresh;
    window.onPlaylistItemsModified = schedulePlaylistRefresh;
    window.onPlaylistItemsModifiedFromPlayback = schedulePlaylistRefresh;
    window.onPlaylistItemsReplaced = schedulePlaylistRefresh;
    window.onPlaylistCreated = schedulePlaylistRefresh;
    window.onPlaylistRenamed = schedulePlaylistRefresh;
    window.onPlaylistActivated = schedulePlaylistRefresh;
    window.onPlaylistSelectedItemsChanged = schedulePlaylistRefresh;
    window.onPlaylistFocusedItemChanged = schedulePlaylistRefresh;
    window.onPlaylistsReordered = schedulePlaylistRefresh;
    window.onPlaylistsRemoving = schedulePlaylistRefresh;
    window.onPlaylistsRemoved = schedulePlaylistRefresh;

    // Keep the existing playback metadata callback and refresh the playlist focus as well.
    if (typeof window.onPlaybackNewTrack === 'function') {
        const previousOnPlaybackNewTrack = window.onPlaybackNewTrack;
        window.onPlaybackNewTrack = function (...args) {
            previousOnPlaybackNewTrack.apply(this, args);
            schedulePlaylistRefresh();
        };
    }

    refreshPlaylist();
})();
