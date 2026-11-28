import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyPlaylistActivationSelection,
    readPlaylistActivationSnapshot,
    resolvePlaylistActivationSnapshot
} from './playlistActivationController.js';

const tracks = [
    { index: 0, handle: 'track-a' },
    { index: 7, handle: 'track-playing' }
];

test('selects the exact playing row only when its source playlist GUID matches the target', () => {
    const snapshot = resolvePlaylistActivationSnapshot({
        requestedPlaylistGuid: '{PLAYLIST-A}',
        activePlaylist: { guid: 'playlist-a' },
        playingLocation: {
            found: true,
            playlistGuid: '{playlist-a}',
            playlist: 1,
            index: 7
        },
        playingPlaylist: { found: true, guid: 'playlist-a', index: 1 },
        playback: { state: 'playing' },
        nativeFocus: { index: 0 },
        items: tracks
    });

    assert.equal(snapshot.activeMatches, true);
    assert.equal(snapshot.locatedTrackIndex, 7);
    assert.equal(snapshot.playingItemIndex, 7);
    assert.equal(snapshot.selectionIndex, 7);
    assert.equal(snapshot.selectionSource, 'playing-location');
});

test('does not match a same-path or same-handle row from a different playlist', () => {
    const snapshot = resolvePlaylistActivationSnapshot({
        requestedPlaylistGuid: 'playlist-b',
        activePlaylist: { guid: 'playlist-b' },
        playingLocation: {
            found: true,
            playlistGuid: 'playlist-a',
            playlist: 0,
            index: 7,
            track: { handle: 'track-playing' }
        },
        playingPlaylist: { found: true, guid: 'playlist-a', index: 0 },
        playback: { state: 'playing' },
        nativeFocus: { index: 0 },
        items: tracks
    });

    assert.equal(snapshot.locatedTrackIndex, -1);
    assert.equal(snapshot.playingItemIndex, -1);
    assert.equal(snapshot.selectionIndex, 0);
    assert.equal(snapshot.selectionSource, 'native-focus');
});

test('uses the playing playlist GUID as a compatibility fallback for index-only locations', () => {
    const snapshot = resolvePlaylistActivationSnapshot({
        requestedPlaylistGuid: 'playlist-a',
        activePlaylist: { guid: 'playlist-a' },
        playingLocation: {
            found: true,
            playlist: 1,
            index: 7
        },
        playingPlaylist: { found: true, guid: 'playlist-a', index: 1 },
        playback: { state: 'paused' },
        nativeFocus: { index: 0 },
        items: tracks
    });

    assert.equal(snapshot.playingPlaylistGuid, 'playlist-a');
    assert.equal(snapshot.locatedTrackIndex, 7);
    assert.equal(snapshot.playingItemIndex, 7);
});

test('rejects an activation snapshot when foobar2000 has another active playlist', () => {
    const snapshot = resolvePlaylistActivationSnapshot({
        requestedPlaylistGuid: 'playlist-a',
        activePlaylist: { guid: 'playlist-b' },
        playingLocation: { found: true, playlistGuid: 'playlist-a', index: 7 },
        playback: { state: 'playing' },
        nativeFocus: { index: 0 },
        items: tracks
    });

    assert.equal(snapshot.activeMatches, false);
    assert.equal(snapshot.selectionIndex, 7);
});

test('does not resolve a playing row when the native index is absent from the loaded rows', () => {
    const snapshot = resolvePlaylistActivationSnapshot({
        requestedPlaylistGuid: 'playlist-a',
        activePlaylist: { guid: 'playlist-a' },
        playingLocation: { found: true, playlistGuid: 'playlist-a', index: 99 },
        playback: { state: 'playing' },
        nativeFocus: { index: 0 },
        items: tracks
    });

    assert.equal(snapshot.locatedTrackIndex, -1);
    assert.equal(snapshot.selectionIndex, 0);
});

test('applies native selection before focus and verifies both separately', async () => {
    const calls = [];
    const invoke = async (method, params = {}) => {
        calls.push(method);
        if (method === 'playlist.getActive') return { found: true, guid: 'playlist-a' };
        if (method === 'playlist.getSelection') return { items: [7] };
        if (method === 'playlist.getFocusedTrack') return { index: 7 };
        return { success: true };
    };

    const result = await applyPlaylistActivationSelection({
        invoke,
        playlistGuid: 'playlist-a',
        index: 7
    });

    assert.deepEqual(calls, [
        'playlist.getActive',
        'playlist.setSelection',
        'playlist.setFocusedTrack',
        'playlist.getSelection',
        'playlist.getFocusedTrack'
    ]);
    assert.equal(result.applied, true);
    assert.equal(result.selectionMatches, true);
    assert.equal(result.focusMatches, true);
});

test('does not write selection when the target playlist is no longer active', async () => {
    const calls = [];
    const result = await applyPlaylistActivationSelection({
        playlistGuid: 'playlist-a',
        index: 7,
        invoke: async (method) => {
            calls.push(method);
            return { guid: 'playlist-b' };
        }
    });

    assert.deepEqual(calls, ['playlist.getActive']);
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'active-playlist-changed');
});

test('reads the active playlist after the playback and focus snapshot', async () => {
    const calls = [];
    const invoke = async (method) => {
        calls.push(method);
        if (method === 'playback.getCurrentTrackIndex') {
            return { found: true, playlistGuid: 'playlist-a', index: 7 };
        }
        if (method === 'playlist.getPlaying') {
            return { found: true, guid: 'playlist-a', index: 0 };
        }
        if (method === 'playback.getState') return { state: 'playing' };
        if (method === 'playlist.getFocusedTrack') return { index: 0 };
        if (method === 'playlist.getActive') return { found: true, guid: 'playlist-a' };
        return {};
    };

    const snapshot = await readPlaylistActivationSnapshot({
        invoke,
        playlistGuid: 'playlist-a',
        items: tracks
    });

    assert.equal(calls.at(-1), 'playlist.getActive');
    assert.equal(snapshot.selectionIndex, 7);
});

test('guards Facets content selection and focus writes with the reconciled content version', async () => {
    const writes = [];
    const invoke = async (method, params = {}) => {
        if (method === 'playlist.getActive') return { found: true, guid: 'playlist-a' };
        if (method === 'playlist.setSelection' || method === 'playlist.setFocusedTrack') {
            writes.push({ method, params });
            return { success: true };
        }
        if (method === 'playlist.getSelection') return { items: [8] };
        if (method === 'playlist.getFocusedTrack') return { index: 8 };
        return {};
    };

    const result = await applyPlaylistActivationSelection({
        invoke,
        playlistGuid: 'playlist-a',
        index: 8,
        expectedVersion: 'facets-content-v12'
    });

    assert.equal(result.applied, true);
    assert.deepEqual(writes, [
        {
            method: 'playlist.setSelection',
            params: {
                playlistGuid: 'playlist-a',
                indices: [8],
                clearOthers: true,
                expectedVersion: 'facets-content-v12'
            }
        },
        {
            method: 'playlist.setFocusedTrack',
            params: {
                playlistGuid: 'playlist-a',
                index: 8,
                expectedVersion: 'facets-content-v12'
            }
        }
    ]);
});

test('does not continue to focus a row when the Facets content version became stale', async () => {
    const calls = [];
    const invoke = async (method, params = {}) => {
        calls.push(method);
        if (method === 'playlist.getActive') return { found: true, guid: 'playlist-a' };
        if (method === 'playlist.setSelection') {
            const error = new Error('content changed');
            error.code = 'STALE_TARGET';
            throw error;
        }
        return {};
    };

    await assert.rejects(
        applyPlaylistActivationSelection({
            invoke,
            playlistGuid: 'playlist-a',
            index: 8,
            expectedVersion: 'old-content-version'
        }),
        (error) => error.code === 'STALE_TARGET'
    );
    assert.deepEqual(calls, ['playlist.getActive', 'playlist.setSelection']);
});
