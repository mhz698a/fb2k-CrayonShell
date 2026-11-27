import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaybackController } from './playbackController.js';

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function createFakeSdk(overrides = {}) {
    const listeners = new Map();
    const calls = [];
    const player = {
        getState: async () => ({ success: true, state: 'playing', canSeek: true, canPause: true }),
        getCurrentTrack: async () => ({
            success: true,
            found: true,
            track: { path: 'D:\\Music\\Current.flac', title: 'Current' }
        }),
        getOrder: async () => ({ success: true, order: 0, orderName: 'default' }),
        getStopAfterCurrent: async () => ({ success: true, enabled: false }),
        getVolume: async () => ({ success: true, volume: 72, volumeDb: -6.2, muted: false }),
        play: async () => ({ success: true }),
        pause: async () => ({ success: true }),
        playPause: async () => ({ success: true, isPlaying: false }),
        prev: async () => ({ success: true }),
        stop: async () => ({ success: true }),
        next: async () => ({ success: true }),
        random: async () => ({ success: true }),
        setOrder: async (order) => ({ success: true, order, orderName: order }),
        setStopAfterCurrent: async (enabled) => ({ success: true, enabled }),
        toggleStopAfterCurrent: async () => ({ success: true, enabled: true }),
        setVolume: async (volume) => ({ success: true, volume, volumeDb: -3, muted: volume === 0 }),
        mute: async (muted = true) => ({ success: true, muted }),
        toggleMute: async () => ({ success: true, muted: true }),
        volumeUp: async () => ({ success: true }),
        volumeDown: async () => ({ success: true }),
        ...overrides.player
    };

    const sdk = {
        player,
        on(eventName, handler) {
            if (!listeners.has(eventName)) listeners.set(eventName, new Set());
            listeners.get(eventName).add(handler);
            return () => listeners.get(eventName)?.delete(handler);
        },
        emit(eventName, payload) {
            listeners.get(eventName)?.forEach((handler) => handler(payload));
        },
        calls,
        listeners
    };

    for (const [method, fn] of Object.entries(player)) {
        player[method] = (...args) => {
            calls.push({ method, args });
            return fn(...args);
        };
    }

    return sdk;
}

async function flushMicrotasks() {
    await new Promise((resolve) => setImmediate(resolve));
}

test('start subscribes before reading and publishes the initial playback snapshot', async () => {
    const sdk = createFakeSdk();
    const controller = createPlaybackController({ getSdk: () => sdk });
    const release = controller.start();

    await flushMicrotasks();

    const state = controller.getState();
    assert.equal(state.connectionState, 'ready');
    assert.equal(state.available, true);
    assert.equal(state.initialized, true);
    assert.equal(state.playbackState, 'playing');
    assert.equal(state.currentTrackPath, 'D:\\Music\\Current.flac');
    assert.deepEqual(state.order, { index: 0, name: 'default' });
    assert.equal(state.stopAfterCurrent, false);
    assert.equal(state.volume, 72);
    assert.equal(state.volumeDb, -6.2);
    assert.equal(state.muted, false);

    assert.equal(sdk.listeners.size, 8);
    release();
    assert.equal(controller.getState().connectionState, 'disconnected');
    assert.equal(Array.from(sdk.listeners.values()).every((handlers) => handlers.size === 0), true);
});

test('playback events update the shared snapshot', () => {
    const sdk = createFakeSdk();
    const controller = createPlaybackController({ getSdk: () => sdk });
    const release = controller.start();

    sdk.emit('playback:starting', { command: 'play' });
    assert.equal(controller.getState().playbackState, 'opening');

    sdk.emit('playback:trackChanged', {
        path: 'E:\\Audio\\New.flac',
        absolutePath: 'E:\\Audio\\New.flac',
        title: 'New Track'
    });
    assert.equal(controller.getState().currentTrackPath, 'E:\\Audio\\New.flac');
    assert.equal(controller.getState().currentTrack.title, 'New Track');

    sdk.emit('playback:stateChanged', { state: 'paused' });
    assert.equal(controller.getState().playbackState, 'paused');

    sdk.emit('playback:volumeChanged', {
        volume: 44,
        volumeDb: -12.3,
        muted: true
    });
    assert.equal(controller.getState().volume, 44);
    assert.equal(controller.getState().volumeDb, -12.3);
    assert.equal(controller.getState().muted, true);

    sdk.emit('playback:orderChanged', { orderIndex: 2, order: 'repeat-track' });
    assert.deepEqual(controller.getState().order, { index: 2, name: 'repeat-track' });

    sdk.emit('playback:stopAfterCurrentChanged', { enabled: true });
    assert.equal(controller.getState().stopAfterCurrent, true);

    sdk.emit('playback:stopped', { reason: 'user' });
    assert.equal(controller.getState().playbackState, 'stopped');
    release();
});

test('all transport and playback-setting actions call the corresponding SDK methods', async () => {
    const sdk = createFakeSdk();
    const controller = createPlaybackController({ getSdk: () => sdk });

    await controller.play();
    await controller.pause();
    await controller.playPause();
    await controller.previous();
    await controller.stopPlayback();
    await controller.next();
    await controller.playRandom();
    await controller.setPlaybackOrder('repeat-playlist');
    await controller.setPlaybackOrder('repeat-track');
    await controller.setStopAfterCurrent(true);
    await controller.toggleStopAfterCurrent();
    await controller.setVolume(125);
    await controller.setMuted(false);
    await controller.toggleMute();
    await controller.volumeUp();
    await controller.volumeDown();

    assert.deepEqual(sdk.calls.map((call) => call.method), [
        'play',
        'pause',
        'playPause',
        'prev',
        'stop',
        'next',
        'random',
        'setOrder',
        'setStopAfterCurrent',
        'toggleStopAfterCurrent',
        'setVolume',
        'mute',
        'toggleMute',
        'volumeUp',
        'volumeDown'
    ]);
    assert.deepEqual(
        sdk.calls.filter((call) => call.method === 'setOrder').map((call) => call.args[0]),
        ['repeat-playlist', 'repeat-track']
    );
    assert.deepEqual(sdk.calls.find((call) => call.method === 'setVolume').args, [100]);
    assert.deepEqual(sdk.calls.find((call) => call.method === 'mute').args, [false]);
    assert.equal(controller.getState().volume, 100);
    assert.equal(controller.getState().muted, true);
    assert.equal(controller.getState().stopAfterCurrent, true);
});

test('overlapping initial reads cannot overwrite newer event state', async () => {
    const deferred = createDeferred();
    const sdk = createFakeSdk({
        player: {
            getState: () => deferred.promise
        }
    });
    const controller = createPlaybackController({ getSdk: () => sdk });
    const release = controller.start();

    sdk.emit('playback:stateChanged', { state: 'paused' });
    deferred.resolve({ success: true, state: 'playing' });
    await flushMicrotasks();

    assert.equal(controller.getState().playbackState, 'paused');
    release();
});

test('failed SDK operations reject, publish the error, and clear pending state', async () => {
    const sdk = createFakeSdk({
        player: {
            next: async () => ({ success: false, code: 'NO_NEXT', error: 'No next track.' })
        }
    });
    const controller = createPlaybackController({ getSdk: () => sdk });

    await assert.rejects(controller.next(), /No next track/);
    assert.equal(controller.getState().lastError, 'No next track.');
    assert.deepEqual(controller.getState().pendingActions, []);
});

test('invalid playback order and non-numeric volume are rejected before reaching the SDK', async () => {
    const sdk = createFakeSdk();
    const controller = createPlaybackController({ getSdk: () => sdk });

    await assert.rejects(controller.setPlaybackOrder('shuffle-albums'), /Playback Order no admitido/);
    await assert.rejects(controller.setVolume('loud'), /El volumen debe ser un número/);
    assert.deepEqual(sdk.calls, []);
});

test('partial snapshot failures are reported without preventing the controller from starting', async () => {
    const sdk = createFakeSdk({
        player: {
            getVolume: async () => ({ success: false, code: 'NOT_SUPPORTED', error: 'Volume unavailable.' })
        }
    });
    const controller = createPlaybackController({ getSdk: () => sdk });
    const release = controller.start();

    await flushMicrotasks();

    const state = controller.getState();
    assert.equal(state.connectionState, 'degraded');
    assert.equal(state.initialized, true);
    assert.equal(state.volumeKnown, false);
    assert.match(state.lastError, /Volume unavailable/);
    assert.equal(state.playbackState, 'playing');
    release();
});

test('controller start is reference-counted and remains active until the last consumer releases it', async () => {
    const sdk = createFakeSdk();
    const controller = createPlaybackController({ getSdk: () => sdk });
    const releaseOne = controller.start();
    const releaseTwo = controller.start();

    releaseOne();
    assert.equal(controller.getState().available, true);
    assert.equal(Array.from(sdk.listeners.values()).some((handlers) => handlers.size > 0), true);

    releaseTwo();
    assert.equal(controller.getState().available, false);
    assert.equal(Array.from(sdk.listeners.values()).every((handlers) => handlers.size === 0), true);
});
