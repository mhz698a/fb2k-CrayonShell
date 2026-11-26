import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_PROPERTIES_WIDTH,
    MAX_PROPERTIES_WIDTH,
    MIN_PROPERTIES_WIDTH,
    PROPERTIES_COLLAPSED_STORAGE_KEY,
    PROPERTIES_WIDTH_STORAGE_KEY,
    normalizeCoreUiSettings,
    readCoreUiSettings,
    writeCoreUiSettings
} from '../src/features/settings/providers/coreUiSettings.js';

function createStorage() {
    const values = new Map();
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); }
    };
}

test('properties inspector defaults to visible at its standard width', () => {
    const settings = normalizeCoreUiSettings();
    assert.equal(settings.properties.collapsed, false);
    assert.equal(settings.properties.width, DEFAULT_PROPERTIES_WIDTH);
});

test('properties inspector width is clamped to the supported limits', () => {
    assert.equal(normalizeCoreUiSettings({
        properties: { width: 20, collapsed: true }
    }).properties.width, MIN_PROPERTIES_WIDTH);

    assert.equal(normalizeCoreUiSettings({
        properties: { width: 900, collapsed: true }
    }).properties.width, MAX_PROPERTIES_WIDTH);
});

test('properties visibility and width survive global UI settings persistence', () => {
    const storage = createStorage();
    const settings = normalizeCoreUiSettings({
        properties: { width: 410, collapsed: true }
    });

    writeCoreUiSettings(settings, storage);
    const restored = readCoreUiSettings(storage);

    assert.equal(restored.properties.width, 410);
    assert.equal(restored.properties.collapsed, true);
    assert.equal(storage.getItem(PROPERTIES_WIDTH_STORAGE_KEY), '410');
    assert.equal(storage.getItem(PROPERTIES_COLLAPSED_STORAGE_KEY), 'true');
});
