import assert from 'node:assert/strict';
import test from 'node:test';
import {
    normalizeCoreUiSettings,
    readCoreUiSettings,
    writeCoreUiSettings
} from './providers/coreUiSettings.js';
import {
    normalizeRefacetsSelection,
    readRefacetsSelection,
    writeRefacetsSettings
} from '../refacets/refacetsSettings.js';
import {
    readYearbookExplorerSettings,
    readYearbookExpandedPaths,
    writeYearbookExplorerSettings
} from '../yearbook/yearbookExplorerSettings.js';
import {
    normalizeSpectrumSettings,
    readSpectrumSettings,
    writeSpectrumSettings
} from '../spectrum/spectrumSettings.js';

function createMemoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        },
        values
    };
}

test('Core UI helpers preserve existing defaults and fallback boundaries', () => {
    const storage = createMemoryStorage();
    assert.deepEqual(readCoreUiSettings(storage), {
        sidebar: { width: 320, collapsed: true, view: 'library' },
        refacets: { height: 68 }
    });

    assert.equal(normalizeCoreUiSettings({
        sidebar: { width: 600 }
    }).sidebar.width, 320);
    assert.equal(normalizeCoreUiSettings({
        sidebar: { width: 410 },
        refacets: { height: 90 }
    }).refacets.height, 85);

    writeCoreUiSettings({
        sidebar: { width: 440, collapsed: false, view: 'yearbook' },
        refacets: { height: 75 }
    }, storage);
    assert.equal(readCoreUiSettings(storage).sidebar.width, 440);
    assert.equal(readCoreUiSettings(storage).sidebar.collapsed, false);
    assert.equal(readCoreUiSettings(storage).sidebar.view, 'yearbook');
    assert.equal(readCoreUiSettings(storage).refacets.height, 75);
});

test('ReFacets selection preserves exact folder labels while filtering invalid entries', () => {
    const storage = createMemoryStorage();
    const selection = normalizeRefacetsSelection({
        years: ['2024', '', 2025, '2024'],
        subfolders: [' Class of 2024 ', 'Class of 2024']
    });
    assert.deepEqual(selection, {
        years: ['2024'],
        subfolders: [' Class of 2024 ', 'Class of 2024']
    });

    writeRefacetsSettings({
        presentation: { showHeader: false },
        columnSplit: 61,
        selection
    }, storage);
    assert.deepEqual(readRefacetsSelection(storage), selection);
});

test('Yearbook exports expanded folders as relative segments and rebuilds paths for a new root', () => {
    const storage = createMemoryStorage({
        'crayonshell.yearbookExplorer.expanded.v1': JSON.stringify({
            rootPath: 'E:\\_Internal',
            paths: [
                'E:\\_Internal\\2024',
                'E:\\_Internal\\2024\\Graduación',
                'E:\\_Internal-old\\ignored'
            ]
        })
    });

    const settings = readYearbookExplorerSettings('E:\\_Internal', storage);
    assert.deepEqual(settings, {
        expandedRelativePaths: ['2024', '2024/Graduación']
    });

    writeYearbookExplorerSettings(settings, 'F:\\Data\\Internal', storage);
    assert.deepEqual(
        Array.from(readYearbookExpandedPaths('F:\\Data\\Internal', storage)),
        ['F:\\Data\\Internal\\2024', 'F:\\Data\\Internal\\2024\\Graduación']
    );
});

test('Yearbook does not export expansions from a stale root path', () => {
    const storage = createMemoryStorage({
        'crayonshell.yearbookExplorer.expanded.v1': JSON.stringify({
            rootPath: 'E:\\OldRoot',
            paths: ['E:\\OldRoot\\2023']
        })
    });
    assert.deepEqual(
        readYearbookExplorerSettings('F:\\NewRoot', storage),
        { expandedRelativePaths: [] }
    );
});

test('Spectrum helper preserves configured values and writes normalized settings', () => {
    const storage = createMemoryStorage();
    assert.equal(readSpectrumSettings(storage).fftSize, 2048);

    const settings = writeSpectrumSettings({
        fftSize: 4096,
        bands: 96,
        fps: 60,
        sensitivity: 2.25,
        backgroundColor: '#123456'
    }, storage);

    assert.equal(settings.fftSize, 4096);
    assert.equal(settings.bands, 96);
    assert.equal(readSpectrumSettings(storage).backgroundColor, '#123456');
    assert.equal(normalizeSpectrumSettings({ fftSize: 256, bands: 256 }).bands, 128);
});
