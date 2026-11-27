import test from 'node:test';
import assert from 'node:assert/strict';
import {
    reconcilePlaylistItems,
    resolveInitialSelectionIndex,
    resolvePinnedSelectionIndex,
    resolveActivatedPlaylistGuid,
    resolvePlaylistGuidFromEvent,
    shouldIgnorePinnedFocusChange
} from './playlistReconciliation.js';

const track = (index, handle, title = handle) => ({
    index,
    handle,
    path: handle,
    title
});

test('reuses unchanged playlist rows without replacing their objects', () => {
    const first = track(0, 'A');
    const second = track(1, 'B');
    const result = reconcilePlaylistItems({
        currentItems: [first, second],
        identityRows: [{ index: 0, handle: 'A' }, { index: 1, handle: 'B' }]
    });

    assert.equal(result[0], first);
    assert.equal(result[1], second);
});

test('updates indices while preserving existing row metadata after insertion', () => {
    const first = track(0, 'A', 'Original A');
    const second = track(1, 'B', 'Original B');
    const inserted = track(1, 'X', 'New X');
    const result = reconcilePlaylistItems({
        currentItems: [first, second],
        identityRows: [
            { index: 0, handle: 'A' },
            { index: 1, handle: 'X' },
            { index: 2, handle: 'B' }
        ],
        hydratedItems: [inserted]
    });

    assert.deepEqual(result.map((item) => [item.index, item.handle, item.title]), [
        [0, 'A', 'Original A'],
        [1, 'X', 'New X'],
        [2, 'B', 'Original B']
    ]);
    assert.equal(result[0], first);
    assert.equal(result[2].title, 'Original B');
});

test('drops removed rows and compacts the surviving indices', () => {
    const first = track(0, 'A');
    const removed = track(1, 'B');
    const last = track(2, 'C');
    const result = reconcilePlaylistItems({
        currentItems: [first, removed, last],
        identityRows: [
            { index: 0, handle: 'A' },
            { index: 1, handle: 'C' }
        ]
    });

    assert.deepEqual(result.map((item) => [item.index, item.handle]), [
        [0, 'A'],
        [1, 'C']
    ]);
    assert.equal(result[0], first);
    assert.equal(result[1].title, last.title);
    assert.notEqual(result[1], last);
});

test('hydrates only identities that were added or replaced', () => {
    const unchanged = track(0, 'A');
    const replacement = track(1, 'C', 'Replacement');
    const result = reconcilePlaylistItems({
        currentItems: [unchanged, track(1, 'B')],
        identityRows: [
            { index: 0, handle: 'A' },
            { index: 1, handle: 'C' }
        ],
        hydratedItems: [replacement]
    });

    assert.equal(result[0], unchanged);
    assert.equal(result[1], replacement);
});

test('matches repeated handles in playlist order', () => {
    const first = track(0, 'same', 'First occurrence');
    const second = track(1, 'same', 'Second occurrence');
    const result = reconcilePlaylistItems({
        currentItems: [first, second],
        identityRows: [
            { index: 0, handle: 'same' },
            { index: 1, handle: 'same' }
        ]
    });

    assert.equal(result[0], first);
    assert.equal(result[1], second);
});

test('fails instead of silently dropping a row when hydration is missing', () => {
    assert.throws(() => reconcilePlaylistItems({
        currentItems: [],
        identityRows: [{ index: 4, handle: 'new-track' }]
    }), /new track|nueva pista/i);
});

test('rejects hydrated data from a different playlist snapshot', () => {
    assert.throws(() => reconcilePlaylistItems({
        currentItems: [track(0, 'old-track')],
        identityRows: [{ index: 0, handle: 'new-track' }],
        hydratedItems: [track(0, 'stale-track')]
    }), (error) => error.code === 'STALE_SNAPSHOT');
});

test('prefers the playing row over saved focus during startup restoration', () => {
    assert.equal(resolveInitialSelectionIndex({
        playingIndex: 8,
        savedFocusIndex: 2,
        focusedIndex: 0,
        itemCount: 12
    }), 8);
});

test('restores saved focus when playback is stopped or outside the playlist', () => {
    assert.equal(resolveInitialSelectionIndex({
        playingIndex: -1,
        savedFocusIndex: 4,
        focusedIndex: 0,
        itemCount: 10
    }), 4);
    assert.equal(resolveInitialSelectionIndex({
        playingIndex: 99,
        savedFocusIndex: -1,
        focusedIndex: 0,
        itemCount: 10
    }), 0);
});

test('ignores delayed native focus changes that conflict with the restored playing row', () => {
    const pinnedSelection = { playlistGuid: 'active', identity: 'track-8', index: 8 };

    assert.equal(shouldIgnorePinnedFocusChange({
        pinnedSelection,
        playlistGuid: 'active',
        nextIndex: 0
    }), true);
    assert.equal(shouldIgnorePinnedFocusChange({
        pinnedSelection,
        playlistGuid: 'active',
        nextIndex: 8
    }), false);
});

test('does not block focus changes after the pin is released or on another playlist', () => {
    const pinnedSelection = { playlistGuid: 'active', identity: 'track-8', index: 8 };

    assert.equal(shouldIgnorePinnedFocusChange({
        pinnedSelection: null,
        playlistGuid: 'active',
        nextIndex: 0
    }), false);
    assert.equal(shouldIgnorePinnedFocusChange({
        pinnedSelection,
        playlistGuid: 'another',
        nextIndex: 0
    }), false);
});

test('keeps the pinned selection attached to its track after reordering', () => {
    const pinnedSelection = {
        playlistGuid: 'active',
        identity: 'track-c',
        index: 2
    };
    const reordered = [
        track(0, 'track-a'),
        track(1, 'track-c'),
        track(2, 'track-b')
    ];

    assert.equal(resolvePinnedSelectionIndex(reordered, pinnedSelection, 'active'), 1);
    assert.equal(resolvePinnedSelectionIndex(reordered, pinnedSelection, 'other'), -1);
});

test('returns no pinned index after the pinned track is removed', () => {
    const pinnedSelection = {
        playlistGuid: 'active',
        identity: 'track-c',
        index: 2
    };

    assert.equal(resolvePinnedSelectionIndex([track(0, 'track-a')], pinnedSelection, 'active'), -1);
});


test('resolves current playlist activation events through newGuid', () => {
    assert.equal(resolveActivatedPlaylistGuid({
        newGuid: 'playlist-b',
        newIndex: 1,
        oldIndex: 0
    }), 'playlist-b');
});

test('resolves legacy activation GUIDs and index-only events against a fresh playlist list', () => {
    const playlists = [
        { index: 0, guid: 'playlist-a', isActive: false },
        { index: 2, guid: 'playlist-c', isActive: true }
    ];

    assert.equal(resolveActivatedPlaylistGuid({
        playlistGuid: 'playlist-a'
    }, playlists), 'playlist-a');
    assert.equal(resolveActivatedPlaylistGuid({
        newIndex: 0,
        oldIndex: 2
    }, playlists), 'playlist-c');
});

test('does not guess an activated playlist when the event and fresh list provide no target', () => {
    assert.equal(resolveActivatedPlaylistGuid({ newIndex: -1 }, []), '');
});

test('resolves focus-change events that identify their playlist by numeric index', () => {
    assert.equal(resolvePlaylistGuidFromEvent({
        playlist: 1,
        from: 2,
        to: 8
    }, [{ index: 0, guid: 'playlist-a' }, { index: 1, guid: 'playlist-b' }]), 'playlist-b');
    assert.equal(resolvePlaylistGuidFromEvent({ playlist: -1 }, []), '');
});
