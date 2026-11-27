import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeTrackPath,
    trackPathsMatch,
    resolvePlayingTrackIndex
} from './trackIdentity.js';

test('normalizes Windows paths without case or slash differences', () => {
    assert.deepEqual(
        normalizeTrackPath('D:/Music/Artist/Track.FLAC'),
        { path: 'd:\\music\\artist\\track.flac', subsong: null }
    );
    assert.equal(
        trackPathsMatch('D:\\Music\\Artist\\Track.FLAC', 'd:/music/artist/track.flac'),
        true
    );
});

test('decodes local file URLs and normalizes the drive prefix', () => {
    assert.deepEqual(
        normalizeTrackPath('file:///D:/Music/Artist/Track%20One.flac'),
        { path: 'd:\\music\\artist\\track one.flac', subsong: null }
    );
});

test('normalizes UNC file URLs without losing the network prefix', () => {
    assert.deepEqual(
        normalizeTrackPath('file://nas-server/Music/Track.flac'),
        { path: '\\\\nas-server\\music\\track.flac', subsong: null }
    );
});

test('keeps distinct subsongs separate while allowing a path-only match', () => {
    assert.equal(trackPathsMatch('D:\\Audio\\Album.flac|subsong:1', 'd:/audio/album.flac|subsong:1'), true);
    assert.equal(trackPathsMatch('D:\\Audio\\Album.flac|subsong:1', 'D:\\Audio\\Album.flac|subsong:2'), false);
    assert.equal(trackPathsMatch('D:\\Audio\\Album.flac|subsong:1', 'D:\\Audio\\Album.flac'), true);
    assert.equal(trackPathsMatch('D:\\Audio\\Album.flac', 'D:\\Audio\\Album.flac', 2, 2), true);
    assert.equal(trackPathsMatch('D:\\Audio\\Album.flac', 'D:\\Audio\\Album.flac', 1, 2), false);
});

test('prefers a native index belonging to the active playlist', () => {
    assert.equal(resolvePlayingTrackIndex({
        items: [{ index: 5, path: 'D:\\Music\\A.flac' }],
        playingTrackIndex: { found: true, playlistGuid: 'active', index: 5 },
        currentTrackResponse: { found: true, track: { path: 'D:\\Music\\A.flac' } },
        activePlaylistGuid: 'active',
        playbackState: 'playing'
    }), 5);
});

test('rejects a stale native index when its row path conflicts with the current track', () => {
    assert.equal(resolvePlayingTrackIndex({
        items: [
            { index: 0, path: 'D:\\Music\\Previous.flac' },
            { index: 1, path: 'D:\\Music\\Current.flac' }
        ],
        playingTrackIndex: { found: true, playlistGuid: 'active', index: 0 },
        currentTrackResponse: {
            found: true,
            track: { path: 'D:\\Music\\Current.flac' }
        },
        activePlaylistGuid: 'active',
        playbackState: 'playing'
    }), 1);
});

test('falls back to a route match when the native index belongs to another playlist', () => {
    assert.equal(resolvePlayingTrackIndex({
        items: [
            { index: 0, path: 'D:\\Music\\First.flac' },
            { index: 8, path: 'D:\\Music\\Current.flac' }
        ],
        playingTrackIndex: { found: true, playlistGuid: 'other', index: 2 },
        currentTrackResponse: {
            found: true,
            track: { absolutePath: 'file:///D:/Music/Current.flac' }
        },
        activePlaylistGuid: 'active',
        playbackState: 'playing'
    }), 8);
});

test('prefers a matching native handle over duplicate file paths', () => {
    assert.equal(resolvePlayingTrackIndex({
        items: [
            { index: 1, handle: 'handle-a', path: 'D:\\Music\\Track.flac' },
            { index: 7, handle: 'handle-b', path: 'D:\\Music\\Track.flac' }
        ],
        currentTrackResponse: {
            found: true,
            track: { handle: 'handle-b', path: 'D:\\Music\\Track.flac' }
        },
        activePlaylistGuid: 'active',
        playbackState: 'playing'
    }), 7);
});

test('uses subsong metadata to distinguish rows that share one container path', () => {
    assert.equal(resolvePlayingTrackIndex({
        items: [
            { index: 3, path: 'D:\\Music\\Cue.flac', subsong: 1 },
            { index: 4, path: 'D:\\Music\\Cue.flac', subsong: 2 }
        ],
        currentTrackResponse: {
            found: true,
            track: { path: 'D:\\Music\\Cue.flac', subsong: 2 }
        },
        activePlaylistGuid: 'active',
        playbackState: 'playing'
    }), 4);
});

test('does not mark a track after Stop or when no path can be matched', () => {
    const input = {
        items: [{ index: 0, path: 'D:\\Music\\Track.flac' }],
        currentTrackResponse: { found: true, track: { path: 'D:\\Music\\Other.flac' } },
        activePlaylistGuid: 'active'
    };
    assert.equal(resolvePlayingTrackIndex({ ...input, playbackState: 'stopped' }), -1);
    assert.equal(resolvePlayingTrackIndex({ ...input, playbackState: 'playing' }), -1);
});

test('resolves the flat SDK track response and its numeric playing-playlist index', () => {
    assert.equal(resolvePlayingTrackIndex({
        items: [{
            index: 9,
            path: 'D:\\Music\\Current.flac',
            absolutePath: 'D:\\Music\\Current.flac',
            subsong: 1
        }],
        playingTrackIndex: { found: true, playlist: 2, index: 9 },
        playlists: [{ index: 2, guid: 'active' }],
        currentTrackResponse: {
            id: 'D:\\Music\\Current.flac|subsong:1',
            path: 'file:///D:/Music/Current.flac',
            absolutePath: 'D:\\Music\\Current.flac',
            fullPath: 'D:\\Music\\Current.flac|subsong:1',
            subsong: 1
        },
        activePlaylistGuid: 'active',
        playbackState: 'playing'
    }), 9);
});

test('matches the flat SDK track identity when its playing playlist is different', () => {
    assert.equal(resolvePlayingTrackIndex({
        items: [
            { index: 0, path: 'D:\\Music\\Other.flac' },
            { index: 8, path: 'D:\\Music\\Current.flac', subsong: 0 }
        ],
        playingTrackIndex: { found: true, playlist: 0, index: 3 },
        playlists: [{ index: 0, guid: 'playing-playlist' }],
        currentTrackResponse: {
            id: 'D:\\Music\\Current.flac|subsong:0'
        },
        activePlaylistGuid: 'active-playlist',
        playbackState: 'playing'
    }), 8);
});
