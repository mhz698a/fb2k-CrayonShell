import { getFooSdk } from '../fooSdk.js';
import { WaveformEngine } from './waveformEngine.js';

function convertFileUrlToWindowsPath(value) {
    if (!/^file:\/\//i.test(value)) return '';

    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'file:') return '';

        const pathname = decodeURIComponent(parsed.pathname || '');
        if (parsed.hostname) {
            const uncPath = '\\\\' + parsed.hostname + pathname.replace(/\//g, '\\');
            return /^\\\\[^\\]+\\[^\\]+/.test(uncPath) ? uncPath : '';
        }

        const windowsPath = pathname
            .replace(/^\/([a-z]:\/)/i, '$1')
            .replace(/\//g, '\\');
        return /^[a-z]:\\/i.test(windowsPath) ? windowsPath : '';
    } catch {
        return '';
    }
}

function getNativeTrackPath(track) {
    const candidates = [track?.handle, track?.absolutePath, track?.path]
        .map(value => String(value || '').trim())
        .filter(Boolean);

    const directPath = candidates.find((candidate) => {
        const path = candidate.replace(/\|subsong:\d+$/i, '');
        return /^[a-z]:\\/i.test(path) || /^\\\\[^\\]+\\[^\\]+/.test(path);
    });
    if (directPath) return directPath;

    const fileUrl = candidates.find(candidate => /^file:\/\//i.test(candidate));
    return fileUrl ? convertFileUrlToWindowsPath(fileUrl) : '';
}

function isWaveformSourceTrack(track) {
    const path = getNativeTrackPath(track);
    const mediaPath = path.replace(/\|subsong:\d+$/i, '');
    const supportedContainer = /\.(?:aac|aif|aiff|alac|ape|asf|avi|dff|divx|dsf|f4v|flac|flv|m2ts|m2v|m4a|m4b|m4v|mka|mkv|mov|mp2|mp3|mp4|mpeg|mpg|mpe|mpv|m2p|mts|mxf|oga|ogg|ogv|opus|qt|rm|rmvb|tak|ts|tta|vob|wav|wave|webm|wma|wmv|wv|3g2|3gp)$/i.test(mediaPath);

    return Boolean(
        track
        && path
        && supportedContainer
        && Number.isFinite(Number(track.duration))
        && Number(track.duration) > 0
    );
}

function getClockPosition(clock) {
    const position = Number(clock?.position?.());
    return Number.isFinite(position) && position > 0 ? position : 0;
}

function createUnavailableWaveformEngine(error) {
    return {
        async setTrack() {
            throw error;
        },
        async setCacheMaxBytes() {
            throw error;
        },
        setPosition() {
            return false;
        },
        getSnapshot() {
            return {
                trackKey: null,
                duration: 0,
                segmentSeconds: 0,
                completedSegments: 0,
                totalSegments: 0,
                status: 'unavailable',
                lastError: error?.message || String(error)
            };
        },
        clear() {},
        dispose() {}
    };
}


export class WaveformPlaybackController {
    constructor(options = {}) {
        this.sdk = options.sdk || getFooSdk();
        if (typeof this.sdk.on !== 'function' || !this.sdk.player) {
            throw new TypeError('WaveformPlaybackController requiere eventos y player del SDK.');
        }

        const engineOptions = {
            ...(options.engineOptions || {}),
            sdk: this.sdk,
            onSegment: (segment) => this._notify(options.onSegment, {
                ...segment,
                trackKey: this.trackKey
            }),
            onState: (state) => this._emit('waveform-state', state),
            onError: (error, context) => this._reportError(error, context)
        };
        if (options.engine) {
            this.engine = options.engine;
        } else {
            try {
                this.engine = typeof options.engineFactory === 'function'
                    ? options.engineFactory(engineOptions)
                    : new WaveformEngine(engineOptions);
            } catch (error) {
                // Playback and seeking must remain available when PCM waveform
                // support is missing or the engine cannot be initialized.
                this.engine = createUnavailableWaveformEngine(error);
            }
        }

        this.clockFactory = options.clockFactory || ((sdk) => {
            if (typeof sdk.PlaybackClock !== 'function') {
                const error = new Error(
                    'foo-webview-sdk no expone PlaybackClock; actualiza el SDK antes de activar la integración.'
                );
                error.code = 'PLAYBACK_CLOCK_UNAVAILABLE';
                throw error;
            }
            return new sdk.PlaybackClock();
        });

        this.onUpdate = options.onUpdate || (() => undefined);
        this.onError = options.onError || (() => undefined);

        this.clock = null;
        this.clockUnsubscribe = null;
        this.eventUnsubscribers = [];
        this.started = false;
        this.disposed = false;
        this.trackRevision = 0;
        this.pendingTrackTask = Promise.resolve(null);
        this.currentTrack = null;
        this.trackKey = null;
        this.lastPrioritySegment = null;
        this.lastError = null;
        this.playbackState = null;
        this.hostCanSeek = false;
        this.canSeek = false;
        this.stateRevision = 0;
    }

    async start() {
        if (this.disposed) {
            throw new Error('WaveformPlaybackController ya fue liberado.');
        }
        if (this.started) return this.getSnapshot();

        this.started = true;
        try {
            this.clock = this.clockFactory(this.sdk);
            if (!this.clock
                || typeof this.clock.position !== 'function'
                || typeof this.clock.onChange !== 'function'
                || !this.clock.ready
                || typeof this.clock.dispose !== 'function') {
                throw new TypeError('La implementación PlaybackClock no cumple el contrato del SDK.');
            }

            this.clockUnsubscribe = this.clock.onChange((change) => {
                this._onClockChange(change);
            });
            this._subscribe('playback:trackChanged', (track) => {
                this._onTrackChanged(track);
            });
            this._subscribe('playback:timeHighRes', () => {
                this._onHighResolutionTime();
            });
            this._subscribe('playback:stateChanged', (state) => {
                this._onStateChanged(state);
            });

            const revisionAtRead = this.trackRevision;
            const stateRevisionAtRead = this.stateRevision;
            const stateRequest = typeof this.sdk.player.getState === 'function'
                ? this.sdk.player.getState().catch(() => null)
                : Promise.resolve(null);
            const [currentTrackResponse, initialState] = await Promise.all([
                this.sdk.player.getCurrentTrack(),
                this.clock.ready,
                stateRequest
            ]).then(([trackResponse, , stateResponse]) => [trackResponse, stateResponse]);

            if (!this.started || this.disposed) return this.getSnapshot();

            // A trackChanged event received during the initial read is newer
            // than the snapshot requested here and must remain authoritative.
            if (revisionAtRead !== this.trackRevision) {
                await this.pendingTrackTask;
                return this.getSnapshot();
            }

            if (stateRevisionAtRead === this.stateRevision) {
                this._onStateChanged(initialState, false);
            }

            if (currentTrackResponse?.success === false) {
                throw new Error(
                    currentTrackResponse.error || 'No se pudo consultar la pista actual.'
                );
            }

            if (!currentTrackResponse?.found || !currentTrackResponse.track) {
                this._clearTrack();
            } else {
                await this._loadTrack(currentTrackResponse.track, revisionAtRead);
            }

            this._emit('started');
            return this.getSnapshot();
        } catch (error) {
            this._reportError(error, { source: 'start' });
            this._detachPlaybackListeners();
            this.started = false;
            this.clock?.dispose();
            this.clock = null;
            throw error;
        }
    }

    getPosition() {
        return getClockPosition(this.clock);
    }

    getSnapshot() {
        const waveform = this.engine.getSnapshot();
        const clockDuration = Number(this.clock?.duration) || 0;
        return {
            started: this.started,
            disposed: this.disposed,
            playbackState: this.playbackState || this.clock?.state || 'stopped',
            canSeek: this.canSeek,
            position: this.getPosition(),
            duration: clockDuration > 0
                ? clockDuration
                : Number(this.currentTrack?.duration) || waveform.duration,
            trackKey: this.trackKey || null,
            trackPath: this.currentTrack?.absolutePath || this.currentTrack?.path || null,
            trackTitle: this.currentTrack?.title || '',
            trackArtist: this.currentTrack?.artist || '',
            lastError: this.lastError,
            waveform
        };
    }

    maintainCache(options = {}) {
        return this.engine.maintainCache?.(options) || Promise.resolve(null);
    }

    clearInactiveCache() {
        return this.engine.clearInactiveCache?.() || Promise.resolve(null);
    }

    setCacheMaxBytes(maxBytes) {
        if (typeof this.engine.setCacheMaxBytes !== 'function') {
            return Promise.reject(new Error('La administración de presupuesto de caché no está disponible.'));
        }
        return this.engine.setCacheMaxBytes(maxBytes);
    }

    async resync() {
        if (!this.started || !this.clock) {
            throw new Error('WaveformPlaybackController no está iniciado.');
        }
        await this.clock.resync();
        return this.getSnapshot();
    }

    async seek(position) {
        if (!this.started || this.disposed) {
            throw new Error('WaveformPlaybackController no está iniciado.');
        }
        if (!this.canSeek) {
            const error = new Error('La pista actual no admite búsqueda.');
            error.code = 'NOT_SUPPORTED';
            throw error;
        }
        const requested = Number(position);
        if (!Number.isFinite(requested)) {
            throw new TypeError('La posición de búsqueda debe ser un número finito.');
        }

        const duration = Number(this.clock?.duration)
            || Number(this.currentTrack?.duration)
            || 0;
        const target = Math.max(0, duration > 0
            ? Math.min(duration, requested)
            : requested);
        const response = await this.sdk.player.seek(target);
        if (response?.success === false) {
            const error = new Error(response.error || 'foobar2000 rechazó la búsqueda.');
            error.code = response.code;
            throw error;
        }

        await this.clock?.resync();
        return response;
    }

    whenTrackChangeSettled() {
        return this.pendingTrackTask;
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.started = false;
        this.trackRevision += 1;
        this._detachPlaybackListeners();
        this.clock?.dispose();
        this.clock = null;
        this.engine.dispose();
        this.currentTrack = null;
        this.trackKey = null;
        this.lastPrioritySegment = null;
        this.hostCanSeek = false;
        this.canSeek = false;
        this._emit('disposed');
    }

    _subscribe(eventName, handler) {
        const unsubscribe = this.sdk.on(eventName, handler);
        if (typeof unsubscribe !== 'function') {
            throw new TypeError('El SDK no devolvió una función unsubscribe para ' + eventName + '.');
        }
        this.eventUnsubscribers.push(unsubscribe);
    }

    _detachPlaybackListeners() {
        for (const unsubscribe of this.eventUnsubscribers.splice(0)) {
            try {
                unsubscribe();
            } catch {
                // A failing event detach must not block disposal of the other listeners.
            }
        }

        try {
            this.clockUnsubscribe?.();
        } catch {
            // The clock owns its listener as well and will be disposed below.
        }
        this.clockUnsubscribe = null;
    }

    _onTrackChanged(track) {
        if (!this.started || this.disposed) return Promise.resolve({ cancelled: true });

        const revision = ++this.trackRevision;
        this.currentTrack = null;
        this.trackKey = null;
        this.lastPrioritySegment = null;
        this.hostCanSeek = false;
        this.canSeek = false;
        this.engine.clear();

        const stateRevision = this.stateRevision;
        this.pendingTrackTask = this._loadTrack(track, revision).then(async (result) => {
            if (revision !== this.trackRevision
                || stateRevision !== this.stateRevision
                || typeof this.sdk.player.getState !== 'function') {
                return result;
            }

            try {
                const state = await this.sdk.player.getState();
                if (revision === this.trackRevision
                    && stateRevision === this.stateRevision
                    && state?.success === true) {
                    this._onStateChanged(state);
                }
            } catch {
                // Keep the current PlaybackClock state when the host state read fails.
            }

            return result;
        });
        return this.pendingTrackTask;
    }

    async _loadTrack(track, revision) {
        try {
            let resolvedTrack = track;
            if (!resolvedTrack || typeof resolvedTrack !== 'object') {
                const response = await this.sdk.player.getCurrentTrack();
                if (response?.success === false) {
                    throw new Error(response.error || 'No se pudo resolver la pista actual.');
                }
                resolvedTrack = response?.found ? response.track : null;
            }

            if (revision !== this.trackRevision || !this.started) {
                return { cancelled: true };
            }

            if (!resolvedTrack || typeof resolvedTrack !== 'object') {
                this._clearTrack();
                this._emit('track-unavailable');
                return { available: false, waveform: false };
            }

            // The playback track and seek timeline exist independently of whether
            // a local decoder can provide PCM samples for a waveform.
            this.currentTrack = resolvedTrack;
            this.canSeek = this.hostCanSeek;

            if (!isWaveformSourceTrack(resolvedTrack)) {
                this.engine.clear();
                this.trackKey = null;
                this.lastPrioritySegment = null;
                this.canSeek = this.hostCanSeek && Boolean(this.currentTrack);
                this._emit('waveform-unavailable', {
                    reason: 'No hay una ruta local compatible para extraer PCM.'
                });
                return { available: true, waveform: false, reason: 'source-not-local-or-supported' };
            }

            const nativePath = getNativeTrackPath(resolvedTrack);
            const nativeAbsolutePath = nativePath.replace(/\|subsong:\d+$/i, '');
            const waveformTrack = resolvedTrack.absolutePath === nativeAbsolutePath
                && resolvedTrack.handle === nativePath
                ? resolvedTrack
                : {
                    ...resolvedTrack,
                    absolutePath: nativeAbsolutePath,
                    // waveformIdentity prefers handle as decodePath. Keep it native
                    // even when the SDK's handle/path fields contain a file:// URI.
                    handle: nativePath
                };
            this.currentTrack = waveformTrack;
            this.canSeek = this.hostCanSeek;

            let result;
            try {
                result = await this.engine.setTrack(waveformTrack, this.getPosition());
            } catch (error) {
                if (revision !== this.trackRevision || !this.started) {
                    return { cancelled: true };
                }

                // A video may contain no audio stream, or a local input decoder may
                // not support its audio codec. Keep the player's timeline seekable.
                this.engine.clear();
                this.trackKey = null;
                this.lastPrioritySegment = null;
                this.canSeek = this.hostCanSeek && Boolean(this.currentTrack);
                this._reportError(error, { source: 'waveform-decode' });
                return { available: true, waveform: false, error };
            }

            if (revision !== this.trackRevision || !this.started || result?.cancelled) {
                return { cancelled: true };
            }

            this.trackKey = result.trackKey || null;
            this.canSeek = this.hostCanSeek && Boolean(this.currentTrack);
            this.lastPrioritySegment = this._getPrioritySegment(
                this.getPosition(),
                this.engine.getSnapshot()
            );
            this.lastError = null;
            this._emit('track-loaded', result);
            return { ...result, available: true, waveform: Boolean(this.trackKey) };
        } catch (error) {
            if (revision === this.trackRevision && this.started) {
                this.engine.clear();
                this.currentTrack = null;
                this.trackKey = null;
                this.lastPrioritySegment = null;
                this.canSeek = false;
                this._reportError(error, { source: 'track-change' });
            }
            return { cancelled: revision !== this.trackRevision, error };
        }
    }

    _clearTrack() {
        this.engine.clear();
        this.currentTrack = null;
        this.trackKey = null;
        this.lastPrioritySegment = null;
        this.hostCanSeek = false;
        this.canSeek = false;
    }

    _onClockChange(change = {}) {
        if (change.state) this.playbackState = change.state;

        if (change.reason === 'seek' || change.reason === 'resync') {
            this._updateAnalysisPriority(
                Number.isFinite(change.position) ? change.position : this.getPosition(),
                'clock-' + change.reason
            );
        }

        this._emit('clock-' + (change.reason || 'change'), change);
    }

    _onStateChanged(state = {}, emit = true) {
        this.stateRevision += 1;
        const payload = state || {};
        if (payload.state) this.playbackState = payload.state;
        if (typeof payload.canSeek === 'boolean') {
            this.hostCanSeek = payload.canSeek;
            this.canSeek = this.hostCanSeek && Boolean(this.currentTrack);
        }
        if (emit) this._emit('playback-state', payload);
    }

    _onHighResolutionTime() {
        // PlaybackClock already consumes this event. Only move scheduler priority
        // when playback crosses a waveform segment boundary, not on every tick.
        this._updateAnalysisPriority(this.getPosition(), 'playback-time');
    }

    _getPrioritySegment(position, snapshot) {
        if (!snapshot?.trackKey || !Number.isFinite(snapshot.segmentSeconds)
            || snapshot.segmentSeconds <= 0) {
            return null;
        }
        return Math.max(0, Math.floor(Math.max(0, position) / snapshot.segmentSeconds));
    }

    _updateAnalysisPriority(position, source) {
        if (!this.trackKey || !Number.isFinite(position)) return false;

        const snapshot = this.engine.getSnapshot();
        if (!snapshot?.trackKey || snapshot.trackKey !== this.trackKey) return false;

        const nextSegment = this._getPrioritySegment(position, snapshot);
        if (nextSegment === null || nextSegment === this.lastPrioritySegment) return false;

        this.lastPrioritySegment = nextSegment;
        this.engine.setPosition(Math.max(0, position));
        this._emit('analysis-priority', { position, segment: nextSegment, source });
        return true;
    }

    _reportError(error, context) {
        this.lastError = error?.message || String(error);
        this._notify(this.onError, error, context);
        this._emit('error', { message: this.lastError, context });
    }

    _emit(type, detail = null) {
        this._notify(this.onUpdate, {
            type,
            detail,
            snapshot: this.getSnapshot()
        });
    }

    _notify(callback, ...args) {
        try {
            callback(...args);
        } catch {
            // Consumer observers must never interfere with playback synchronization.
        }
    }
}

export function createWaveformPlaybackController(options = {}) {
    return new WaveformPlaybackController(options);
}
