import test from 'node:test';
import assert from 'node:assert/strict';
import { syncLibraryViewerSelection } from '../src/services/libraryFacets.js';
import {
    DEFAULT_REFACETS_PRESENTATION,
    normalizeRefacetsPresentation,
    writeRefacetsSettings
} from '../src/features/refacets/refacetsSettings.js';

function createPlaylistSdk(library) {
    const captured = { handles: [], cleared: 0 };
    const sdk = {
        library,
        playlist: {
            async getAll() {
                return {
                    playlists: [{
                        name: 'Library Viewer Selection',
                        guid: 'library-viewer-guid',
                        isLocked: false,
                        isAutoplaylist: false
                    }]
                };
            },
            async clear() {
                captured.cleared += 1;
                return { success: true };
            },
            async addHandles(_playlist, handles) {
                captured.handles = handles;
                return { success: true };
            }
        }
    };
    return { sdk, captured };
}

const directory = {
    rootId: 'C:\\\\Music',
    pathId: 'Artist\\\\Album',
    absolutePath: 'C:\\\\Music\\\\Artist\\\\Album',
    trackCount: 3
};

test('immediate folder access sorts %path% naturally instead of lexicographically', async () => {
    const files = [
        { path: 'C:\\\\Music\\\\Artist\\\\Album\\\\10 - Ten.flac', subsong: 0 },
        { path: 'C:\\\\Music\\\\Artist\\\\Album\\\\2 - Two.flac', subsong: 0 },
        { path: 'C:\\\\Music\\\\Artist\\\\Album\\\\1 - One.flac', subsong: 0 }
    ];
    const { sdk, captured } = createPlaylistSdk({
        async browseTree() {
            return { files };
        }
    });

    const result = await syncLibraryViewerSelection(sdk, [directory]);

    assert.equal(result.trackCount, 3);
    assert.deepEqual(captured.handles, [
        'C:\\\\Music\\\\Artist\\\\Album\\\\1 - One.flac',
        'C:\\\\Music\\\\Artist\\\\Album\\\\2 - Two.flac',
        'C:\\\\Music\\\\Artist\\\\Album\\\\10 - Ten.flac'
    ]);
});

test('Media Library mode uses native query sorted by %path_sort% and filters exact folders', async () => {
    const queryCalls = [];
    const tracks = [
        {
            handle: 'C:\\\\Music\\\\Artist\\\\Album\\\\1 - One.flac',
            path: 'C:\\\\Music\\\\Artist\\\\Album\\\\1 - One.flac',
            absolutePath: 'C:\\\\Music\\\\Artist\\\\Album\\\\1 - One.flac',
            subsong: 0
        },
        {
            handle: 'C:\\\\Music\\\\Artist\\\\Album\\\\2 - Two.flac',
            path: 'C:\\\\Music\\\\Artist\\\\Album\\\\2 - Two.flac',
            absolutePath: 'C:\\\\Music\\\\Artist\\\\Album\\\\2 - Two.flac',
            subsong: 0
        },
        {
            handle: 'C:\\\\Music\\\\Artist\\\\Album Extra\\\\Ignored.flac',
            path: 'C:\\\\Music\\\\Artist\\\\Album Extra\\\\Ignored.flac',
            absolutePath: 'C:\\\\Music\\\\Artist\\\\Album Extra\\\\Ignored.flac',
            subsong: 0
        }
    ];
    const { sdk, captured } = createPlaylistSdk({
        async query(...args) {
            queryCalls.push(args);
            return { total: tracks.length, tracks };
        },
        async browseTree() {
            assert.fail('Media Library mode must not browse each folder separately.');
        }
    });

    const result = await syncLibraryViewerSelection(sdk, [directory], {
        accessMode: 'media-library'
    });

    assert.equal(queryCalls.length, 1);
    assert.match(queryCalls[0][0], /%path% HAS/);
    assert.equal(queryCalls[0][1], '%path_sort%');
    assert.deepEqual(queryCalls[0][3], ['handle', 'path', 'absolutePath', 'subsong']);
    assert.equal(result.trackCount, 2);
    assert.deepEqual(captured.handles, [
        'C:\\\\Music\\\\Artist\\\\Album\\\\1 - One.flac',
        'C:\\\\Music\\\\Artist\\\\Album\\\\2 - Two.flac'
    ]);
});

test('ReFacets keeps immediate access as the legacy default and persists selected mode', () => {
    assert.equal(DEFAULT_REFACETS_PRESENTATION.playlistAccessMode, 'immediate');
    assert.equal(normalizeRefacetsPresentation({}).playlistAccessMode, 'immediate');
    assert.equal(
        normalizeRefacetsPresentation({ playlistAccessMode: 'media-library' }).playlistAccessMode,
        'media-library'
    );
    assert.equal(
        normalizeRefacetsPresentation({ playlistAccessMode: 'unknown' }).playlistAccessMode,
        'immediate'
    );

    const values = new Map();
    const storage = {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); }
    };
    const saved = writeRefacetsSettings({
        presentation: { playlistAccessMode: 'media-library' }
    }, storage);

    assert.equal(saved.presentation.playlistAccessMode, 'media-library');
    assert.equal(
        JSON.parse(values.get('crayonshell.refacets.presentation.v1')).playlistAccessMode,
        'media-library'
    );
});
