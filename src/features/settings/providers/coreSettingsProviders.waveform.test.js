import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoreSettingsProviders } from './coreSettingsProviders.js';
import {
    DEFAULT_WAVEFORM_CACHE_MAX_BYTES,
    MEBIBYTE,
    WAVEFORM_CACHE_SETTINGS_STORAGE_KEY
} from '../../waveform/waveformCacheSettings.js';

function createStorage() {
    const values = new Map();
    return {
        getItem(key) { return values.get(key) ?? null; },
        setItem(key, value) { values.set(key, String(value)); },
        values
    };
}

test('registers waveform cache budget as a persistent and backup-compatible settings provider', () => {
    const storage = createStorage();
    const provider = createCoreSettingsProviders(storage).find(
        (item) => item.id === 'waveform.cache'
    );

    assert.ok(provider);
    assert.equal(provider.version, 1);
    assert.deepEqual(provider.readSettings(), {
        maxBytes: DEFAULT_WAVEFORM_CACHE_MAX_BYTES
    });

    const next = provider.validateSettings({ maxBytes: 2048 * MEBIBYTE });
    assert.deepEqual(next, { maxBytes: 2048 * MEBIBYTE });
    provider.applySettings(next);

    assert.deepEqual(provider.readSettings(), next);
    assert.deepEqual(
        JSON.parse(storage.getItem(WAVEFORM_CACHE_SETTINGS_STORAGE_KEY)),
        { version: 1, maxBytes: 2048 * MEBIBYTE }
    );
});
