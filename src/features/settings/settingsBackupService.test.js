import assert from 'node:assert/strict';
import test from 'node:test';
import { createSettingsRegistry } from './settingsRegistry.js';
import {
    createSettingsBackup,
    serializeSettingsBackup,
    SETTINGS_BACKUP_FORMAT,
    SETTINGS_BACKUP_FORMAT_VERSION
} from './settingsBackupService.js';
import {
    createCoreSettingsProviders,
    registerCoreSettingsProviders
} from './providers/coreSettingsProviders.js';

function createMemoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        },
        removeItem(key) {
            values.delete(key);
        },
        values
    };
}

test('registers seven real providers in stable order and exports all current configuration areas', () => {
    const storage = createMemoryStorage();
    const registry = createSettingsRegistry();
    registerCoreSettingsProviders(registry, storage);

    const backup = createSettingsBackup(registry, {
        now: () => new Date('2026-11-24T12:00:00.000Z'),
        applicationVersion: '0.2.0',
        runtime: 'browser'
    });

    assert.equal(backup.format, SETTINGS_BACKUP_FORMAT);
    assert.equal(backup.formatVersion, SETTINGS_BACKUP_FORMAT_VERSION);
    assert.equal(backup.exportedAt, '2026-11-24T12:00:00.000Z');
    assert.deepEqual(Object.keys(backup.providers), [
        'core.ui',
        'activitybar',
        'external-tools',
        'yearbook.explorer',
        'refacets',
        'spectrum',
        'waveform.cache'
    ]);
    assert.equal(backup.providers['core.ui'].settings.sidebar.width, 320);
    assert.equal(backup.providers['activitybar'].settings.version, 1);
    assert.equal(backup.providers['yearbook.explorer'].settings.expandedRelativePaths.length, 0);
    assert.equal(backup.application.version, '0.2.0');
});

test('exports saved values through each existing feature normalizer', () => {
    const storage = createMemoryStorage({
        'crayonshell.sidebar.width.v1': '410',
        'crayonshell.sidebar.collapsed.v1': 'false',
        'crayonshell.sidebar.view.v1': 'yearbook',
        'crayonshell.sidebar.refacetsHeight.v1': '72',
        'crayonshell.activitybar.config.v1': JSON.stringify({
            version: 1,
            buttons: [{
                id: 'test.action',
                actionId: 'test.action',
                label: 'Prueba',
                icon: 'music'
            }]
        }),
        'crayonshell.externalTools.v1': JSON.stringify({
            internalBasePath: 'E:\\_Internal',
            pythonExecutable: 'python.exe'
        }),
        'crayonshell.refacets.presentation.v1': JSON.stringify({
            showHeader: false,
            showFooter: true,
            yearsCount: false,
            subfoldersCount: true
        }),
        'crayonshell.refacets.columnSplit.v1': '62',
        'crayonshell.refacets.selection.v1': JSON.stringify({
            years: ['2024'],
            subfolders: ['Graduación']
        }),
        'crayonshell.spectrum.settings.v1': JSON.stringify({
            bands: 96,
            fftSize: 4096,
            fps: 60,
            backgroundColor: '#112233'
        }),
        'crayonshell.yearbookExplorer.expanded.v1': JSON.stringify({
            rootPath: 'E:\\_Internal',
            paths: ['E:\\_Internal\\2024', 'E:\\_Internal\\2024\\Graduación']
        })
    });
    const registry = createSettingsRegistry();
    registerCoreSettingsProviders(registry, storage);

    const backup = createSettingsBackup(registry, { runtime: 'test' });

    assert.equal(backup.providers['core.ui'].settings.sidebar.width, 410);
    assert.equal(backup.providers['core.ui'].settings.sidebar.collapsed, false);
    assert.equal(backup.providers['core.ui'].settings.sidebar.view, 'yearbook');
    assert.equal(backup.providers['core.ui'].settings.refacets.height, 72);
    assert.equal(backup.providers.activitybar.settings.buttons[0].label, 'Prueba');
    assert.equal(backup.providers['external-tools'].settings.pythonExecutable, 'python.exe');
    assert.deepEqual(
        backup.providers['yearbook.explorer'].settings.expandedRelativePaths,
        ['2024', '2024/Graduación']
    );
    assert.equal(backup.providers.refacets.settings.presentation.showHeader, false);
    assert.equal(backup.providers.refacets.settings.columnSplit, 62);
    assert.deepEqual(backup.providers.refacets.settings.selection.years, ['2024']);
    assert.equal(backup.providers.spectrum.settings.bands, 96);
    assert.equal(backup.providers.spectrum.settings.backgroundColor, '#112233');
});

test('serializes a portable JSON document with readable indentation', () => {
    const registry = createSettingsRegistry();
    registry.register({
        id: 'core.ui',
        label: 'Interfaz general',
        version: 1,
        readSettings: () => ({ sidebar: { width: 320 } }),
        validateSettings: (value) => value,
        applySettings: () => {}
    });

    const json = serializeSettingsBackup(registry, {
        now: () => new Date('2026-11-24T12:00:00.000Z'),
        runtime: 'browser'
    });
    const parsed = JSON.parse(json);

    assert.equal(parsed.format, SETTINGS_BACKUP_FORMAT);
    assert.match(json, /\n  "formatVersion": 1,/);
});

test('rejects providers that return non-JSON values instead of silently omitting data', () => {
    const registry = createSettingsRegistry();
    registry.register({
        id: 'invalid',
        label: 'Inválido',
        version: 1,
        readSettings: () => ({ unsafe: undefined }),
        validateSettings: (value) => value,
        applySettings: () => {}
    });

    assert.throws(
        () => createSettingsBackup(registry),
        /no serializable/
    );
});

test('rejects circular data and non-finite numbers', () => {
    const circular = {};
    circular.self = circular;
    const registry = createSettingsRegistry();
    registry.register({
        id: 'circular',
        label: 'Circular',
        version: 1,
        readSettings: () => circular,
        validateSettings: (value) => value,
        applySettings: () => {}
    });
    assert.throws(() => createSettingsBackup(registry), /referencia circular/);

    const invalidNumberRegistry = createSettingsRegistry();
    invalidNumberRegistry.register({
        id: 'number',
        label: 'Número',
        version: 1,
        readSettings: () => ({ value: Number.POSITIVE_INFINITY }),
        validateSettings: (value) => value,
        applySettings: () => {}
    });
    assert.throws(() => createSettingsBackup(invalidNumberRegistry), /número no finito/);
});

test('is idempotent when the bootstrap is evaluated again', () => {
    const registry = createSettingsRegistry();
    const storage = createMemoryStorage();
    registerCoreSettingsProviders(registry, storage);

    assert.doesNotThrow(() => registerCoreSettingsProviders(registry, storage));
    assert.equal(registry.getProviders().length, 7);
});

test('provider factories are usable with injected storage without browser globals', () => {
    const providers = createCoreSettingsProviders(createMemoryStorage());
    assert.equal(providers.length, 7);
    assert.deepEqual(providers.map((provider) => provider.id), [
        'core.ui',
        'activitybar',
        'external-tools',
        'yearbook.explorer',
        'refacets',
        'spectrum',
        'waveform.cache'
    ]);
});
