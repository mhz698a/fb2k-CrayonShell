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
                return {
                    tracks: demoTracks.slice(start, start + count),
                    total: demoTracks.length
                };
            }

            case 'playlist.getFocusedTrack':
                return { index: focusedIndex };

            case 'playback.getCurrentTrackIndex':
                return {
                    found: playingIndex >= 0,
                    playlistGuid: activePlaylistGuid,
                    index: playingIndex
                };

            case 'playback.getState':
                return { state: playbackState };

            case 'playlist.setSelection':
                return { success: true };

            case 'playlist.setFocusedTrack':
                focusedIndex = Number(params.index);
                emit('playlist:focusChanged', { index: focusedIndex });
                return { success: true };

            case 'playlist.setActive':
                activePlaylistGuid = params.playlistGuid;
                emit('playlist:activated', { playlistGuid: activePlaylistGuid });
                return { success: true };

            case 'playlist.playTrack':
                playingIndex = Number(params.index);
                focusedIndex = playingIndex;
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
