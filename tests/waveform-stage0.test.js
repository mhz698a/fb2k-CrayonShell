import test from 'node:test';
import assert from 'node:assert/strict';
import {
    reducePcmChannelsToPeaks,
    copyPcmChannels
} from '../src/services/waveform/peakReducer.js';
import {
    decodeWaveformProbe,
    encodeWaveformProbe
} from '../src/services/waveform/probeCacheFormat.js';
import {
    runWaveformStage0Probe,
    runWaveformCancellationProbe,
    inspectWaveformStage0Probe
} from '../src/services/waveform/stage0Probe.js';

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

function makeSdk(profilePath = 'C:\\Users\\Test\\foobar2000-v2') {
    const files = new Map();
    const sdk = {
        audio: {
            async getPcmDebugState() {
                return {
                    success: true,
                    runtime: { version: 'test', environment12: true, webview17: true },
                    decode: { active: 0, queued: 0, openBufferBytes: 0 }
                };
            }
        },
        misc: { async getProfilePath() { return { success: true, path: profilePath }; } },
        file: {
            async mkdir() { return { success: true }; },
            async exists(filePath) {
                return { success: true, exists: files.has(filePath), isFile: files.has(filePath) };
            },
            async writeBinary(filePath, bytes, options) {
                assert.equal(options.atomic, true);
                files.set(filePath, new Uint8Array(bytes));
                return { success: true };
            },
            async readBinary(filePath) {
                if (!files.has(filePath)) throw new Error('NOT_FOUND');
                return new Uint8Array(files.get(filePath));
            }
        }
    };
    return { sdk, files };
}

test('peak reducer computes absolute peaks across all PCM channels', () => {
    const peaks = reducePcmChannelsToPeaks([
        new Float32Array([0.1, -0.8, 0.2, 0.1]),
        new Float32Array([-0.9, 0.1, 0.7, -0.2])
    ], 2);
    assert.ok(Math.abs(peaks[0] - 0.9) < 1e-6);
    assert.ok(Math.abs(peaks[1] - 0.7) < 1e-6);
});

test('PCM copies are independent of SDK read-only views', () => {
    const pcm = makePcm([new Float32Array([0.2, 0.8])]);
    const copies = copyPcmChannels(pcm);
    copies[0][0] = 0.9;
    assert.equal(pcm.getChannelView(0)[0], 0.2);
});

test('binary probe codec round-trips validated waveform data', () => {
    const bytes = encodeWaveformProbe({
        identity: 'c:\\music\\track.flac|0|5|2',
        start: 0, end: 5, frames: 240000, sampleRate: 48000,
        channels: 2, peaks: new Float32Array([0, 0.25, 1])
    });
    const result = decodeWaveformProbe(bytes);
    assert.equal(result.identity, 'c:\\music\\track.flac|0|5|2');
    assert.deepEqual(Array.from(result.peaks), [0, 0.25, 1]);
});

test('stage-0 probe decodes PCM, reduces it in a Worker and verifies atomic persistence', async () => {
    const storage = makeSdk();
    const pcm = makePcm([
        new Float32Array([0, 0.5, -0.25, -0.9]),
        new Float32Array([0.1, -0.4, 0.6, 0.2])
    ], { duration: 2, sampleRate: 2 });
    storage.sdk.audio.decodePcm = async (path, options) => {
        assert.equal(path, 'C:\\Music\\probe.flac');
        assert.equal(options.start, 0);
        assert.equal(options.end, 2);
        assert.equal(options.mono, false);
        return pcm;
    };

    const result = await runWaveformStage0Probe({
        sdk: storage.sdk,
        path: 'C:\\Music\\probe.flac',
        durationSeconds: 2,
        bucketCount: 2,
        workerFactory: makeWorkerFactory()
    });
    assert.equal(result.status, 'passed');
    assert.equal(result.persistence.atomicWriteReadback, true);
    assert.ok(Math.abs(result.peakPreview[0] - 0.5) < 1e-6);
    assert.ok(Math.abs(result.peakPreview[1] - 0.9) < 1e-6);
    assert.equal(pcm.wasReleased(), true);
});

test('stage-0 probe detects the previous segment from persistent storage', async () => {
    const storage = makeSdk();
    const pcm = makePcm([new Float32Array([0.2, 0.4])]);
    storage.sdk.audio.decodePcm = async () => pcm;
    const options = {
        sdk: storage.sdk,
        path: 'C:\\Music\\same.flac',
        durationSeconds: 1,
        bucketCount: 2,
        workerFactory: makeWorkerFactory()
    };
    await runWaveformStage0Probe(options);
    const inspected = await inspectWaveformStage0Probe(options);
    assert.equal(inspected.found, true);
    assert.equal(inspected.matchesRequestedSegment, true);
});

test('cancellation probe distinguishes an AbortError from successful completion', async () => {
    const storage = makeSdk();
    storage.sdk.audio.decodePcm = (_path, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
        }, { once: true });
    });
    const result = await runWaveformCancellationProbe({
        sdk: storage.sdk, path: 'C:\\Music\\long.flac', abortAfterMs: 1
    });
    assert.equal(result.outcome, 'cancelled');
});

test('truncated PCM is released and never persisted as a complete segment', async () => {
    const storage = makeSdk();
    const pcm = makePcm([new Float32Array([0.2, 0.4])], { truncated: true });
    storage.sdk.audio.decodePcm = async () => pcm;
    await assert.rejects(
        runWaveformStage0Probe({
            sdk: storage.sdk,
            path: 'C:\\Music\\truncated.flac',
            durationSeconds: 1,
            workerFactory: makeWorkerFactory()
        }),
        /truncado/
    );
    assert.equal(pcm.wasReleased(), true);
    assert.equal(storage.files.size, 0);
});

test('stage-0 probe refuses runtimes without WebView2 shared-buffer support', async () => {
    const storage = makeSdk();
    storage.sdk.audio.getPcmDebugState = async () => ({
        success: true,
        runtime: { environment12: true, webview17: false },
        decode: { active: 0, queued: 0, openBufferBytes: 0 }
    });
    storage.sdk.audio.decodePcm = async () => {
        throw new Error('decodePcm must not run');
    };
    await assert.rejects(
        runWaveformStage0Probe({ sdk: storage.sdk, path: 'C:\\Music\\track.flac' }),
        error => error.diagnostics?.webview17 === false
    );
});
