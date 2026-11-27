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
    const seekCalls = [];
    const sdk = {
        player: {
            getCurrentTrack: options.getCurrentTrack
                || (async () => ({ success: true, found: Boolean(initialTrack), track: initialTrack })),
            getState: options.getState
                || (async () => ({
                    success: true,
                    state: 'playing',
                    canPause: true,
                    canSeek: true
                })),
            async seek(position) {
                seekCalls.push(position);
                return { success: true, requested: position, position };
            }
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
        },
        seekCalls
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
    assert.equal(snapshot.canSeek, true);
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


test('seek delegates to the host, clamps to duration and resynchronizes PlaybackClock', async () => {
    const { controller, sdk, getClock } = createController({ position: 12 });
    await controller.start();
    const clock = getClock();
    let resyncCalls = 0;
    const originalResync = clock.resync.bind(clock);
    clock.resync = async () => {
        resyncCalls += 1;
        return originalResync();
    };

    const result = await controller.seek(130);

    assert.deepEqual(sdk.seekCalls, [100]);
    assert.equal(result.position, 100);
    assert.equal(resyncCalls, 1);
    controller.dispose();
});

test('seek refuses when the active track is reported as non-seekable', async () => {
    const sdk = createFakeSdk(createTrack('stream'), {
        getState: async () => ({
            success: true,
            state: 'playing',
            canPause: true,
            canSeek: false
        })
    });
    const { controller } = createController({ sdk });

    await controller.start();
    await assert.rejects(controller.seek(20), (error) => error.code === 'NOT_SUPPORTED');
    assert.deepEqual(sdk.seekCalls, []);
    controller.dispose();
});

test('stateChanged updates canSeek without discarding the current waveform', async () => {
    const { controller, sdk, engine } = createController();
    await controller.start();

    sdk.emit('playback:stateChanged', {
        state: 'paused',
        canSeek: true,
        duration: 100,
        position: 12,
        hostTime: Date.now()
    });

    assert.equal(controller.getSnapshot().canSeek, true);
    assert.equal(controller.getSnapshot().playbackState, 'paused');
    assert.ok(controller.getSnapshot().trackKey);
    assert.equal(engine.clearCalls, 0);
    controller.dispose();
});


test('video tracks do not enter the PCM audio decoder', async () => {
    const videoTrack = {
        ...createTrack('clip'),
        absolutePath: 'C:\\Media\\clip.mp4',
        handle: 'C:\\Media\\clip.mp4'
    };
    const { controller, sdk, engine } = createController();
    await controller.start();

    sdk.emit('playback:trackChanged', videoTrack);
    await controller.whenTrackChangeSettled();

    assert.equal(engine.setTrackCalls.length, 1);
    assert.equal(controller.getSnapshot().trackKey, null);
    assert.equal(controller.getSnapshot().canSeek, false);
    controller.dispose();
});


test('resolves a native track path from handle before a file URL path', async () => {
    const track = createTrack('native-handle');
    delete track.absolutePath;
    track.handle = 'C:\\Music\\native-handle.flac';
    track.path = 'file:///C:/Music/native-handle.flac';

    const sdk = createFakeSdk(track);
    const engine = createFakeEngine();
    const { controller } = createController({ sdk, engine });

    await controller.start();

    assert.equal(engine.setTrackCalls.length, 1);
    assert.equal(
        engine.setTrackCalls[0].track.absolutePath,
        track.handle
    );
    assert.equal(controller.getSnapshot().trackPath, track.handle);
    controller.dispose();
});


test('PlaybackClock state remains usable when getState is unavailable', async () => {
    const sdk = createFakeSdk(createTrack('clock-fallback'), {
        getState: async () => {
            throw new Error('state query temporarily unavailable');
        }
    });
    const { controller } = createController({ sdk });

    const snapshot = await controller.start();

    assert.equal(snapshot.playbackState, 'playing');
    assert.equal(snapshot.canSeek, false);
    controller.dispose();
});


test('remote audio URLs do not enter the local PCM decoder', async () => {
    const remoteTrack = {
        ...createTrack('stream'),
        absolutePath: 'https://example.invalid/audio/stream.mp3',
        handle: 'https://example.invalid/audio/stream.mp3',
        path: 'https://example.invalid/audio/stream.mp3'
    };
    const { controller, sdk, engine } = createController();
    await controller.start();

    sdk.emit('playback:trackChanged', remoteTrack);
    await controller.whenTrackChangeSettled();

    assert.equal(engine.setTrackCalls.length, 1);
    assert.equal(controller.getSnapshot().trackKey, null);
    assert.equal(controller.getSnapshot().canSeek, false);
    controller.dispose();
});


test('refreshes seek capability when the active track changes', async () => {
    let canSeek = true;
    let stateReads = 0;
    const sdk = createFakeSdk(createTrack('seekable'), {
        getState: async () => {
            stateReads += 1;
            return {
                success: true,
                state: 'playing',
                canPause: true,
                canSeek
            };
        }
    });
    const { controller } = createController({ sdk });

    await controller.start();
    assert.equal(controller.getSnapshot().canSeek, true);

    canSeek = false;
    sdk.emit('playback:trackChanged', createTrack('stream'));
    await controller.whenTrackChangeSettled();

    assert.equal(stateReads, 2);
    assert.equal(controller.getSnapshot().canSeek, false);
    controller.dispose();
});


test('converts a local file URL to a native Windows path when no native path is supplied', async () => {
    const track = createTrack('file-url');
    delete track.absolutePath;
    delete track.handle;
    track.path = 'file:///C:/Music/file%20url.flac';

    const sdk = createFakeSdk(track);
    const engine = createFakeEngine();
    const { controller } = createController({ sdk, engine });

    await controller.start();

    assert.equal(engine.setTrackCalls.length, 1);
    assert.equal(
        engine.setTrackCalls[0].track.absolutePath,
        'C:\\Music\\file url.flac'
    );
    controller.dispose();
});
