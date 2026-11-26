import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PLAYLIST_SESSION_STORAGE_KEY,
    buildPlaylistSession,
    normalizePlaylistSession,
    readPlaylistSession,
    resolveSavedFocusIndex,
    writePlaylistSession
} from '../src/services/playlistSession.js';

function createStorage() {
    const values = new Map();
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); }
    };
}

test('playlist session is serialized and read back with a strict versioned shape', () => {
    const storage = createStorage();
    const session = buildPlaylistSession('{playlist-guid}', 2, [
        { index: 2, handle: 'D:/Music/track.flac|subsong:1', path: 'D:/Music/track.flac', title: 'Track' }
    ]);

    assert.equal(writePlaylistSession(session, storage), true);
    assert.equal(storage.getItem(PLAYLIST_SESSION_STORAGE_KEY) !== null, true);
    assert.deepEqual(readPlaylistSession(storage), session);
});

test('invalid and unsupported session versions are ignored', () => {
    assert.equal(normalizePlaylistSession({ version: 2, playlistGuid: 'x' }), null);
    assert.equal(normalizePlaylistSession({ version: 1, playlistGuid: '' }), null);
});

test('saved focus follows a stable handle when playlist rows are reordered', () => {
    const session = buildPlaylistSession('{playlist-guid}', 1, [
        { index: 1, handle: 'D:/Music/B.flac', path: 'D:/Music/B.flac', title: 'B' }
    ]);
    const tracks = [
        { index: 0, handle: 'D:/Music/A.flac', path: 'D:/Music/A.flac', title: 'A' },
        { index: 3, handle: 'D:/Music/B.flac', path: 'D:/Music/B.flac', title: 'B' }
    ];

    assert.equal(resolveSavedFocusIndex(session, '{playlist-guid}', tracks), 3);
});

test('saved focus falls back to a case-insensitive file path when the handle changes', () => {
    const session = {
        version: 1,
        playlistGuid: '{playlist-guid}',
        focusedItem: 4,
        focusedHandle: 'old-handle',
        focusedPath: 'D:/Music/Track.flac',
        focusedTitle: 'Track'
    };

    assert.equal(resolveSavedFocusIndex(session, '{playlist-guid}', [
        { index: 0, handle: 'other', path: 'D:/Music/Other.flac' },
        { index: 2, handle: 'new-handle', path: 'd:/music/track.flac' }
    ]), 2);
});

test('session restoration does not cross playlist GUIDs', () => {
    const session = buildPlaylistSession('{playlist-a}', 0, [
        { index: 0, path: 'D:/Music/A.flac', title: 'A' }
    ]);

    assert.equal(resolveSavedFocusIndex(session, '{playlist-b}', [
        { index: 0, path: 'D:/Music/A.flac', title: 'A' }
    ]), -1);
});
