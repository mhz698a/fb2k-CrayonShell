import { reducePcmToPeaksInWorker } from './peakReducer.js';
import { getWaveformBucketCount } from './waveformIdentity.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TRUNCATION_SPLITS = 4;
const MIN_SPLIT_SECONDS = 0.25;

function throwIfAborted(signal) {
    if (signal?.aborted) {
        throw new DOMException('La decodificación waveform fue cancelada.', 'AbortError');
    }
}

async function decodeRange({
    sdk,
    track,
    start,
    end,
    totalDuration,
    bucketCount,
    signal,
    timeoutMs,
    workerFactory,
    splitDepth
}) {
    throwIfAborted(signal);
    const pcm = await sdk.audio.decodePcm(track.decodePath, {
        start,
        end,
        mono: false,
        timeoutMs,
        signal
    });

    const pcmInfo = {
        start: pcm.start,
        duration: pcm.duration,
        frames: pcm.frames,
        sampleRate: pcm.sampleRate,
        channels: pcm.channels,
        truncated: pcm.truncated === true,
        resampled: pcm.resampled === true
    };

    if (pcmInfo.truncated) {
        pcm.release();
        const rangeDuration = end - start;
        if (splitDepth >= MAX_TRUNCATION_SPLITS || rangeDuration <= MIN_SPLIT_SECONDS) {
            const error = new Error(
                'El host sigue devolviendo PCM truncado después de dividir el rango en segmentos menores.'
            );
            error.code = 'PCM_TRUNCATED';
            throw error;
        }

        const midpoint = start + rangeDuration / 2;
        const leftBuckets = Math.max(1, Math.floor(bucketCount / 2));
        const rightBuckets = Math.max(1, bucketCount - leftBuckets);
        const common = {
            sdk, track, totalDuration, signal, timeoutMs, workerFactory,
            splitDepth: splitDepth + 1
        };
        const left = await decodeRange({
            ...common, start, end: midpoint, bucketCount: leftBuckets
        });
        const right = await decodeRange({
            ...common, start: midpoint, end, bucketCount: rightBuckets
        });

        const peaks = new Float32Array(left.peaks.length + right.peaks.length);
        peaks.set(left.peaks, 0);
        peaks.set(right.peaks, left.peaks.length);
        return {
            start,
            end,
            frames: left.frames + right.frames,
            sampleRate: left.sampleRate,
            channels: Math.max(left.channels, right.channels),
            peaks,
            splitDepth: splitDepth + 1
        };
    }

    if (!Number.isInteger(pcmInfo.frames) || pcmInfo.frames < 1
        || !Number.isInteger(pcmInfo.sampleRate) || pcmInfo.sampleRate < 1
        || !Number.isInteger(pcmInfo.channels) || pcmInfo.channels < 1) {
        pcm.release();
        throw new Error('decodePcm devolvió metadatos PCM incompletos.');
    }

    const peaks = await reducePcmToPeaksInWorker(pcm, bucketCount, {
        workerFactory,
        signal
    });

    throwIfAborted(signal);
    return {
        start,
        end,
        frames: pcmInfo.frames,
        sampleRate: pcmInfo.sampleRate,
        channels: pcmInfo.channels,
        peaks,
        splitDepth
    };
}

export async function decodeWaveformSegment(options = {}) {
    const {
        sdk,
        track,
        index,
        start,
        end,
        resolution = 4096,
        signal,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        workerFactory
    } = options;

    if (typeof sdk?.audio?.decodePcm !== 'function') {
        throw new Error('foo_ui_webview2 no expone audio.decodePcm().');
    }
    if (!track?.decodePath || !Number.isInteger(index) || index < 0
        || !Number.isFinite(track.duration) || track.duration <= 0
        || !Number.isFinite(start) || !Number.isFinite(end) || end <= start
        || end > track.duration + 0.001) {
        throw new RangeError('La solicitud de decodificación del segmento no es válida.');
    }

    const bucketCount = getWaveformBucketCount(end - start, track.duration, resolution);
    const decoded = await decodeRange({
        sdk,
        track,
        index,
        start,
        end,
        totalDuration: track.duration,
        bucketCount,
        signal,
        timeoutMs,
        workerFactory,
        splitDepth: 0
    });

    return {
        index,
        start: decoded.start,
        end: decoded.end,
        frames: decoded.frames,
        sampleRate: decoded.sampleRate,
        channels: decoded.channels,
        peaks: decoded.peaks,
        splitDepth: decoded.splitDepth,
        cached: false
    };
}
