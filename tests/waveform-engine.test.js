import test from 'node:test';
import assert from 'node:assert/strict';
import { reducePcmChannelsToPeaks } from '../src/services/waveform/peakReducer.js';
import {
    buildWaveformTrackIdentity,
    chooseWaveformSegmentDuration,
    getWaveformSegmentRange
} from '../src/services/waveform/waveformIdentity.js';
import { WaveformCache } from '../src/services/waveform/waveformCache.js';
import { WaveformScheduler } from '../src/services/waveform/waveformScheduler.js';
import { decodeWaveformSegment } from '../src/services/waveform/waveformDecoder.js';

function makeMemorySdk(profilePath = 'C:\\\\Users\\\\Test\\\\foobar2000-v2') {
    const files = new Map();
    return {
        files,
        sdk: {
            misc: {
                async getProfilePath() {
                    return { success: true, path: profilePath };
                }
            },
            file: {
                async mkdir() { return { success: true, created: true }; },
                async exists(path) {
                    return {
                        success: true,
                        exists: files.has(path),
                        isFile: files.has(path)
                    };
                },
                async writeBinary(path, bytes, options) {
                    assert.equal(options?.atomic, true);
                    files.set(path, new Uint8Array(bytes));
                    return { success: true, bytesWritten: bytes.byteLength };
                },
                async readBinary(path) {
                    if (!files.has(path)) throw new Error('NOT_FOUND');
                    return new Uint8Array(files.get(path));
                },
                async write(path, content, options) {
                    assert.equal(options?.atomic, true);
                    files.set(path, String(content));
                    return { success: true };
                },
                async read(path) {
                    if (!files.has(path)) throw new Error('NOT_FOUND');
                    return { success: true, content: files.get(path) };
                },
                async getInfo() {
                    return {
                        success: true,
                        exists: true,
                        isFile: true,
                        size: 4096,
                        modified: 1700000000000
                    };
                }
            }
        }
    };
}

function makeIdentity(overrides = {}) {
    return buildWaveformTrackIdentity({
        absolutePath: 'D:\\\\Audio\\\\Track.flac',
        handle: 'D:\\\\Audio\\\\Track.flac',
        duration: 8,
        fileSize: 4096,
        sampleRate: 48000,
        channels: 2,
        subsong: 0,
        ...overrides
    }, { size: 4096, modified: 1700000000000 });
}

function makeCacheStub() {
    const segments = new Map();
    return {
        segments,
        async readSegment(index) { return segments.get(index) || null; },
        async saveSegment(segment) {
            segments.set(segment.index, { ...segment, cached: true });
        },
        getCompletedIndexes() { return Array.from(segments.keys()); }
    };
}

function makeSegment(index, start, end) {
    return {
        index,
        start,
        end,
        frames: 48000,
        sampleRate: 48000,
        channels: 2,
        peaks: new Float32Array([0.2, 0.7])
    };
}

async function waitFor(predicate, timeoutMs = 1000) {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeoutMs) throw new Error('Timeout esperando la condición de prueba.');
        await new Promise(resolve => setTimeout(resolve, 2));
    }
}

function makeWorkerFactory() {
    return () => ({
        onmessage: null,
        onerror: null,
        postMessage(message) {
            const channels = message.channels.map(buffer => new Float32Array(buffer));
            const peaks = reducePcmChannelsToPeaks(channels, message.bucketCount);
            queueMicrotask(() => this.onmessage?.({
                data: { requestId: message.requestId, success: true, peaks: peaks.buffer }
            }));
        },
        terminate() {}
    });
}

function makePcm(channels, options = {}) {
    let released = false;
    return {
        available: true,
        channels: channels.length,
        frames: channels[0].length,
        start: options.start ?? 0,
        duration: options.duration ?? 1,
        sampleRate: options.sampleRate ?? 48000,
        truncated: options.truncated ?? false,
        resampled: false,
        getChannelView(index) { return channels[index]; },
        release() { released = true; },
        wasReleased() { return released; }
    };
}

test('track identity includes path, subsong, size, modification time and duration', () => {
    const base = makeIdentity();
    assert.equal(base.key.length, 16);
    assert.equal(makeIdentity().key, base.key);
    assert.notEqual(
        makeIdentity({ subsong: 1 }).key,
        base.key
    );
    assert.notEqual(
        buildWaveformTrackIdentity({
            absolutePath: 'D:\\\\Audio\\\\Track.flac',
            duration: 8,
            fileSize: 4096,
            sampleRate: 48000,
            channels: 2
        }, { size: 4096, modified: 1700000001000 }).key,
        base.key
    );
});

test('adaptive segment duration respects the PCM memory target and configured bounds', () => {
    assert.equal(chooseWaveformSegmentDuration({
        sampleRate: 48000, channels: 2
    }, { targetPcmBytes: 12 * 1024 * 1024, minimumSeconds: 1, maximumSeconds: 10 }), 10);

    assert.equal(chooseWaveformSegmentDuration({
        sampleRate: 192000, channels: 8
    }, { targetPcmBytes: 12 * 1024 * 1024, minimumSeconds: 1, maximumSeconds: 10 }), 2);
});

test('segment ranges clamp the final range to the exact track duration', () => {
    assert.deepEqual(getWaveformSegmentRange(3, 7.5, 2), {
        index: 3, start: 6, end: 7.5
    });
    assert.equal(getWaveformSegmentRange(4, 7.5, 2), null);
});

test('waveform segments persist independently and are recovered by a new cache instance', async () => {
    const storage = makeMemorySdk();
    const identity = makeIdentity();
    const options = {
        sdk: storage.sdk,
        identity,
        duration: 8,
        segmentSeconds: 2,
        resolution: 4096
    };
    const first = await WaveformCache.open(options);
    await first.saveSegment(makeSegment(1, 2, 4));
    assert.deepEqual(first.getCompletedIndexes(), [1]);

    const reopened = await WaveformCache.open(options);
    const recovered = await reopened.readSegment(1);
    assert.equal(recovered.cached, true);
    assert.equal(recovered.index, 1);
    assert.equal(recovered.start, 2);
    assert.ok(Math.abs(recovered.peaks[0] - 0.2) < 1e-6);
    assert.ok(Math.abs(recovered.peaks[1] - 0.7) < 1e-6);
});

test('waveform cache refuses to reuse segments after the segment configuration changes', async () => {
    const storage = makeMemorySdk();
    const identity = makeIdentity();
    const first = await WaveformCache.open({
        sdk: storage.sdk, identity, duration: 8, segmentSeconds: 2, resolution: 4096
    });
    await first.saveSegment(makeSegment(0, 0, 2));

    const changed = await WaveformCache.open({
        sdk: storage.sdk, identity, duration: 8, segmentSeconds: 4, resolution: 4096
    });
    assert.deepEqual(changed.getCompletedIndexes(), []);
    assert.equal(await changed.readSegment(0), null);
});

test('corrupt cached segment is treated as a miss and removed from the manifest', async () => {
    const storage = makeMemorySdk();
    const identity = makeIdentity();
    const cache = await WaveformCache.open({
        sdk: storage.sdk, identity, duration: 8, segmentSeconds: 2, resolution: 4096
    });
    await cache.saveSegment(makeSegment(0, 0, 2));
    const path = cache.getSegmentPath(0);
    storage.files.set(path, new Uint8Array([1, 2, 3]));

    assert.equal(await cache.readSegment(0), null);
    assert.deepEqual(cache.getCompletedIndexes(), []);
});

test('scheduler starts at the playing segment, then covers upcoming audio before earlier audio', async () => {
    const cache = makeCacheStub();
    const order = [];
    const scheduler = new WaveformScheduler({
        resolution: 64,
        segmentDurationOptions: { minimumSeconds: 2, maximumSeconds: 2, targetPcmBytes: 1 },
        decodeSegment: async request => {
            order.push(request.index);
            return makeSegment(request.index, request.start, request.end);
        }
    });
    scheduler.setTrack({
        id: 'A', duration: 8, sampleRate: 48000, channels: 2
    }, cache, 4.1);

    await waitFor(() => scheduler.getSnapshot().status === 'complete');
    assert.deepEqual(order, [2, 3, 0, 1]);
    scheduler.dispose();
});

test('switching tracks aborts the previous decode and never publishes stale segments', async () => {
    const cacheA = makeCacheStub();
    const cacheB = makeCacheStub();
    let startedAResolve;
    const startedA = new Promise(resolve => { startedAResolve = resolve; });
    const aborted = [];
    const published = [];

    const scheduler = new WaveformScheduler({
        resolution: 64,
        segmentDurationOptions: { minimumSeconds: 2, maximumSeconds: 2, targetPcmBytes: 1 },
        onSegment: segment => published.push(segment),
        decodeSegment: request => {
            if (request.track.id === 'A') {
                startedAResolve();
                return new Promise((resolve, reject) => {
                    request.signal.addEventListener('abort', () => {
                        aborted.push(request.track.id);
                        const error = new Error('Aborted');
                        error.name = 'AbortError';
                        reject(error);
                    }, { once: true });
                });
            }
            return Promise.resolve(makeSegment(request.index, request.start, request.end));
        }
    });

    scheduler.setTrack({
        id: 'A', duration: 8, sampleRate: 48000, channels: 2
    }, cacheA, 0);
    await startedA;
    scheduler.setTrack({
        id: 'B', duration: 4, sampleRate: 48000, channels: 2
    }, cacheB, 2.1);

    await waitFor(() => scheduler.getSnapshot().status === 'complete');
    assert.deepEqual(aborted, ['A']);
    assert.ok(published.length > 0);
    assert.ok(published.every(segment => segment.index >= 0));
    assert.equal(cacheA.segments.size, 0);
    assert.equal(cacheB.segments.size, 2);
    scheduler.dispose();
});

test('seeking far from the active segment cancels it and prioritizes the requested region', async () => {
    const cache = makeCacheStub();
    const started = [];
    const aborted = [];
    let initialResolve;
    const initial = new Promise(resolve => { initialResolve = resolve; });
    const order = [];

    const scheduler = new WaveformScheduler({
        resolution: 64,
        segmentDurationOptions: { minimumSeconds: 2, maximumSeconds: 2, targetPcmBytes: 1 },
        decodeSegment: request => {
            order.push(request.index);
            if (request.index === 0 && started.length === 0) {
                started.push(0);
                initialResolve();
                return new Promise((resolve, reject) => {
                    request.signal.addEventListener('abort', () => {
                        aborted.push(0);
                        const error = new Error('Aborted');
                        error.name = 'AbortError';
                        reject(error);
                    }, { once: true });
                });
            }
            return Promise.resolve(makeSegment(request.index, request.start, request.end));
        }
    });

    scheduler.setTrack({
        id: 'A', duration: 8, sampleRate: 48000, channels: 2
    }, cache, 0);
    await initial;
    scheduler.setPosition(6.2);

    await waitFor(() => scheduler.getSnapshot().status === 'complete');
    assert.deepEqual(aborted, [0]);
    assert.equal(order[1], 3);
    scheduler.dispose();
});

test('decoder splits a truncated PCM range and returns a complete combined segment', async () => {
    const calls = [];
    const pcmBuffers = [];
    const sdk = {
        audio: {
            async decodePcm(path, options) {
                calls.push({ path, start: options.start, end: options.end });
                const truncated = options.start === 0 && options.end === 4;
                const pcm = makePcm([
                    new Float32Array([0.1, -0.4, 0.2, -0.8]),
                    new Float32Array([0.2, 0.3, -0.1, 0.7])
                ], {
                    start: options.start,
                    duration: options.end - options.start,
                    truncated
                });
                pcmBuffers.push(pcm);
                return pcm;
            }
        }
    };

    const result = await decodeWaveformSegment({
        sdk,
        track: { decodePath: 'D:\\\\Audio\\\\Track.flac', duration: 4 },
        index: 0,
        start: 0,
        end: 4,
        resolution: 64,
        workerFactory: makeWorkerFactory()
    });

    assert.deepEqual(calls, [
        { path: 'D:\\\\Audio\\\\Track.flac', start: 0, end: 4 },
        { path: 'D:\\\\Audio\\\\Track.flac', start: 0, end: 2 },
        { path: 'D:\\\\Audio\\\\Track.flac', start: 2, end: 4 }
    ]);
    assert.equal(result.splitDepth, 1);
    assert.equal(result.peaks.length, 64);
    assert.equal(pcmBuffers.every(pcm => pcm.wasReleased()), true);
});

test('decoder rejects a segment that remains truncated after the split limit', async () => {
    const pcmBuffers = [];
    const sdk = {
        audio: {
            async decodePcm(path, options) {
                const pcm = makePcm([new Float32Array([0.1, 0.2])], {
                    start: options.start,
                    duration: options.end - options.start,
                    truncated: true
                });
                pcmBuffers.push(pcm);
                return pcm;
            }
        }
    };

    await assert.rejects(
        decodeWaveformSegment({
            sdk,
            track: { decodePath: 'D:\\\\Audio\\\\Track.flac', duration: 1 },
            index: 0,
            start: 0,
            end: 1,
            resolution: 64,
            workerFactory: makeWorkerFactory()
        }),
        error => error.code === 'PCM_TRUNCATED'
    );
    assert.equal(pcmBuffers.every(pcm => pcm.wasReleased()), true);
});


test('scheduler reports partial completion and retries failed segments explicitly', async () => {
    const cache = makeCacheStub();
    let firstFailure = true;
    const scheduler = new WaveformScheduler({
        resolution: 64,
        segmentDurationOptions: { minimumSeconds: 2, maximumSeconds: 2, targetPcmBytes: 1 },
        decodeSegment: async request => {
            if (request.index === 0 && firstFailure) {
                firstFailure = false;
                throw new Error('Synthetic decode failure');
            }
            return makeSegment(request.index, request.start, request.end);
        }
    });

    scheduler.setTrack({
        id: 'A', duration: 4, sampleRate: 48000, channels: 2
    }, cache, 0);

    await waitFor(() => scheduler.getSnapshot().status === 'partial');
    assert.equal(scheduler.getSnapshot().failedSegments, 1);
    assert.equal(scheduler.getSnapshot().completedSegments, 1);

    scheduler.retryFailed();
    await waitFor(() => scheduler.getSnapshot().status === 'complete');
    assert.equal(scheduler.getSnapshot().failedSegments, 0);
    assert.equal(scheduler.getSnapshot().completedSegments, 2);
    scheduler.dispose();
});
