const demoPlaylistGuid = 'crayonshell-demo-playlist';

const demoTracks = [
    {
        index: 0,
        path: 'D:\\Music\\Demo Artist\\First Track.flac',
        fileSize: 2480000,
        formats: {
            duration: '00:03:42', title: 'First Track', artist: 'Demo Artist',
            album: 'CrayonShell Demo', albumArtist: 'Demo Artist', date: '2026',
            genre: 'Demo', trackNumber: '01', discNumber: '1', composer: 'Demo Composer',
            label: 'Demo Label', codec: 'FLAC', bitrate: '920 kbps',
            sampleRate: '44100 Hz', channels: '2', bitDepth: '16',
            extension: 'flac', subsong: '0',
            details: 'Demo Artist - First Track'
        }
    },
    {
        index: 1,
        path: 'D:\\Music\\Demo Artist\\Second Track.mp3',
        fileSize: 3120000,
        formats: { duration: '00:04:18', title: 'Second Track', artist: '', details: 'Demo Artist - Second Track' }
    },
    {
        index: 2,
        path: 'D:\\Music\\Another Artist\\A Different Song.flac',
        fileSize: 4210000,
        formats: { duration: '00:05:06', title: '', artist: 'Another Artist', details: 'Another Artist - A Different Song' }
    },
    {
        index: 3,
        path: 'D:\\Music\\Soundtracks\\Theme Video.mp4',
        fileSize: 18240000,
        formats: { duration: '00:02:51', title: '', artist: '', details: 'Soundtrack - Theme Video [Video]' }
    },
    {
        index: 4,
        path: 'D:\\Music\\Demo Artist\\Last Track.ogg',
        fileSize: 2870000,
        formats: { duration: '00:03:29', title: 'Last Track', artist: 'Demo Artist', details: 'Demo Artist - Last Track' }
    }
];

function cloneTrack(track, index) {
    return {
        ...track,
        index,
        handle: track.path,
        absolutePath: track.path,
        subsong: 0
    };
}

function durationSeconds(value) {
    const parts = String(value || '').split(':').map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2 && parts.every(Number.isFinite)) {
        return parts[0] * 60 + parts[1];
    }
    return null;
}

const demoPlaylists = [{
    guid: demoPlaylistGuid,
    name: 'CrayonShell - Demo',
    tracks: demoTracks.map((track, index) => cloneTrack(track, index)),
    revision: 1,
    isLocked: false,
    isAutoplaylist: false
}];
const demoTrackCatalog = new Map(demoTracks.map((track) => [track.path, track]));

const listeners = new Map();
let focusedIndex = 0;
let selectedIndices = [0];
let playingIndex = -1;
let playingPlaylistGuid = '';
let playbackState = 'stopped';
let activePlaylistGuid = demoPlaylistGuid;
let nextPlaylistId = 1;

function emit(eventName, payload = {}) {
    const handlers = listeners.get(eventName);
    if (!handlers) return;
    handlers.forEach((handler) => handler(payload));
}

function getPlaylistIndex(guid) {
    return demoPlaylists.findIndex((playlist) => playlist.guid === guid);
}

function getPlaylist(params = {}) {
    const guid = String(params.playlistGuid || '');
    if (guid) return demoPlaylists.find((playlist) => playlist.guid === guid) || null;

    if (Number.isInteger(Number(params.playlist)) && params.playlist !== undefined) {
        return demoPlaylists[Number(params.playlist)] || null;
    }

    return demoPlaylists.find((playlist) => playlist.guid === activePlaylistGuid) || null;
}

function getPlaylists() {
    return demoPlaylists.map((playlist, index) => ({
        guid: playlist.guid,
        name: playlist.name,
        index,
        trackCount: playlist.tracks.length,
        isActive: activePlaylistGuid === playlist.guid,
        isPlaying: playingPlaylistGuid === playlist.guid && playingIndex >= 0,
        isLocked: playlist.isLocked,
        isAutoplaylist: playlist.isAutoplaylist
    }));
}

function projectTrack(track, field) {
    if (field === 'handle') return track.handle || track.path;
    if (field === 'path') return track.path;
    if (field === 'absolutePath') return track.absolutePath || track.path;
    if (field === 'subsong') return track.subsong ?? 0;
    if (field === 'duration') return durationSeconds(track.formats?.duration);
    if (field === 'fileSize') return track.fileSize ?? null;
    if (field in track) return track[field];
    return track.formats?.[field] ?? '';
}

function playlistSnapshot(playlist) {
    const index = getPlaylistIndex(playlist.guid);
    return {
        found: index >= 0,
        index,
        guid: playlist.guid,
        name: playlist.name,
        trackCount: playlist.tracks.length,
        isActive: activePlaylistGuid === playlist.guid,
        isPlaying: playingPlaylistGuid === playlist.guid && playingIndex >= 0,
        isLocked: playlist.isLocked,
        isAutoplaylist: playlist.isAutoplaylist
    };
}

export const demoBridge = {
    async invoke(method, params = {}) {
        switch (method) {
            case 'playlist.getAll':
                return { playlists: getPlaylists() };

            case 'playlist.getActive': {
                const active = demoPlaylists.find((playlist) => playlist.guid === activePlaylistGuid);
                return active ? playlistSnapshot(active) : { found: false };
            }

            case 'playlist.getPlaying': {
                const playing = demoPlaylists.find((playlist) => playlist.guid === playingPlaylistGuid);
                return playing && playingIndex >= 0
                    ? { ...playlistSnapshot(playing), isPlaying: true }
                    : { found: false };
            }

            case 'playlist.getTracks': {
                const playlist = getPlaylist(params);
                if (!playlist) throw new Error('La playlist solicitada ya no existe.');

                const start = Math.max(0, Number(params.start) || 0);
                const count = Math.max(0, Number(params.count) || playlist.tracks.length);
                const rows = playlist.tracks.slice(start, start + count);
                const tracks = Array.isArray(params.fields) && params.fields.length > 0
                    ? rows.map((track) => ({
                        index: track.index,
                        ...Object.fromEntries(params.fields.map((field) => [
                            field,
                            projectTrack(track, field)
                        ]))
                    }))
                    : rows.map((track) => cloneTrack(track, track.index));

                return {
                    playlistGuid: playlist.guid,
                    contentVersion: 'demo-content-' + playlist.revision,
                    start,
                    count: tracks.length,
                    tracks,
                    total: playlist.tracks.length
                };
            }

            case 'playlist.getTracksAt': {
                const playlist = getPlaylist(params);
                if (!playlist) throw new Error('La playlist solicitada ya no existe.');
                const rows = Array.isArray(params.rows) ? params.rows : [];
                const tracks = rows
                    .map((index) => playlist.tracks[Number(index)])
                    .filter(Boolean)
                    .map((track) => cloneTrack(track, track.index));
                return {
                    playlistGuid: playlist.guid,
                    contentVersion: 'demo-content-' + playlist.revision,
                    count: tracks.length,
                    total: playlist.tracks.length,
                    tracks
                };
            }

            case 'playlist.getFocusedTrack':
                return { index: focusedIndex };

            case 'playlist.getSelection':
                return {
                    playlistGuid: activePlaylistGuid,
                    items: [...selectedIndices],
                    count: selectedIndices.length
                };

            case 'playback.getCurrentTrack': {
                const playlist = demoPlaylists.find((entry) => entry.guid === playingPlaylistGuid);
                const current = playlist?.tracks.find((track) => track.index === playingIndex);
                if (!current) return { found: false, playing: false };

                return {
                    found: true,
                    id: current.path + '|subsong:0',
                    path: current.path,
                    absolutePath: current.path,
                    fullPath: current.path + '|subsong:0',
                    subsong: 0,
                    title: current.formats.title,
                    artist: current.formats.artist
                };
            }

            case 'playback.getCurrentTrackIndex': {
                const playlist = demoPlaylists.find((entry) => entry.guid === playingPlaylistGuid);
                const current = playlist?.tracks.find((track) => track.index === playingIndex);
                const response = {
                    found: Boolean(current),
                    playlist: current ? getPlaylistIndex(playingPlaylistGuid) : null,
                    playlistGuid: current ? playingPlaylistGuid : null,
                    index: current ? playingIndex : null
                };
                if (params.includeTrackInfo && current) {
                    response.track = {
                        handle: current.handle || current.path,
                        path: current.path,
                        absolutePath: current.absolutePath || current.path,
                        subsong: 0,
                        title: current.formats.title,
                        artist: current.formats.artist
                    };
                }
                return response;
            }

            case 'playback.getState':
                return { state: playbackState };

            case 'playlist.setSelection': {
                const playlist = getPlaylist(params);
                if (!playlist) throw new Error('La playlist solicitada ya no existe.');
                selectedIndices = Array.isArray(params.indices)
                    ? params.indices.map(Number).filter((index) => (
                        Number.isInteger(index) && index >= 0 && index < playlist.tracks.length
                    ))
                    : [];
                emit('playlist:selectionChanged', { playlist: getPlaylistIndex(playlist.guid) });
                return { success: true };
            }

            case 'playlist.setFocusedTrack': {
                const playlist = getPlaylist(params);
                if (!playlist) throw new Error('La playlist solicitada ya no existe.');
                const previous = focusedIndex;
                focusedIndex = Number(params.index);
                emit('playlist:focusChanged', {
                    playlist: getPlaylistIndex(playlist.guid),
                    from: previous,
                    to: focusedIndex
                });
                return { success: true };
            }

            case 'playlist.setActive': {
                const target = demoPlaylists.find((playlist) => playlist.guid === params.playlistGuid);
                if (!target) throw new Error('La playlist solicitada ya no existe.');
                const oldIndex = getPlaylistIndex(activePlaylistGuid);
                activePlaylistGuid = target.guid;
                focusedIndex = -1;
                selectedIndices = [];
                emit('playlist:activated', {
                    newGuid: activePlaylistGuid,
                    newIndex: getPlaylistIndex(activePlaylistGuid),
                    oldIndex
                });
                return { success: true };
            }

            case 'playlist.create': {
                const guid = 'crayonshell-demo-playlist-' + nextPlaylistId++;
                const playlist = {
                    guid,
                    name: String(params.name || 'New Playlist'),
                    tracks: [],
                    revision: 1,
                    isLocked: false,
                    isAutoplaylist: false
                };
                demoPlaylists.push(playlist);
                emit('playlist:created', { playlistGuid: guid });
                return { guid, index: getPlaylistIndex(guid) };
            }

            case 'playlist.rename': {
                const playlist = getPlaylist(params);
                if (!playlist) throw new Error('La playlist solicitada ya no existe.');
                if (playlist.isLocked) throw new Error('La playlist está bloqueada.');
                playlist.name = String(params.name || '').trim() || playlist.name;
                emit('playlist:renamed', { playlistGuid: playlist.guid });
                return { success: true, name: playlist.name };
            }

            case 'playlist.remove': {
                const playlist = getPlaylist(params);
                if (!playlist) throw new Error('La playlist solicitada ya no existe.');
                if (playlist.isLocked) throw new Error('La playlist está bloqueada.');
                const removedIndex = getPlaylistIndex(playlist.guid);
                const wasActive = playlist.guid === activePlaylistGuid;
                const wasPlaying = playlist.guid === playingPlaylistGuid;
                demoPlaylists.splice(removedIndex, 1);
                playlist.revision += 1;
                emit('playlist:removed', { playlistGuid: playlist.guid, index: removedIndex });

                if (wasPlaying) {
                    playingPlaylistGuid = '';
                    playingIndex = -1;
                    playbackState = 'stopped';
                    emit('playback:stopped', { state: playbackState });
                }

                if (wasActive) {
                    const nextActive = demoPlaylists[Math.min(removedIndex, demoPlaylists.length - 1)] || null;
                    activePlaylistGuid = nextActive?.guid || '';
                    focusedIndex = -1;
                    selectedIndices = [];
                    emit('playlist:activated', {
                        newGuid: activePlaylistGuid,
                        newIndex: nextActive ? getPlaylistIndex(activePlaylistGuid) : -1,
                        oldIndex: removedIndex
                    });
                }
                return { success: true };
            }

            case 'playlist.addHandles': {
                const playlist = getPlaylist(params);
                if (!playlist) throw new Error('La playlist destino ya no existe.');
                const handles = Array.isArray(params.handles) ? params.handles : [];
                const added = [];
                handles.forEach((value) => {
                    const handle = String(value || '').replace(/\|subsong:\d+$/i, '');
                    const source = demoTrackCatalog.get(handle);
                    if (!source) return;
                    const clone = cloneTrack(source, playlist.tracks.length);
                    playlist.tracks.push(clone);
                    added.push(clone);
                });
                if (added.length > 0) {
                    playlist.revision += 1;
                    emit('playlist:itemsAdded', {
                        playlistGuid: playlist.guid,
                        count: added.length,
                        newCount: playlist.tracks.length
                    });
                }
                return {
                    success: true,
                    addedCount: added.length,
                    newCount: playlist.tracks.length
                };
            }

            case 'playlist.undo':
                return {
                    success: false,
                    code: 'NOT_FOUND',
                    error: 'No hay historial de deshacer disponible en la playlist de demostración.'
                };

            case 'playlist.playTrack': {
                const playlist = getPlaylist(params);
                if (!playlist) throw new Error('La playlist solicitada ya no existe.');
                const index = Number(params.index);
                if (!Number.isInteger(index) || index < 0 || index >= playlist.tracks.length) {
                    throw new Error('El índice de pista no es válido.');
                }
                playingPlaylistGuid = playlist.guid;
                playingIndex = index;
                focusedIndex = index;
                selectedIndices = [index];
                playbackState = 'playing';
                emit('playback:trackChanged', { index });
                emit('playback:stateChanged', { state: playbackState });
                return { success: true };
            }

            case 'menu.showNativePopup':
                return { success: true };

            default:
                throw new Error('La operación de demostración no está implementada: ' + method);
        }
    },

    on(eventName, handler) {
        if (!listeners.has(eventName)) {
            listeners.set(eventName, new Set());
        }

        const handlers = listeners.get(eventName);
        handlers.add(handler);

        return () => {
            handlers.delete(handler);
            if (handlers.size === 0) listeners.delete(eventName);
        };
    },

    off(eventName, handler) {
        const handlers = listeners.get(eventName);
        if (!handlers) return;

        handlers.delete(handler);
        if (handlers.size === 0) listeners.delete(eventName);
    }
};
