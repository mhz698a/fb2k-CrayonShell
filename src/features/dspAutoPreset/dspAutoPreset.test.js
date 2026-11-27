import assert from 'node:assert/strict';
import test from 'node:test';
import {
    DSP_AUTO_PRESET_SETTINGS_STORAGE_KEY,
    normalizeDspAutoPresetSettings,
    readDspAutoPresetSettings,
    writeDspAutoPresetSettings
} from './dspAutoPresetSettings.js';
import { resolveDspPresetForTrack } from './dspPresetResolver.js';
import { createDspAutoActivationController } from './dspAutoActivationController.js';

function createStorage() {
    const values = new Map();
    return {
        getItem(key) { return values.get(key) ?? null; },
        setItem(key, value) { values.set(key, String(value)); },
        values
    };
}

function createSettings() {
    return {
        defaultPreset: 'Default',
        folderRules: [
            { id: 'folder-a', path: 'D:\\Music', presetName: 'Music' },
            { id: 'folder-b', path: 'D:\\Music\\Classical', presetName: 'Classical' }
        ],
        trackRules: [
            { id: 'track-a', path: 'D:\\Music\\Classical\\special.flac', presetName: 'Headphones' }
        ]
    };
}

test('DSP settings are versioned, normalized and persisted for global backups', () => {
    const storage = createStorage();
    const settings = createSettings();
    writeDspAutoPresetSettings(settings, storage);

    assert.deepEqual(readDspAutoPresetSettings(storage), settings);
    assert.deepEqual(
        JSON.parse(storage.getItem(DSP_AUTO_PRESET_SETTINGS_STORAGE_KEY)),
        { version: 1, ...settings }
    );
});

test('invalid duplicate paths are rejected case-insensitively', () => {
    assert.throws(() => normalizeDspAutoPresetSettings({
        defaultPreset: 'Default',
        folderRules: [
            { id: 'a', path: 'D:\\Music', presetName: 'One' },
            { id: 'b', path: 'd:/music/', presetName: 'Two' }
        ]
    }), /misma ruta/);
});

test('a track-specific rule takes priority over folder rules', () => {
    const result = resolveDspPresetForTrack(
        createSettings(),
        'd:/music/classical/SPECIAL.flac'
    );
    assert.equal(result.presetName, 'Headphones');
    assert.equal(result.source, 'track');
});

test('the deepest matching folder wins before the default fallback', () => {
    const settings = createSettings();
    assert.equal(
        resolveDspPresetForTrack(settings, 'D:\\Music\\Classical\\Symphony.flac').presetName,
        'Classical'
    );
    assert.equal(
        resolveDspPresetForTrack(settings, 'D:\\Music\\Rock\\Song.flac').presetName,
        'Music'
    );
    assert.equal(
        resolveDspPresetForTrack(settings, 'E:\\Other\\Song.flac').presetName,
        'Default'
    );
});

test('controller skips repeat activation and restores the default on stop', async () => {
    const settings = createSettings();
    let activePreset = 'Default';
    const applications = [];
    const handlers = new Map();
    const controller = createDspAutoActivationController({
        getSettings: () => settings,
        isAvailable: () => true,
        subscribeEvents: (name, handler) => {
            handlers.set(name, handler);
            return () => handlers.delete(name);
        },
        getSdk: () => ({
            dsp: {
                async getChain() {
                    return { success: true, activePreset };
                },
                async applyPreset(name) {
                    activePreset = name;
                    applications.push(name);
                    return { success: true, appliedPreset: name };
                }
            }
        })
    });

    controller.start();
    await controller.prepareForTrack('D:\\Music\\Classical\\Symphony.flac');
    await controller.syncTrack('D:\\Music\\Classical\\Symphony.flac');
    assert.deepEqual(applications, ['Classical']);
    assert.equal(controller.getState().activePreset, 'Classical');

    handlers.get('playback:stopped')({ reason: 'user' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(applications, ['Classical', 'Default']);

    controller.stop();
});
