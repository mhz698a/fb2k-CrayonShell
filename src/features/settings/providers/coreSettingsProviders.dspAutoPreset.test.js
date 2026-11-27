import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoreSettingsProviders } from './coreSettingsProviders.js';

function createStorage() {
    const values = new Map();
    return {
        getItem(key) { return values.get(key) ?? null; },
        setItem(key, value) { values.set(key, String(value)); }
    };
}

test('DSP Auto Presets is registered as a versioned global-backup provider', () => {
    const storage = createStorage();
    const provider = createCoreSettingsProviders(storage).find(
        (entry) => entry.id === 'dsp.auto-preset'
    );

    assert.ok(provider);
    assert.equal(provider.version, 1);
    assert.deepEqual(provider.readSettings(), {
        defaultPreset: '',
        folderRules: [],
        trackRules: []
    });

    const settings = {
        defaultPreset: 'Headphones',
        folderRules: [
            { id: 'folder-1', path: 'D:\\Music', presetName: 'Music' }
        ],
        trackRules: [
            { id: 'track-1', path: 'D:\\Music\\special.flac', presetName: 'Special' }
        ]
    };

    provider.applySettings(provider.validateSettings(settings));
    assert.deepEqual(provider.readSettings(), settings);
});
