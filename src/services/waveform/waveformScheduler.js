import {
    chooseWaveformSegmentDuration,
    getWaveformSegmentRange
} from './waveformIdentity.js';

function clampPosition(position, duration) {
    const value = Number(position);
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(duration, value));
}

export class WaveformScheduler {
    constructor(options = {}) {
        if (typeof options.decodeSegment !== 'function') {
            throw new TypeError('WaveformScheduler requiere decodeSegment().');
        }
        this.decodeSegment = options.decodeSegment;
        this.onSegment = options.onSegment || (() => undefined);
        this.onState = options.onState || (() => undefined);
        this.onError = options.onError || (() => undefined);
        this.segmentDurationOptions = options.segmentDurationOptions || {};
        this.resolution = Number.isInteger(options.resolution) ? options.resolution : 4096;

        this.track = null;
        this.cache = null;
        this.segmentSeconds = 0;
        this.position = 0;
        this.generation = 0;
        this.active = null;
        this.pumping = false;
        this.completed = new Set();
        this.failed = new Map();
        this.disposed = false;
    }

    setTrack(track, cache, position = 0) {
        if (this.disposed) throw new Error('WaveformScheduler ya fue liberado.');
        this.generation += 1;
        this.active?.controller.abort();
        this.track = track || null;
        this.cache = track ? cache : null;
        this.completed.clear();
        this.failed.clear();

        if (!track) {
            this.segmentSeconds = 0;
            this.position = 0;
            this._emitState('idle');
            return;
        }
        if (!cache || !Number.isFinite(track.duration) || track.duration <= 0) {
            throw new TypeError('Se requiere una pista con duración y una caché persistente.');
        }

        this.segmentSeconds = chooseWaveformSegmentDuration(track, this.segmentDurationOptions);
        this.position = clampPosition(position, track.duration);
        this._emitState('loading');
        void this._pump();
    }

    setPosition(position) {
        if (!this.track) return;
        this.position = clampPosition(position, this.track.duration);
        const targetIndex = this._currentIndex();
        if (this.active && Math.abs(this.active.index - targetIndex) > 1) {
            // Do not let analysis of a distant section block a newly requested seek region.
            this.active.controller.abort();
        }
        this._emitState(this.pumping ? 'loading' : 'idle');
        void this._pump();
    }

    retryFailed() {
        if (!this.track || this.disposed) return;
        this.failed.clear();
        this._emitState('loading');
        void this._pump();
    }

    clear() {
        this.generation += 1;
        this.active?.controller.abort();
        this.track = null;
        this.cache = null;
        this.segmentSeconds = 0;
        this.position = 0;
        this.completed.clear();
        this.failed.clear();
        this._emitState('idle');
    }

    dispose() {
        if (this.disposed) return;
        this.clear();
        this.disposed = true;
    }

    getSnapshot() {
        const totalSegments = this.track
            ? Math.ceil(this.track.duration / this.segmentSeconds)
            : 0;
        return {
            status: this._status(totalSegments),
            duration: this.track?.duration || 0,
            segmentSeconds: this.segmentSeconds,
            totalSegments,
            completedSegments: this.completed.size,
            failedSegments: this.failed.size,
            activeSegment: this.active?.index ?? null,
            loadedIndexes: Array.from(this.completed).sort((a, b) => a - b),
            failedIndexes: Array.from(this.failed.keys()).sort((a, b) => a - b)
        };
    }

    _status(totalSegments = this.track
        ? Math.ceil(this.track.duration / this.segmentSeconds)
        : 0) {
        if (!this.track) return 'idle';
        if (this.completed.size >= totalSegments) return 'complete';
        if (this.completed.size + this.failed.size >= totalSegments) return 'partial';
        return this.pumping ? 'loading' : 'idle';
    }

    _currentIndex() {
        if (!this.track || !this.segmentSeconds) return 0;
        const last = Math.max(0, Math.ceil(this.track.duration / this.segmentSeconds) - 1);
        return Math.max(0, Math.min(last, Math.floor(this.position / this.segmentSeconds)));
    }

    _nextIndex() {
        if (!this.track) return null;
        const total = Math.ceil(this.track.duration / this.segmentSeconds);
        const current = this._currentIndex();

        // Prefer the playing region, then the upcoming audio, then fill the earlier history.
        for (let index = current; index < total; index += 1) {
            if (!this.completed.has(index) && !this.failed.has(index)) return index;
        }
        for (let index = 0; index < current; index += 1) {
            if (!this.completed.has(index) && !this.failed.has(index)) return index;
        }
        return null;
    }

    async _pump() {
        if (this.pumping || this.disposed) return;
        this.pumping = true;
        this._emitState('loading');

        try {
            while (this.track && !this.disposed) {
                const generation = this.generation;
                const track = this.track;
                const cache = this.cache;
                const index = this._nextIndex();
                if (index === null) break;

                const range = getWaveformSegmentRange(index, track.duration, this.segmentSeconds);
                if (!range) break;
                const controller = new AbortController();
                const active = { index, generation, controller };
                this.active = active;

                try {
                    const cached = await cache.readSegment(index);
                    if (generation !== this.generation || controller.signal.aborted) continue;
                    if (cached) {
                        this.completed.add(index);
                        this._notifySegment(cached);
                        continue;
                    }

                    const segment = await this.decodeSegment({
                        track,
                        index,
                        start: range.start,
                        end: range.end,
                        resolution: this.resolution,
                        signal: controller.signal
                    });
                    if (generation !== this.generation || controller.signal.aborted) continue;

                    await cache.saveSegment(segment);
                    if (generation !== this.generation || controller.signal.aborted) continue;

                    this.completed.add(index);
                    this._notifySegment(segment);
                } catch (error) {
                    if (generation !== this.generation) continue;
                    if (controller.signal.aborted || error?.name === 'AbortError') continue;

                    this.failed.set(index, error);
                    try {
                        this.onError(error, { index, start: range.start, end: range.end, track });
                    } catch {
                        // Consumer callbacks must not terminate the scheduler.
                    }
                } finally {
                    if (this.active === active) this.active = null;
                    if (generation === this.generation) {
                        this._emitState(this._status());
                    }
                }
            }
        } finally {
            this.pumping = false;
            this._emitState(this._status());
            // A track can be replaced while an asynchronous cache read is settling.
            if (this.track && !this.disposed && this._nextIndex() !== null) {
                void this._pump();
            }
        }
    }

    _notifySegment(segment) {
        try {
            this.onSegment(segment);
        } catch (error) {
            try {
                this.onError(error, { index: segment.index, source: 'onSegment' });
            } catch {
                // A faulty observer must not stop background analysis.
            }
        }
    }

    _emitState(status) {
        try {
            this.onState({ ...this.getSnapshot(), status });
        } catch {
            // State observers must not break decode or cache work.
        }
    }
}
