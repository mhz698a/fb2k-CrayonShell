import { getFooSdk } from '../fooSdk.js';
import { WaveformCache } from './waveformCache.js';
import { WaveformScheduler } from './waveformScheduler.js';
import {
    buildWaveformTrackIdentity,
    chooseWaveformSegmentDuration
} from './waveformIdentity.js';
import { decodeWaveformSegment } from './waveformDecoder.js';

function assertSuccess(response, operation) {
    if (response?.success === false) {
        const error = new Error(response.error || operation + ' falló.');
        error.code = response.code;
        throw error;
    }
    return response;
}

async function describeTrackForWaveform(sdk, track) {
    if (!track || typeof track !== 'object') {
        throw new TypeError('No se recibió una pista válida para el waveform.');
    }

    const absolutePath = String(track.absolutePath || '').trim();
    if (!absolutePath) {
        throw new Error('La pista no tiene una ruta de archivo local para generar waveform.');
    }

    let fileInfo = null;
    if (typeof sdk.file?.getInfo === 'function') {
        try {
            fileInfo = assertSuccess(
                await sdk.file.getInfo(absolutePath),
                'No se pudieron consultar los metadatos del archivo'
            );
            if (fileInfo.exists !== true || fileInfo.isFile !== true) fileInfo = null;
        } catch {
            // The track metadata remains usable; a missing stat only weakens cache invalidation.
            fileInfo = null;
        }
    }

    const identity = buildWaveformTrackIdentity(track, fileInfo);
    return {
        ...identity,
        duration: identity.duration,
        sampleRate: identity.sampleRate,
        channels: identity.channels,
        sourceTrack: track
    };
}

export class WaveformEngine {
    constructor(options = {}) {
        this.sdk = options.sdk || getFooSdk();
        if (typeof this.sdk.audio?.decodePcm !== 'function') {
            throw new Error('La versión instalada de foo-webview-sdk no expone audio.decodePcm().');
        }

        this.resolution = Number.isInteger(options.resolution) ? options.resolution : 4096;
        this.timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 120_000;
        this.segmentDurationOptions = options.segmentDurationOptions || {};
        this.workerFactory = options.workerFactory;
        this.cacheRoot = options.cacheRoot;
        this.onSegment = options.onSegment || (() => undefined);
        this.onState = options.onState || (() => undefined);
        this.onError = options.onError || (() => undefined);

        this.requestGeneration = 0;
        this.currentTrack = null;
        this.cache = null;
        this.disposed = false;

        this.scheduler = new WaveformScheduler({
            resolution: this.resolution,
            segmentDurationOptions: this.segmentDurationOptions,
            decodeSegment: (request) => decodeWaveformSegment({
                sdk: this.sdk,
                timeoutMs: this.timeoutMs,
                workerFactory: this.workerFactory,
                ...request
            }),
            onSegment: (segment) => this._safeNotify(this.onSegment, segment),
            onState: (state) => this._safeNotify(this.onState, {
                ...state,
                trackKey: this.currentTrack?.key || null
            }),
            onError: (error, context) => this._safeNotify(this.onError, error, context)
        });
    }

    async setTrack(track, position = 0) {
        if (this.disposed) throw new Error('WaveformEngine ya fue liberado.');
        const requestGeneration = ++this.requestGeneration;
        this.scheduler.clear();
        this.currentTrack = null;
        this.cache = null;

        const descriptor = await describeTrackForWaveform(this.sdk, track);
        if (requestGeneration !== this.requestGeneration || this.disposed) return { cancelled: true };

        const segmentSeconds = chooseWaveformSegmentDuration(
            descriptor,
            this.segmentDurationOptions
        );
        const cache = await WaveformCache.open({
            sdk: this.sdk,
            identity: descriptor,
            duration: descriptor.duration,
            segmentSeconds,
            resolution: this.resolution,
            ...(this.cacheRoot ? { root: this.cacheRoot } : {})
        });
        if (requestGeneration !== this.requestGeneration || this.disposed) return { cancelled: true };

        this.currentTrack = descriptor;
        this.cache = cache;
        this.scheduler.setTrack(descriptor, cache, position);
        return {
            cancelled: false,
            trackKey: descriptor.key,
            duration: descriptor.duration,
            segmentSeconds,
            totalSegments: Math.ceil(descriptor.duration / segmentSeconds),
            cachedSegments: cache.getCompletedIndexes()
        };
    }

    setPosition(position) {
        if (this.disposed) return;
        this.scheduler.setPosition(position);
    }

    retryFailed() {
        if (this.disposed) return;
        this.scheduler.retryFailed();
    }

    clear() {
        this.requestGeneration += 1;
        this.currentTrack = null;
        this.cache = null;
        this.scheduler.clear();
    }

    getSnapshot() {
        return {
            ...this.scheduler.getSnapshot(),
            trackKey: this.currentTrack?.key || null
        };
    }

    dispose() {
        if (this.disposed) return;
        this.requestGeneration += 1;
        this.currentTrack = null;
        this.cache = null;
        this.scheduler.dispose();
        this.disposed = true;
    }

    _safeNotify(callback, ...args) {
        try {
            callback(...args);
        } catch {
            // Consumer observers must not interfere with native decode or cache writes.
        }
    }
}

export async function createWaveformEngine(options = {}) {
    return new WaveformEngine(options);
}
