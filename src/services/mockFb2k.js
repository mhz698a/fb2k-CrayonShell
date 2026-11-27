const demoPlaylistGuid = 'crayonshell-demo-playlist';

const demoTracks = [
    {
        index: 0,
        path: 'D:\\Music\\Demo Artist\\First Track.flac',
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
        formats: { duration: '00:04:18', title: 'Second Track', artist: '', details: 'Demo Artist - Second Track' }
    },
    {
        index: 2,
        path: 'D:\\Music\\Another Artist\\A Different Song.flac',
        formats: { duration: '00:05:06', title: '', artist: 'Another Artist', details: 'Another Artist - A Different Song' }
    },
    {
        index: 3,
        path: 'D:\\Music\\Soundtracks\\Theme Video.mp4',
        formats: { duration: '00:02:51', title: '', artist: '', details: 'Soundtrack - Theme Video [Video]' }
    },
    {
        index: 4,
        path: 'D:\\Music\\Demo Artist\\Last Track.ogg',
        formats: { duration: '00:03:29', title: 'Last Track', artist: 'Demo Artist', details: 'Demo Artist - Last Track' }
    }
];

const listeners = new Map();
let focusedIndex = 0;
let selectedIndices = [0];
let playingIndex = -1;
let playbackState = 'stopped';
let activePlaylistGuid = demoPlaylistGuid;

function emit(eventName, payload = {}) {
    const handlers = listeners.get(eventName);

    if (!handlers) return;

    handlers.forEach((handler) => handler(payload));
}

function getPlaylists() {
    return [{
        guid: demoPlaylistGuid,
        name: 'CrayonShell - Demo',
        index: 0,
        trackCount: demoTracks.length,
        isActive: activePlaylistGuid === demoPlaylistGuid
    }];
}

export const demoBridge = {
    async invoke(method, params = {}) {
        switch (method) {
            case 'playlist.getAll':
                return { playlists: getPlaylists() };

            case 'playlist.getTracks': {
                const start = Number(params.start) || 0;
                const count = Number(params.count) || demoTracks.length;
                const rows = demoTracks.slice(start, start + count).map((track) => ({
                    ...track,
                    handle: track.path,
                    absolutePath: track.path,
                    subsong: 0
                }));
                const tracks = Array.isArray(params.fields) && params.fields.length > 0
                    ? rows.map((track) => ({
                        index: track.index,
                        ...Object.fromEntries(params.fields.map((field) => [field, track[field]]))
                    }))
                    : rows;

                return {
                    playlistGuid: demoPlaylistGuid,
                    contentVersion: 'demo-content-v1',
                    start,
                    count: tracks.length,
                    tracks,
                    total: demoTracks.length
                };
            }

            case 'playlist.getTracksAt': {
                const rows = Array.isArray(params.rows) ? params.rows : [];
                const tracks = rows
                    .map((index) => demoTracks.find((track) => track.index === Number(index)))
                    .filter(Boolean)
                    .map((track) => ({
                        ...track,
                        handle: track.path,
                        absolutePath: track.path,
                        subsong: 0
                    }));
                return {
                    playlistGuid: demoPlaylistGuid,
                    contentVersion: 'demo-content-v1',
                    count: tracks.length,
                    total: demoTracks.length,
                    tracks
                };
            }

            case 'playlist.getFocusedTrack':
                return { index: focusedIndex };

            case 'playlist.getSelection':
                return {
                    playlistGuid: demoPlaylistGuid,
                    items: [...selectedIndices],
                    count: selectedIndices.length
                };

            case 'playback.getCurrentTrack': {
                const current = demoTracks.find((track) => track.index === playingIndex);
                return {
                    found: Boolean(current),
                    track: current ? {
                        path: current.path,
                        absolutePath: current.path,
                        title: current.formats.title,
                        artist: current.formats.artist
                    } : null
                };
            }

            case 'playback.getCurrentTrackIndex':
                return {
                    found: playingIndex >= 0,
                    playlistGuid: activePlaylistGuid,
                    index: playingIndex
                };

            case 'playback.getState':
                return { state: playbackState };

            case 'playlist.setSelection':
                selectedIndices = Array.isArray(params.indices)
                    ? params.indices.map(Number).filter(Number.isInteger)
                    : [];
                return { success: true };

            case 'playlist.setFocusedTrack': {
                const previous = focusedIndex;
                focusedIndex = Number(params.index);
                emit('playlist:focusChanged', {
                    playlistGuid: demoPlaylistGuid,
                    from: previous,
                    to: focusedIndex
                });
                return { success: true };
            }

            case 'playlist.setActive':
                activePlaylistGuid = params.playlistGuid;
                emit('playlist:activated', { playlistGuid: activePlaylistGuid });
                return { success: true };

            case 'playlist.playTrack':
                playingIndex = Number(params.index);
                focusedIndex = playingIndex;
                selectedIndices = [playingIndex];
                playbackState = 'playing';
                emit('playback:trackChanged', { index: playingIndex });
                emit('playback:stateChanged', { state: playbackState });
                return { success: true };

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
