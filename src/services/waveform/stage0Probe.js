import { getFooSdk } from '../fooSdk.js';
import { reducePcmToPeaksInWorker } from './peakReducer.js';
import {
    decodeWaveformProbe,
    encodeWaveformProbe,
    waveformProbeBytesEqual
} from './probeCacheFormat.js';

const DIRECTORY = 'CrayonShell\\WaveformCache\\_stage0';
const FILE_NAME = 'pcm-decode-probe.wfc';
const DEFAULT_TIMEOUT_MS = 120_000;

function success(value, operation) {
    if (value?.success === false) {
        const error = new Error(value.error || operation + ' falló.');
        error.code = value.code;
        throw error;
    }
    return value;
}

function profileFilePath(profilePath) {
    const profile = String(profilePath || '').replace(/[\\/]+$/, '');
    if (!/^[A-Za-z]:\\/.test(profile) && !/^\\\\[^\\]+\\[^\\]+/.test(profile)) {
        throw new Error('El perfil de foobar2000 no devolvió una ruta Windows absoluta.');
    }
    return profile + '\\' + DIRECTORY + '\\' + FILE_NAME;
}

async function currentTrackPath(sdk, requestedPath) {
    if (typeof requestedPath === 'string' && requestedPath.trim()) return requestedPath.trim();
    const result = success(await sdk.player.getCurrentTrack(), 'No se pudo consultar la pista actual');
    const path = result?.track?.path || result?.track?.handle || '';
    if (!result?.found || !path) {
        throw new Error('No hay una pista con ruta local en reproducción. Pasa options.path explícitamente.');
    }
    return path;
}

async function runtimeState(sdk) {
    const result = success(await sdk.audio.getPcmDebugState(), 'No se pudo consultar el estado PCM');
    const runtime = {
        version: result?.runtime?.version || '',
        environment12: result?.runtime?.environment12 === true,
        webview17: result?.runtime?.webview17 === true
    };
    if (!runtime.environment12 || !runtime.webview17) {
        const error = new Error(
            'Este WebView2 no admite los buffers PCM compartidos requeridos por decodePcm. ' +
            'Se necesita ICoreWebView2Environment12 e ICoreWebView2_17.'
        );
        error.diagnostics = runtime;
        throw error;
    }
    return {
        runtime,
        decode: {
            active: Number(result?.decode?.active) || 0,
            queued: Number(result?.decode?.queued) || 0,
            openBufferBytes: Number(result?.decode?.openBufferBytes) || 0
        }
    };
}

async function storagePath(sdk) {
    const profile = success(await sdk.misc.getProfilePath(), 'No se pudo consultar el perfil');
    const path = profileFilePath(profile?.path);
    const directory = path.slice(0, path.lastIndexOf('\\'));
    success(await sdk.file.mkdir(directory), 'No se pudo crear la carpeta de prueba');
    return path;
}

async function readProbe(sdk, path) {
    const exists = success(await sdk.file.exists(path), 'No se pudo consultar el archivo de prueba');
    if (!exists?.exists || !exists?.isFile) return null;
    try {
        return decodeWaveformProbe(await sdk.file.readBinary(path));
    } catch {
        return null;
    }
}

export async function runWaveformStage0Probe(options = {}) {
    const sdk = options.sdk || getFooSdk();
    if (typeof sdk.audio?.decodePcm !== 'function'
        || typeof sdk.audio?.getPcmDebugState !== 'function') {
        throw new Error('El SDK no expone decodePcm y getPcmDebugState.');
    }
    if (typeof sdk.file?.writeBinary !== 'function'
        || typeof sdk.file?.readBinary !== 'function'
        || typeof sdk.misc?.getProfilePath !== 'function') {
        throw new Error('El SDK no expone las APIs de caché binaria persistente.');
    }

    const runtimeBefore = await runtimeState(sdk);
    const trackPath = await currentTrackPath(sdk, options.path);
    const start = Number(options.startSeconds ?? 0);
    const duration = Number(options.durationSeconds ?? 5);
    const bucketCount = Number(options.bucketCount ?? 512);
    const timeoutMs = Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0
        || !Number.isInteger(bucketCount) || bucketCount < 1
        || !Number.isFinite(timeoutMs) || timeoutMs < 0) {
        throw new RangeError('Los parámetros de la prueba PCM no son válidos.');
    }

    const end = start + duration;
    const filePath = await storagePath(sdk);
    const previous = await readProbe(sdk, filePath);
    const decodeStarted = performance.now();
    const pcm = await sdk.audio.decodePcm(trackPath, {
        start,
        end,
        mono: false,
        timeoutMs,
        ...(options.signal ? { signal: options.signal } : {})
    });
    const decodeMs = performance.now() - decodeStarted;

    if (pcm.truncated) {
        pcm.release();
        throw new Error('El host devolvió un segmento PCM truncado. Reduce durationSeconds; el bloque no se guardó.');
    }

    const pcmInfo = {
        start: pcm.start,
        duration: pcm.duration,
        frames: pcm.frames,
        sampleRate: pcm.sampleRate,
        channels: pcm.channels,
        truncated: pcm.truncated,
        resampled: pcm.resampled
    };
    const reductionStarted = performance.now();
    const peaks = await reducePcmToPeaksInWorker(pcm, bucketCount, {
        workerFactory: options.workerFactory,
        signal: options.signal
    });
    const reductionMs = performance.now() - reductionStarted;

    const identity = [
        trackPath.replace(/[\\/]+/g, '\\').toLowerCase(),
        start.toFixed(6),
        end.toFixed(6),
        bucketCount
    ].join('|');
    const bytes = encodeWaveformProbe({
        identity,
        start: pcmInfo.start,
        end: pcmInfo.start + pcmInfo.duration,
        frames: pcmInfo.frames,
        sampleRate: pcmInfo.sampleRate,
        channels: pcmInfo.channels,
        peaks
    });

    success(
        await sdk.file.writeBinary(filePath, bytes, { atomic: true }),
        'No se pudo escribir el archivo de prueba de waveform'
    );
    const restoredBytes = await sdk.file.readBinary(filePath);
    const restored = decodeWaveformProbe(restoredBytes);
    const readbackMatches = waveformProbeBytesEqual(bytes, restoredBytes);

    return {
        status: readbackMatches ? 'passed' : 'failed',
        api: 'fb.audio.decodePcm',
        decodeMs: Math.round(decodeMs),
        reductionMs: Math.round(reductionMs),
        pcm: pcmInfo,
        peakCount: peaks.length,
        peakPreview: Array.from(peaks.slice(0, 16)),
        persistence: {
            atomicWriteReadback: readbackMatches,
            profileCacheFile: filePath,
            runtime: runtimeBefore.runtime,
            decodeQueueBefore: runtimeBefore.decode,
            previousValidProbeFound: Boolean(previous),
            previousProbeMatchesThisRequest: previous?.identity === identity,
            restoredPeakCount: restored.peaks.length
        }
    };
}

export async function runWaveformCancellationProbe(options = {}) {
    const sdk = options.sdk || getFooSdk();
    const runtimeBefore = await runtimeState(sdk);
    const trackPath = await currentTrackPath(sdk, options.path);
    const start = Number(options.startSeconds ?? 0);
    const end = Number(options.endSeconds ?? 120);
    const abortAfterMs = Number(options.abortAfterMs ?? 50);
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(end) || end <= start
        || !Number.isFinite(abortAfterMs) || abortAfterMs < 0) {
        throw new RangeError('Los parámetros de cancelación no son válidos.');
    }

    const controller = new AbortController();
    const started = performance.now();
    let abortRequested = false;
    const timer = setTimeout(() => {
        abortRequested = true;
        controller.abort();
    }, abortAfterMs);
    try {
        const pcm = await sdk.audio.decodePcm(trackPath, {
            start,
            end,
            mono: false,
            timeoutMs: Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
            signal: controller.signal
        });
        pcm.release();
        return {
            outcome: 'completed-before-abort',
            abortRequested,
            elapsedMs: Math.round(performance.now() - started),
            decodeQueueBefore: runtimeBefore.decode,
            decodeQueueAfter: (await runtimeState(sdk)).decode
        };
    } catch (error) {
        if (error?.name !== 'AbortError' && error?.code !== 'CANCELLED') throw error;
        return {
            outcome: 'cancelled',
            abortRequested,
            errorName: error.name || 'Error',
            errorCode: error.code || 'ABORTED',
            elapsedMs: Math.round(performance.now() - started),
            decodeQueueBefore: runtimeBefore.decode,
            decodeQueueAfter: (await runtimeState(sdk)).decode
        };
    } finally {
        clearTimeout(timer);
    }
}

export async function inspectWaveformStage0Probe(options = {}) {
    const sdk = options.sdk || getFooSdk();
    const trackPath = await currentTrackPath(sdk, options.path);
    const start = Number(options.startSeconds ?? 0);
    const duration = Number(options.durationSeconds ?? 5);
    const bucketCount = Number(options.bucketCount ?? 512);
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0
        || !Number.isInteger(bucketCount) || bucketCount < 1) {
        throw new RangeError('Los parámetros de inspección no son válidos.');
    }

    const identity = [
        trackPath.replace(/[\\/]+/g, '\\').toLowerCase(),
        start.toFixed(6),
        (start + duration).toFixed(6),
        bucketCount
    ].join('|');
    const filePath = await storagePath(sdk);
    const cached = await readProbe(sdk, filePath);
    return {
        found: Boolean(cached),
        matchesRequestedSegment: cached?.identity === identity,
        peakCount: cached?.peaks.length || 0,
        start: cached?.start ?? null,
        end: cached?.end ?? null,
        filePath
    };
}

export async function clearWaveformStage0Probe(options = {}) {
    const sdk = options.sdk || getFooSdk();
    const filePath = await storagePath(sdk);
    const exists = success(await sdk.file.exists(filePath), 'No se pudo consultar el archivo de prueba');
    if (!exists?.exists) return { removed: false };
    success(
        await sdk.file.delete(filePath, { moveToTrash: false }),
        'No se pudo eliminar el archivo de prueba'
    );
    return { removed: true };
}
