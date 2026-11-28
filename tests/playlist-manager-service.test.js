import test from 'node:test';
import assert from 'node:assert/strict';
import {
    copyPlaylistToClipboard,
    formatByteSize,
    loadPlaylistStatistics,
    parsePlaylistClipboard,
    pastePlaylistFromClipboard
} from '../src/features/playlistManager/playlistManagerService.js';
import { rankPlaylistItems } from '../src/features/playlistManager/spotlightSearch.js';

test('playlist statistics aggregate duration and file sizes across pages', async () => {
    const calls = [];
    const invoke = async (method, params) => {
        calls.push({ method, params });
        const rows = params.start === 0
            ? [
                { duration: '00:01:30', fileSize: 1024 },
                { duration: 45, fileSize: 2048 }
            ]
            : [{ duration: null, fileSize: null }];

        return {
            playlistGuid: 'playlist-a',
            contentVersion: 'version-1',
            total: 3,
            tracks: rows
        };
    };

    const stats = await loadPlaylistStatistics(
        { guid: 'playlist-a', trackCount: 3 },
        { invoke, pageSize: 2 }
    );

    assert.equal(stats.trackCount, 3);
    assert.equal(stats.durationSeconds, 135);
    assert.equal(stats.fileSizeBytes, 3072);
    assert.equal(stats.knownSizeCount, 2);
    assert.equal(stats.unknownSizeCount, 1);
    assert.equal(stats.unknownDurationCount, 1);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].params.fields, ['duration', 'fileSize']);
});

test('playlist statistics retry once when the playlist changes between pages', async () => {
    let callCount = 0;
    const invoke = async (_method, params) => {
        callCount += 1;
        const version = callCount <= 2 ? (params.start === 0 ? 'old' : 'new') : 'stable';
        return {
            playlistGuid: 'playlist-a',
            contentVersion: version,
            total: 2,
            tracks: [{ duration: 30, fileSize: 100 }]
        };
    };

    const stats = await loadPlaylistStatistics(
        { guid: 'playlist-a', trackCount: 2 },
        { invoke, pageSize: 1 }
    );

    assert.equal(stats.durationSeconds, 60);
    assert.equal(stats.fileSizeBytes, 200);
    assert.equal(callCount, 4);
});

test('copy stores playlist handles before removing a cut playlist', async () => {
    let clipboard = '';
    const order = [];
    const invoke = async (method, params) => {
        order.push(method);
        if (method === 'playlist.getTracks') {
            return {
                playlistGuid: params.playlistGuid,
                contentVersion: 'version-1',
                total: 2,
                tracks: params.start === 0
                    ? [{ handle: 'track-1' }]
                    : [{ handle: 'track-2' }]
            };
        }
        if (method === 'playlist.remove') return { success: true };
        throw new Error('Unexpected method: ' + method);
    };

    const result = await copyPlaylistToClipboard(
        { guid: 'playlist-a', name: 'Favorites', trackCount: 2 },
        {
            invoke,
            operation: 'cut',
            pageSize: 1,
            writeText: async (text) => {
                clipboard = text;
                order.push('clipboard.write');
            }
        }
    );

    assert.equal(result.operation, 'cut');
    assert.deepEqual(order, [
        'playlist.getTracks',
        'playlist.getTracks',
        'clipboard.write',
        'playlist.remove'
    ]);
    assert.deepEqual(parsePlaylistClipboard(clipboard).handles, ['track-1', 'track-2']);
});

test('paste recreates a copied playlist and preserves its track handles', async () => {
    let clipboard = '';
    const calls = [];
    const sourceInvoke = async (method, params) => {
        if (method === 'playlist.getTracks') {
            return {
                playlistGuid: params.playlistGuid,
                contentVersion: 'version-1',
                total: 2,
                tracks: [{ handle: 'one' }, { handle: 'two' }]
            };
        }
        throw new Error('Unexpected source method: ' + method);
    };

    await copyPlaylistToClipboard(
        { guid: 'source', name: 'Mix', trackCount: 2 },
        { invoke: sourceInvoke, writeText: async (text) => { clipboard = text; } }
    );

    const invoke = async (method, params) => {
        calls.push({ method, params });
        if (method === 'playlist.create') return { guid: 'created' };
        if (method === 'playlist.addHandles') {
            return { addedCount: params.handles.length };
        }
        throw new Error('Unexpected method: ' + method);
    };

    const result = await pastePlaylistFromClipboard({
        invoke,
        readText: async () => clipboard
    });

    assert.equal(result.guid, 'created');
    assert.equal(result.name, 'Mix (Copy)');
    assert.equal(result.trackCount, 2);
    assert.deepEqual(calls[1].params.handles, ['one', 'two']);
});

test('paste clears the clipboard after consuming a cut playlist', async () => {
    const payload = {
        schema: 1,
        kind: 'crayonshell.playlist',
        operation: 'cut',
        name: 'Moved',
        sourceGuid: 'old',
        handles: ['track']
    };
    let clipboard = 'CRAYONSHELL_PLAYLIST_CLIPBOARD:' + JSON.stringify(payload);
    const invoke = async (method) => {
        if (method === 'playlist.create') return { guid: 'restored' };
        if (method === 'playlist.addHandles') return { addedCount: 1 };
        throw new Error('Unexpected method: ' + method);
    };

    await pastePlaylistFromClipboard({
        invoke,
        readText: async () => clipboard,
        writeText: async (text) => { clipboard = text; }
    });

    assert.equal(clipboard, '');
});

test('paste removes the newly created playlist if adding tracks fails', async () => {
    const payload = {
        schema: 1,
        kind: 'crayonshell.playlist',
        operation: 'copy',
        name: 'Broken',
        sourceGuid: 'old',
        handles: ['missing']
    };
    const clipboard = 'CRAYONSHELL_PLAYLIST_CLIPBOARD:' + JSON.stringify(payload);
    const calls = [];
    const invoke = async (method) => {
        calls.push(method);
        if (method === 'playlist.create') return { guid: 'partial' };
        if (method === 'playlist.addHandles') throw new Error('Missing handle');
        if (method === 'playlist.remove') return { success: true };
        throw new Error('Unexpected method: ' + method);
    };

    await assert.rejects(
        pastePlaylistFromClipboard({ invoke, readText: async () => clipboard }),
        /Missing handle/
    );
    assert.deepEqual(calls, ['playlist.create', 'playlist.addHandles', 'playlist.remove']);
});

test('formatByteSize uses binary units', () => {
    assert.equal(formatByteSize(0), '0 B');
    assert.equal(formatByteSize(1024), '1.00 KB');
    assert.equal(formatByteSize(1048576), '1.00 MB');
});

test('spotlight search is empty for a blank query and ranks fuzzy matches', () => {
    const items = [
        { index: 0, title: 'Long Road', artist: 'The Band', details: '', path: '' },
        { index: 1, title: 'Road', artist: 'Long', details: '', path: '' },
        { index: 2, title: 'Another Song', artist: 'Artist', details: '', path: '' }
    ];

    assert.deepEqual(rankPlaylistItems(items, ''), []);
    const results = rankPlaylistItems(items, 'road long');
    assert.deepEqual(results.map((item) => item.index), [1, 0]);
});
