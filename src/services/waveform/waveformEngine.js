import { getFooSdk } from '../fooSdk.js';
import { WaveformCache } from './waveformCache.js';
import { WaveformCacheManager, DEFAULT_WAVEFORM_CACHE_MAX_BYTES } from './waveformCacheManager.js';
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

async function ensurePcmRuntime(sdk) {
    if (typeof sdk.audio?.getPcmDebugState !== 'function') return null;
    const state = assertSuccess(
        await sdk.audio.getPcmDebugState(),
        'No se pudo consultar la compatibilidad PCM de WebView2'
    );
    const runtime = state?.runtime || {};
    if (runtime.environment12 !== true || runtime.webview17 !== true) {
        const error = new Error(
            'Este WebView2 no admite los buffers compartidos requeridos por audio.decodePcm().'
        );
        error.code = 'PCM_SHARED_BUFFER_UNAVAILABLE';
        error.diagnostics = {
            version: runtime.version || '',
            environment12: runtime.environment12 === true,
            webview17: runtime.webview17 === true
        };
        throw error;
    }
    return runtime;
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
        this.cacheManager = options.cacheManager || new WaveformCacheManager({
            sdk: this.sdk,
            root: this.cacheRoot,
            maxBytes: options.cacheMaxBytes || options.cacheManagerOptions?.maxBytes || DEFAULT_WAVEFORM_CACHE_MAX_BYTES,
            ...(options.cacheManagerOptions || {}),
            onError: error => this._safeNotify(this.onError, error, { source: 'cache-manager' })
        });
        this.cacheManagerEnabled = Boolean(this.cacheManager);
        this.onSegment = options.onSegment || (() => undefined);
        this.onState = options.onState || (() => undefined);
        this.onError = options.onError || (() => undefined);

        this.requestGeneration = 0;
        this.runtimePromise = null;
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

        if (!this.runtimePromise) {
            this.runtimePromise = ensurePcmRuntime(this.sdk).catch(error => {
                this.runtimePromise = null;
                throw error;
            });
        }
        await this.runtimePromise;
        if (requestGeneration !== this.requestGeneration || this.disposed) return { cancelled: true };

        const segmentSeconds = chooseWaveformSegmentDuration(
            descriptor,
            this.segmentDurationOptions
        );

        if (this.cacheManagerEnabled) {
            this.cacheManager.setActiveTrackKey(descriptor.key);
            try {
                await this.cacheManager.maintain({ activeTrackKey: descriptor.key });
            } catch (error) {
                this.cacheManagerEnabled = false;
                this._safeNotify(this.onError, error, { source: 'cache-maintenance' });
            }
        }

        const cache = await WaveformCache.open({
            sdk: this.sdk,
            identity: descriptor,
            duration: descriptor.duration,
            segmentSeconds,
            resolution: this.resolution,
            ...(this.cacheRoot ? { root: this.cacheRoot } : {}),
            ...(this.cacheManagerEnabled ? {
                cacheManager: this.cacheManager,
                onManagerError: error => this._safeNotify(this.onError, error, { source: 'cache-index' })
            } : {})
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
        this.cacheManager?.setActiveTrackKey(null);
        this.scheduler.clear();
    }

    getCacheSnapshot() {
        return this.cacheManager?.getSnapshot?.() || null;
    }

    clearInactiveCache() {
        if (!this.cacheManagerEnabled || !this.cacheManager) {
            return Promise.resolve(this.getCacheSnapshot());
        }
        return this.cacheManager.clearInactive();
    }

    maintainCache(options = {}) {
        if (!this.cacheManagerEnabled || !this.cacheManager) {
            return Promise.resolve(this.getCacheSnapshot());
        }
        return this.cacheManager.maintain(options);
    }

    getSnapshot() {
        return {
            ...this.scheduler.getSnapshot(),
            trackKey: this.currentTrack?.key || null,
            cache: this.getCacheSnapshot()
        };
    }

    dispose() {
        if (this.disposed) return;
        this.requestGeneration += 1;
        this.currentTrack = null;
        this.cache = null;
        this.cacheManager?.setActiveTrackKey(null);
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
