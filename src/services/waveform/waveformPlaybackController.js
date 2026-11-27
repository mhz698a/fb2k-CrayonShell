import { getFooSdk } from '../fooSdk.js';
import { WaveformEngine } from './waveformEngine.js';

function isUsableLocalTrack(track) {
    const path = String(track?.absolutePath || '').trim();
    const mediaPath = path.replace(/\|subsong:\d+$/i, '');
    const isWindowsPath = /^[a-z]:\\/i.test(mediaPath)
        || /^\\\\[^\\]+\\[^\\]+/.test(mediaPath);
    const isAudioPath = /\.(?:aac|aif|aiff|alac|ape|dff|dsf|flac|m4a|m4b|mka|mp3|mpc|oga|ogg|opus|tak|tta|wav|wave|wma|wv)$/i.test(mediaPath);

    return Boolean(
        track
        && isWindowsPath
        && isAudioPath
        && Number.isFinite(Number(track.duration))
        && Number(track.duration) > 0
    );
}

function getClockPosition(clock) {
    const position = Number(clock?.position?.());
    return Number.isFinite(position) && position > 0 ? position : 0;
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
        this.engine = options.engine
            || (typeof options.engineFactory === 'function'
                ? options.engineFactory(engineOptions)
                : new WaveformEngine(engineOptions));

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
        this.playbackState = 'stopped';
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
            playbackState: this.clock?.state || this.playbackState || 'stopped',
            canSeek: this.canSeek,
            position: this.getPosition(),
            duration: clockDuration > 0 ? clockDuration : waveform.duration,
            trackKey: this.trackKey || null,
            trackPath: this.currentTrack?.absolutePath || null,
            trackTitle: this.currentTrack?.title || '',
            trackArtist: this.currentTrack?.artist || '',
            lastError: this.lastError,
            waveform
        };
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
        this.canSeek = false;
        this.engine.clear();

        this.pendingTrackTask = this._loadTrack(track, revision);
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

            if (!isUsableLocalTrack(resolvedTrack)) {
                this._clearTrack();
                this._emit('track-unavailable');
                return { available: false };
            }

            const result = await this.engine.setTrack(resolvedTrack, this.getPosition());
            if (revision !== this.trackRevision || !this.started || result?.cancelled) {
                return { cancelled: true };
            }

            this.currentTrack = resolvedTrack;
            this.trackKey = result.trackKey || null;
            this.lastPrioritySegment = this._getPrioritySegment(
                this.getPosition(),
                this.engine.getSnapshot()
            );
            this.lastError = null;
            this._emit('track-loaded', result);
            return result;
        } catch (error) {
            if (revision === this.trackRevision && this.started) {
                this.engine.clear();
                this.currentTrack = null;
                this.trackKey = null;
                this.lastPrioritySegment = null;
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
        if (state.state) this.playbackState = state.state;
        if (typeof state.canSeek === 'boolean') this.canSeek = state.canSeek;
        if (emit) this._emit('playback-state', state);
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
