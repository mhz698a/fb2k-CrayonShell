import test from 'node:test';
import assert from 'node:assert/strict';
import { reducePcmChannelsToPeaks } from '../src/services/waveform/peakReducer.js';
import {
    buildWaveformTrackIdentity,
    chooseWaveformSegmentDuration,
    getWaveformSegmentRange
} from '../src/services/waveform/waveformIdentity.js';
import { WaveformCache } from '../src/services/waveform/waveformCache.js';
import { WaveformCacheManager } from '../src/services/waveform/waveformCacheManager.js';
import { WaveformScheduler } from '../src/services/waveform/waveformScheduler.js';
import { WaveformEngine } from '../src/services/waveform/waveformEngine.js';
import { decodeWaveformSegment } from '../src/services/waveform/waveformDecoder.js';

function makeMemorySdk(profilePath = 'C:\\\\Users\\\\Test\\\\foobar2000-v2') {
    const files = new Map();
    const handlers = new Map();
    let operationSequence = 0;

    function emit(eventName, payload) {
        for (const handler of handlers.get(eventName) || []) handler(payload);
    }

    function getSize(value) {
        if (value instanceof Uint8Array) return value.byteLength;
        return new TextEncoder().encode(String(value)).byteLength;
    }

    return {
        files,
        sdk: {
            audio: {},
            misc: {
                async getProfilePath() {
                    return { success: true, path: profilePath };
                }
            },
            on(eventName, handler) {
                if (!handlers.has(eventName)) handlers.set(eventName, new Set());
                handlers.get(eventName).add(handler);
                return () => handlers.get(eventName)?.delete(handler);
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
                async list(path, options = {}) {
                    const prefix = String(path).replace(/[\\\\/]+$/, '') + '\\';
                    const extension = String(options.pattern || '*').startsWith('*.') 
                        ? String(options.pattern).slice(1).toLowerCase()
                        : '';
                    const names = [];
                    for (const filePath of files.keys()) {
                        if (!filePath.toLowerCase().startsWith(prefix.toLowerCase())) continue;
                        const name = filePath.slice(prefix.length);
                        if (name.includes('\\')) continue;
                        if (!extension || name.toLowerCase().endsWith(extension)) names.push(name);
                    }
                    return { success: true, files: names, directories: [], items: names };
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
                async write(path, value, options) {
                    assert.equal(options?.atomic, true);
                    files.set(path, String(value));
                    return { success: true };
                },
                async read(path) {
                    if (!files.has(path)) throw new Error('NOT_FOUND');
                    return { success: true, content: String(files.get(path)) };
                },
                async getInfo(path) {
                    if (files.has(path)) {
                        return {
                            success: true,
                            exists: true,
                            isFile: true,
                            size: getSize(files.get(path)),
                            modified: 1700000000000
                        };
                    }
                    const normalized = String(path).toLowerCase();
                    const profilePrefix = String(profilePath).toLowerCase().replace(/[\\\\/]+$/, '') + '\\';
                    if (normalized.startsWith(profilePrefix)) {
                        return { success: true, exists: false };
                    }
                    return {
                        success: true,
                        exists: true,
                        isFile: true,
                        size: 4096,
                        modified: 1700000000000
                    };
                },
                async deleteAsync(paths, options) {
                    assert.equal(options?.moveToTrash, false);
                    const operationId = 'fileop_test_' + (++operationSequence);
                    const results = paths.map(source => {
                        if (!files.has(source)) return { source, status: 'failed', reason: 'not-found' };
                        files.delete(source);
                        return { source, status: 'ok' };
                    });
                    const successCount = results.filter(item => item.status === 'ok').length;
                    const failureCount = results.length - successCount;
                    queueMicrotask(() => {
                        emit('file:opProgress', {
                            operationId, op: 'delete', done: results.length,
                            total: results.length, results
                        });
                        emit('file:opComplete', {
                            operationId, op: 'delete', total: results.length,
                            successCount, skippedCount: 0, failureCount, cancelled: false
                        });
                    });
                    return { success: true, operationId, totalCount: paths.length };
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
    const firstManifest = JSON.parse(storage.files.get(first.manifestPath));
    assert.equal(firstManifest.segmentBytes['1'], storage.files.get(first.getSegmentPath(1)).byteLength);
    assert.ok(firstManifest.lastAccessAt > 0);

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


test('adaptive segmentation drops below one second for very high-rate multichannel PCM', () => {
    assert.equal(chooseWaveformSegmentDuration({
        sampleRate: 768000, channels: 8
    }, { targetPcmBytes: 12 * 1024 * 1024, maximumSeconds: 10 }), 0.25);
});


test('engine fails fast when the WebView2 runtime cannot receive shared PCM buffers', async () => {
    const storage = makeMemorySdk();
    storage.sdk.audio.getPcmDebugState = async () => ({
        success: true,
        runtime: { environment12: true, webview17: false, version: 'test' },
        decode: { active: 0, queued: 0, openBufferBytes: 0 }
    });
    let decodeCalled = false;
    storage.sdk.audio.decodePcm = async () => {
        decodeCalled = true;
        throw new Error('decodePcm must not run');
    };
    const engine = new WaveformEngine({ sdk: storage.sdk });

    await assert.rejects(
        engine.setTrack({
            absolutePath: 'D:\\\\Audio\\\\Unsupported.flac',
            handle: 'D:\\\\Audio\\\\Unsupported.flac',
            duration: 4,
            fileSize: 4096,
            sampleRate: 48000,
            channels: 2,
            subsong: 0
        }),
        error => error.code === 'PCM_SHARED_BUFFER_UNAVAILABLE'
            && error.diagnostics.webview17 === false
    );
    assert.equal(decodeCalled, false);
    engine.dispose();
});

test('WaveformEngine decodes, persists and publishes sequential segments', async () => {
    const storage = makeMemorySdk();
    storage.sdk.audio.getPcmDebugState = async () => ({
        success: true,
        runtime: { environment12: true, webview17: true, version: 'test' },
        decode: { active: 0, queued: 0, openBufferBytes: 0 }
    });
    storage.sdk.audio.decodePcm = async (_path, options) => makePcm([
        new Float32Array([0.1, -0.4, 0.2, -0.8]),
        new Float32Array([0.2, 0.3, -0.1, 0.7])
    ], {
        start: options.start,
        duration: options.end - options.start,
        sampleRate: 48000
    });

    const published = [];
    const engine = new WaveformEngine({
        sdk: storage.sdk,
        resolution: 64,
        segmentDurationOptions: {
            minimumSeconds: 1,
            maximumSeconds: 1,
            targetPcmBytes: 1
        },
        workerFactory: makeWorkerFactory(),
        onSegment: segment => published.push(segment)
    });

    const result = await engine.setTrack({
        absolutePath: 'D:\\\\Audio\\\\Engine.flac',
        handle: 'D:\\\\Audio\\\\Engine.flac',
        duration: 2,
        fileSize: 4096,
        sampleRate: 48000,
        channels: 2,
        subsong: 0
    }, 0);

    assert.equal(result.totalSegments, 2);
    await waitFor(() => engine.getSnapshot().status === 'complete');
    assert.deepEqual(published.map(segment => segment.index), [0, 1]);
    assert.ok(Array.from(storage.files.keys()).some(path => path.endsWith('.000000.wfs')));
    assert.ok(Array.from(storage.files.keys()).some(path => path.endsWith('.000001.wfs')));
    const indexPath = Array.from(storage.files.keys()).find(path => path.endsWith('index.wfi'));
    assert.ok(indexPath);
    const cacheIndex = JSON.parse(storage.files.get(indexPath));
    assert.equal(cacheIndex.entries.length, 1);
    assert.equal(cacheIndex.entries[0].segmentCount, 2);
    assert.ok(cacheIndex.entries[0].sizeBytes > 0);
    engine.dispose();
});


function seedCacheEntry(storage, rootPath, key, lastAccessAt, segmentBytes = 300) {
    const manifestPath = rootPath + '\\' + key + '.wfm';
    const segmentPath = rootPath + '\\' + key + '.000000.wfs';
    const manifest = {
        format: 'CrayonShellWaveformCache',
        version: 1,
        key,
        identity: JSON.stringify({ path: 'd:\\\\audio\\\\' + key + '.flac', subsong: 0 }),
        duration: 1,
        segmentSeconds: 1,
        resolution: 64,
        segments: [0],
        segmentBytes: { 0: segmentBytes },
        createdAt: lastAccessAt,
        lastAccessAt,
        updatedAt: lastAccessAt
    };
    storage.files.set(manifestPath, JSON.stringify(manifest));
    storage.files.set(segmentPath, new Uint8Array(segmentBytes));
    return { manifestPath, segmentPath, manifest };
}

test('cache manager rebuilds inventory and removes orphan and invalid cache files asynchronously', async () => {
    const storage = makeMemorySdk('D:\\\\Profiles\\\\Test');
    const manager = new WaveformCacheManager({
        sdk: storage.sdk,
        maxBytes: 1024 * 1024,
        maintenanceIntervalMs: 0
    });
    const initial = await manager.initialize();
    assert.equal(initial.cachedTracks, 0);

    const root = initial.root;
    const validKey = '0000000000000001';
    const invalidKey = '0000000000000002';
    const missingManifestKey = '0000000000000003';
    const valid = seedCacheEntry(storage, root, validKey, 1000, 120);
    const invalidManifestPath = root + '\\' + invalidKey + '.wfm';
    const invalidSegmentPath = root + '\\' + invalidKey + '.000000.wfs';
    const orphanSegmentPath = root + '\\' + missingManifestKey + '.000004.wfs';
    storage.files.set(invalidManifestPath, '{ invalid json');
    storage.files.set(invalidSegmentPath, new Uint8Array(80));
    storage.files.set(orphanSegmentPath, new Uint8Array(64));

    const snapshot = await manager.maintain({ force: true });
    assert.equal(snapshot.cachedTracks, 1);
    assert.equal(snapshot.cachedSegments, 1);
    assert.equal(snapshot.usedBytes > 120, true);
    assert.equal(storage.files.has(valid.manifestPath), true);
    assert.equal(storage.files.has(valid.segmentPath), true);
    assert.equal(storage.files.has(invalidManifestPath), false);
    assert.equal(storage.files.has(invalidSegmentPath), false);
    assert.equal(storage.files.has(orphanSegmentPath), false);
    assert.equal(storage.files.has(root + '\\index.wfi'), true);
    manager.setActiveTrackKey(null);
});

test('cache manager evicts least-recently-used tracks and protects the active track', async () => {
    const storage = makeMemorySdk('D:\\\\Profiles\\\\Lru');
    const manager = new WaveformCacheManager({
        sdk: storage.sdk,
        maxBytes: 1,
        maintenanceIntervalMs: 0
    });
    const initial = await manager.initialize();
    const oldestKey = '0000000000000011';
    const activeKey = '0000000000000022';
    const oldest = seedCacheEntry(storage, initial.root, oldestKey, 1000, 300);
    const active = seedCacheEntry(storage, initial.root, activeKey, 2000, 300);

    const snapshot = await manager.maintain({
        force: true,
        activeTrackKey: activeKey
    });
    assert.equal(snapshot.cachedTracks, 1);
    assert.equal(snapshot.entries[0].key, activeKey);
    assert.equal(storage.files.has(oldest.manifestPath), false);
    assert.equal(storage.files.has(oldest.segmentPath), false);
    assert.equal(storage.files.has(active.manifestPath), true);
    assert.equal(storage.files.has(active.segmentPath), true);
    assert.equal(snapshot.overBudget, true);
    manager.setActiveTrackKey(null);
});


test('manual cache cleanup removes inactive tracks but keeps the active track', async () => {
    const storage = makeMemorySdk('D:\\\\Profiles\\\\ManualCleanup');
    const manager = new WaveformCacheManager({
        sdk: storage.sdk,
        maxBytes: 1024 * 1024,
        maintenanceIntervalMs: 0
    });
    const initial = await manager.initialize();
    const inactiveKey = '0000000000000033';
    const activeKey = '0000000000000044';
    const inactive = seedCacheEntry(storage, initial.root, inactiveKey, 1000, 64);
    const active = seedCacheEntry(storage, initial.root, activeKey, 2000, 64);

    await manager.maintain({ force: true, activeTrackKey: activeKey });
    const result = await manager.clearInactive();

    assert.equal(result.removedTracks, 1);
    assert.equal(result.cachedTracks, 1);
    assert.equal(result.entries[0].key, activeKey);
    assert.equal(storage.files.has(inactive.manifestPath), false);
    assert.equal(storage.files.has(inactive.segmentPath), false);
    assert.equal(storage.files.has(active.manifestPath), true);
    assert.equal(storage.files.has(active.segmentPath), true);
});
