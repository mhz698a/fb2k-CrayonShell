import test from 'node:test';
import assert from 'node:assert/strict';
import { WaveformPlaybackController } from '../src/services/waveform/waveformPlaybackController.js';

function createTrack(name, duration = 100) {
    return {
        absolutePath: `C:\\Music\\${name}.flac`,
        handle: `C:\\Music\\${name}.flac`,
        title: name,
        duration,
        sampleRate: 48000,
        channels: 2,
        subsong: 0
    };
}

class FakeClock {
    constructor(position = 0, duration = 100) {
        this.positionValue = position;
        this.duration = duration;
        this.state = 'playing';
        this.ready = Promise.resolve();
        this.listeners = new Set();
        this.disposed = false;
    }

    position() {
        return this.positionValue;
    }

    onChange(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    emitChange(change) {
        if (Number.isFinite(change.position)) this.positionValue = change.position;
        if (change.state) this.state = change.state;
        for (const listener of [...this.listeners]) listener(change);
    }

    resync() {
        return Promise.resolve();
    }

    dispose() {
        this.disposed = true;
        this.listeners.clear();
    }
}

function createFakeEngine() {
    const engine = {
        track: null,
        trackKey: null,
        duration: 0,
        segmentSeconds: 10,
        setTrackCalls: [],
        setPositionCalls: [],
        clearCalls: 0,
        disposed: false,
        async setTrack(track, position) {
            this.track = track;
            this.duration = track.duration;
            this.trackKey = track.absolutePath.toLowerCase();
            this.setTrackCalls.push({ track, position });
            return {
                cancelled: false,
                trackKey: this.trackKey,
                duration: track.duration,
                segmentSeconds: this.segmentSeconds,
                totalSegments: Math.ceil(track.duration / this.segmentSeconds)
            };
        },
        setPosition(position) {
            this.setPositionCalls.push(position);
        },
        getSnapshot() {
            return {
                trackKey: this.trackKey,
                duration: this.duration,
                segmentSeconds: this.segmentSeconds,
                status: this.trackKey ? 'loading' : 'idle'
            };
        },
        clear() {
            this.clearCalls += 1;
            this.track = null;
            this.trackKey = null;
            this.duration = 0;
        },
        dispose() {
            this.disposed = true;
            this.clear();
        }
    };
    return engine;
}

function createFakeSdk(initialTrack, options = {}) {
    const listeners = new Map();
    const sdk = {
        player: {
            getCurrentTrack: options.getCurrentTrack
                || (async () => ({ success: true, found: Boolean(initialTrack), track: initialTrack }))
        },
        on(eventName, handler) {
            if (!listeners.has(eventName)) listeners.set(eventName, new Set());
            listeners.get(eventName).add(handler);
            return () => listeners.get(eventName)?.delete(handler);
        },
        emit(eventName, payload) {
            for (const handler of [...(listeners.get(eventName) || [])]) handler(payload);
        },
        listenerCount() {
            return [...listeners.values()].reduce((total, set) => total + set.size, 0);
        }
    };
    return sdk;
}

function createController({ track = createTrack('first'), position = 3, sdk, engine } = {}) {
    const activeSdk = sdk || createFakeSdk(track);
    const activeEngine = engine || createFakeEngine();
    let clock;
    const controller = new WaveformPlaybackController({
        sdk: activeSdk,
        engine: activeEngine,
        clockFactory: () => {
            clock = new FakeClock(position, track?.duration || 100);
            return clock;
        }
    });
    return { controller, sdk: activeSdk, engine: activeEngine, getClock: () => clock };
}

test('start loads the current track using the PlaybackClock position', async () => {
    const { controller, engine } = createController({ position: 17.5 });

    const snapshot = await controller.start();

    assert.equal(engine.setTrackCalls.length, 1);
    assert.equal(engine.setTrackCalls[0].position, 17.5);
    assert.equal(snapshot.trackKey, 'c:\\music\\first.flac');
    assert.equal(snapshot.position, 17.5);
    assert.equal(snapshot.playbackState, 'playing');
    controller.dispose();
});

test('trackChanged automatically replaces the waveform without another manual start', async () => {
    const { controller, sdk, engine, getClock } = createController();
    await controller.start();

    const nextTrack = createTrack('next', 80);
    getClock().positionValue = 24;
    sdk.emit('playback:trackChanged', nextTrack);
    await controller.whenTrackChangeSettled();

    assert.equal(engine.setTrackCalls.length, 2);
    assert.equal(engine.setTrackCalls[1].track, nextTrack);
    assert.equal(engine.setTrackCalls[1].position, 24);
    assert.equal(controller.getSnapshot().trackPath, nextTrack.absolutePath);
    controller.dispose();
});

test('high-resolution time updates scheduler priority only when crossing a segment boundary', async () => {
    const { controller, sdk, engine, getClock } = createController({ position: 4 });
    await controller.start();

    getClock().positionValue = 7.25;
    sdk.emit('playback:timeHighRes', { position: 7.25 });
    getClock().positionValue = 9.99;
    sdk.emit('playback:timeHighRes', { position: 9.99 });
    assert.deepEqual(engine.setPositionCalls, []);

    getClock().positionValue = 10.1;
    sdk.emit('playback:timeHighRes', { position: 10.1 });
    getClock().positionValue = 18;
    sdk.emit('playback:timeHighRes', { position: 18 });

    assert.deepEqual(engine.setPositionCalls, [10.1]);
    getClock().positionValue = 20;
    sdk.emit('playback:timeHighRes', { position: 20 });
    assert.deepEqual(engine.setPositionCalls, [10.1, 20]);
    controller.dispose();
});

test('PlaybackClock seek discontinuities reprioritize immediately', async () => {
    const { controller, engine, getClock } = createController({ position: 4 });
    await controller.start();

    getClock().emitChange({
        position: 46.5,
        reason: 'seek',
        state: 'playing'
    });

    assert.deepEqual(engine.setPositionCalls, [46.5]);
    assert.equal(controller.getSnapshot().position, 46.5);
    controller.dispose();
});

test('a trackChanged event wins over a stale initial getCurrentTrack response', async () => {
    let resolveInitial;
    const initialResponse = new Promise((resolve) => {
        resolveInitial = resolve;
    });
    const staleTrack = createTrack('stale');
    const currentTrack = createTrack('current');
    const sdk = createFakeSdk(null, {
        getCurrentTrack: () => initialResponse
    });
    const engine = createFakeEngine();
    const { controller } = createController({
        track: null,
        sdk,
        engine
    });

    const starting = controller.start();
    sdk.emit('playback:trackChanged', currentTrack);
    await controller.whenTrackChangeSettled();
    resolveInitial({ success: true, found: true, track: staleTrack });
    await starting;

    assert.deepEqual(
        engine.setTrackCalls.map((call) => call.track.absolutePath),
        [currentTrack.absolutePath]
    );
    controller.dispose();
});

test('stopping playback does not discard the waveform for the still-loaded track', async () => {
    const { controller, sdk, engine } = createController();
    await controller.start();

    sdk.emit('playback:stopped', {});

    assert.ok(controller.getSnapshot().trackKey);
    assert.equal(engine.clearCalls, 0);
    controller.dispose();
});

test('dispose detaches event listeners and releases clock and engine', async () => {
    const { controller, sdk, engine, getClock } = createController();
    await controller.start();
    const clock = getClock();

    controller.dispose();
    controller.dispose();

    assert.equal(sdk.listenerCount(), 0);
    assert.equal(clock.disposed, true);
    assert.equal(engine.disposed, true);
    assert.equal(controller.getSnapshot().disposed, true);
});

test('start reports an explicit error when the SDK does not expose PlaybackClock', async () => {
    const sdk = createFakeSdk(createTrack('first'));
    const engine = createFakeEngine();
    const controller = new WaveformPlaybackController({
        sdk,
        engine,
        clockFactory: () => {
            const error = new Error('PlaybackClock unavailable');
            error.code = 'PLAYBACK_CLOCK_UNAVAILABLE';
            throw error;
        }
    });

    await assert.rejects(controller.start(), /PlaybackClock unavailable/);
    controller.dispose();
});
