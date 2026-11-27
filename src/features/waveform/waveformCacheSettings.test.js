import assert from 'node:assert/strict';
import test from 'node:test';
import {
    DEFAULT_WAVEFORM_CACHE_MAX_BYTES,
    MAX_WAVEFORM_CACHE_MAX_BYTES,
    MIN_WAVEFORM_CACHE_MAX_BYTES,
    MEBIBYTE,
    WAVEFORM_CACHE_SETTINGS_STORAGE_KEY,
    WAVEFORM_CACHE_BUDGET_STEP_BYTES,
    normalizeWaveformCacheSettings,
    readWaveformCacheSettings,
    writeWaveformCacheSettings
} from './waveformCacheSettings.js';

function createStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        values
    };
}

test('waveform cache settings default to 1 GiB', () => {
    assert.deepEqual(normalizeWaveformCacheSettings(), {
        maxBytes: DEFAULT_WAVEFORM_CACHE_MAX_BYTES
    });
    assert.deepEqual(readWaveformCacheSettings(createStorage()), {
        maxBytes: DEFAULT_WAVEFORM_CACHE_MAX_BYTES
    });
});

test('normalizes the cache budget to whole MiB and supported bounds', () => {
    assert.equal(
        normalizeWaveformCacheSettings({ maxBytes: 1536.4 * MEBIBYTE }).maxBytes,
        1536 * MEBIBYTE
    );
    assert.equal(
        normalizeWaveformCacheSettings({ maxBytes: 123 * MEBIBYTE }).maxBytes,
        128 * MEBIBYTE
    );
    assert.equal(WAVEFORM_CACHE_BUDGET_STEP_BYTES, 64 * MEBIBYTE);
    assert.equal(
        normalizeWaveformCacheSettings({ maxBytes: 1 }).maxBytes,
        MIN_WAVEFORM_CACHE_MAX_BYTES
    );
    assert.equal(
        normalizeWaveformCacheSettings({ maxBytes: Number.MAX_SAFE_INTEGER }).maxBytes,
        MAX_WAVEFORM_CACHE_MAX_BYTES
    );
    assert.equal(
        normalizeWaveformCacheSettings({ maxBytes: 'invalid' }).maxBytes,
        DEFAULT_WAVEFORM_CACHE_MAX_BYTES
    );
});

test('persists and reloads versioned cache settings', () => {
    const storage = createStorage();
    const saved = writeWaveformCacheSettings({ maxBytes: 2048 * MEBIBYTE }, storage);

    assert.equal(saved.maxBytes, 2048 * MEBIBYTE);
    assert.deepEqual(readWaveformCacheSettings(storage), saved);
    assert.deepEqual(
        JSON.parse(storage.getItem(WAVEFORM_CACHE_SETTINGS_STORAGE_KEY)),
        { version: 1, maxBytes: 2048 * MEBIBYTE }
    );
});
