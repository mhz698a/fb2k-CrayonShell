import assert from 'node:assert/strict';
import test from 'node:test';
import {
    DSP_AUTO_PRESET_SETTINGS_STORAGE_KEY,
    getDspTrackDirectory,
    normalizeDspRulePath,
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

test('normalizes file URLs to native Windows paths before matching rules', () => {
    assert.equal(
        normalizeDspRulePath('file:///D:/Music/Album/Track.flac'),
        'd:\\music\\album\\track.flac'
    );
    assert.equal(
        getDspTrackDirectory('D:\\Music\\Album\\Track.flac'),
        'D:\\Music\\Album'
    );
    assert.equal(
        getDspTrackDirectory('https://radio.example/live'),
        ''
    );
});

test('folder rules match URI paths and local absolute paths consistently', () => {
    const settings = {
        defaultPreset: 'Default',
        folderRules: [
            { id: 'folder-uri', path: 'D:\\Music\\Classical', presetName: 'Classical' }
        ],
        trackRules: []
    };

    const result = resolveDspPresetForTrack(
        settings,
        'file:///D:/Music/Classical/Symphony.flac'
    );
    assert.equal(result.presetName, 'Classical');
    assert.equal(result.source, 'folder');
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

test('track-change events resolve folder rules from the native absolutePath', async () => {
    const handlers = new Map();
    let activePreset = 'Default';
    const applications = [];
    const controller = createDspAutoActivationController({
        getSettings: () => ({
            defaultPreset: 'Default',
            folderRules: [
                { id: 'folder-native', path: 'D:\\Music\\Classical', presetName: 'Classical' }
            ],
            trackRules: []
        }),
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
    handlers.get('playback:trackChanged')({
        path: 'file:///D:/Music/Classical/Symphony.flac',
        absolutePath: 'D:\\Music\\Classical\\Symphony.flac'
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(applications, ['Classical']);
    assert.equal(controller.getState().activePreset, 'Classical');
    controller.stop();
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

    handlers.get('playback:trackChanged')({
        path: 'D:\\Music\\Classical\\Symphony.flac'
    });
    handlers.get('playback:stopped')({ reason: 'user' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(applications, ['Classical', 'Default']);

    controller.stop();
});

test('folder rules apply only to tracks below the folder, not to the folder itself', () => {
    const settings = {
        defaultPreset: 'Default',
        folderRules: [
            { id: 'classical-folder', path: 'D:\\Music\\Classical', presetName: 'Classical' }
        ],
        trackRules: []
    };

    assert.equal(
        resolveDspPresetForTrack(settings, 'D:\\Music\\Classical').presetName,
        'Default'
    );
    assert.equal(
        resolveDspPresetForTrack(settings, 'D:\\Music\\Classical\\').presetName,
        'Default'
    );
    assert.equal(
        resolveDspPresetForTrack(settings, 'D:\\Music\\Classical\\Symphony.flac').presetName,
        'Classical'
    );
    assert.equal(
        resolveDspPresetForTrack(settings, 'D:\\Music\\Classical Archive\\Symphony.flac').presetName,
        'Default'
    );
});

test('track-change event uses native absolutePath when the other path is stale', async () => {
    const handlers = new Map();
    let activePreset = 'Classical';
    const applications = [];
    const controller = createDspAutoActivationController({
        getSettings: () => ({
            defaultPreset: 'Default',
            folderRules: [
                { id: 'classical-folder', path: 'D:\\Music\\Classical', presetName: 'Classical' }
            ],
            trackRules: []
        }),
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
    handlers.get('playback:trackChanged')({
        track: {
            path: 'file:///D:/Music/Classical/Symphony.flac',
            absolutePath: 'D:\\Music\\Rock\\Unrelated.flac'
        }
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(applications, ['Default']);
    assert.equal(controller.getState().activePreset, 'Default');
    assert.equal(controller.getState().trackPath, 'D:\\Music\\Rock\\Unrelated.flac');
    controller.stop();
});


test('external DSP status reads the selected preset from the dedicated config API', async () => {
    const handlers = new Map();
    const controller = createDspAutoActivationController({
        isAvailable: () => true,
        subscribeEvents: (name, handler) => {
            handlers.set(name, handler);
            return () => handlers.delete(name);
        },
        getSdk: () => ({
            config: {
                async getActiveDspPreset() {
                    return {
                        success: true,
                        index: 2,
                        name: 'Studio Headphones',
                        isActive: true
                    };
                }
            },
            dsp: {
                async getChain() {
                    return { success: true, activePreset: null };
                }
            }
        })
    });

    controller.start();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(controller.getState().status, 'active');
    assert.equal(controller.getState().activePreset, 'Studio Headphones');
    assert.equal(controller.getState().targetPreset, 'Studio Headphones');

    handlers.get('audio:dspPresetChanged')();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(controller.getState().status, 'active');
    assert.equal(controller.getState().activePreset, 'Studio Headphones');
    controller.stop();
});

test('external DSP status falls back to getChain when config API is unavailable', async () => {
    const controller = createDspAutoActivationController({
        isAvailable: () => true,
        subscribeEvents: () => () => {},
        getSdk: () => ({
            dsp: {
                async getChain() {
                    return { success: true, activePreset: 'Fallback Preset' };
                }
            }
        })
    });

    controller.start();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(controller.getState().status, 'active');
    assert.equal(controller.getState().activePreset, 'Fallback Preset');
    controller.stop();
});
