import { useCallback, useEffect, useRef, useState } from 'react';
import { getFooSdk } from '../services/fooSdk.js';
import { readWaveformCacheSettings } from '../features/waveform/waveformCacheSettings.js';
import { WaveformPlaybackController } from '../services/waveform/waveformPlaybackController.js';
import {
    clampWaveformPosition,
    getWaveformPositionFromPointer,
    getWaveformTimeLabels
} from '../services/waveform/waveformDisplay.js';

function drawWaveform(canvas, segmentMap, duration, position, accentColor) {
    if (!canvas) return;

    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const pixelRatio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const pixelWidth = Math.round(width * pixelRatio);
    const pixelHeight = Math.round(height * pixelRatio);

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
    }

    const context = canvas.getContext('2d');
    if (!context) return;

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);

    const center = height / 2;
    const accent = accentColor || '#007acc';
    const safeDuration = Number(duration) > 0 ? Number(duration) : 0;
    const safePosition = clampWaveformPosition(position, safeDuration);
    const cursorX = safeDuration > 0 ? (safePosition / safeDuration) * width : 0;

    context.fillStyle = 'rgba(150, 160, 170, .18)';
    context.fillRect(0, center - 0.5, width, 1);

    if (safeDuration > 0) {
        const segments = Array.from(segmentMap.values()).sort((a, b) => a.index - b.index);
        for (const segment of segments) {
            if (!segment.peaks?.length) continue;

            const segmentStart = Math.max(0, segment.start);
            const segmentEnd = Math.min(safeDuration, segment.end);
            const segmentWidth = ((segmentEnd - segmentStart) / safeDuration) * width;
            if (segmentWidth <= 0) continue;

            const columnWidth = Math.max(0.7, (segmentWidth / segment.peaks.length) * 0.78);
            context.fillStyle = 'rgba(174, 187, 198, .88)';

            for (let index = 0; index < segment.peaks.length; index += 1) {
                const amplitude = Math.max(0, Math.min(1, Number(segment.peaks[index]) || 0));
                const barHeight = Math.max(1, amplitude * (height - 5));
                const x = ((segmentStart
                    + ((index + 0.5) / segment.peaks.length) * (segmentEnd - segmentStart))
                    / safeDuration) * width;
                context.fillRect(x, center - barHeight / 2, columnWidth, barHeight);
            }
        }

        if (cursorX > 0) {
            context.fillStyle = 'rgba(0, 122, 204, .14)';
            context.fillRect(0, 0, cursorX, height);
        }

        context.fillStyle = accent;
        context.fillRect(Math.max(0, Math.min(width - 1.5, cursorX - 1)), 1, 1.5, height - 2);
    }
}

function getStatusText(snapshot, error, isSeeking) {
    if (isSeeking) return 'Buscando…';
    if (error) return error;
    if (!snapshot?.started) return 'Conectando con foobar2000…';
    if (!snapshot.trackPath) return 'No hay una pista cargada.';
    if (!snapshot.trackKey) {
        return snapshot.canSeek
            ? 'No hay PCM disponible. La seekbar continúa habilitada.'
            : 'No hay PCM disponible para esta pista.';
    }
    if (snapshot.waveform?.status === 'complete') return 'Análisis completo';
    if (snapshot.waveform?.status === 'partial') return 'Análisis parcial';

    const completed = Number(snapshot.waveform?.completedSegments) || 0;
    const total = Number(snapshot.waveform?.totalSegments) || 0;
    if (total > 0 && completed > 0) {
        return 'Analizando · ' + completed + '/' + total + ' segmentos';
    }
    return 'Generando waveform…';
}

export default function WaveformSeekbar({ onCacheControllerChange }) {
    const canvasRef = useRef(null);
    const controllerRef = useRef(null);
    const mountedRef = useRef(false);
    const segmentsRef = useRef({ trackKey: null, items: new Map() });
    const pointerRef = useRef(null);
    const pendingSeekRef = useRef(null);
    const snapshotRef = useRef(null);
    const lastDisplayedSecondRef = useRef(-1);
    const accentColorRef = useRef('#007acc');

    const [snapshot, setSnapshot] = useState(null);
    const [displayPosition, setDisplayPosition] = useState(0);
    const [previewPosition, setPreviewPosition] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [isSeeking, setIsSeeking] = useState(false);
    const [error, setError] = useState('');
    const [segmentsRevision, setSegmentsRevision] = useState(0);

    snapshotRef.current = snapshot;

    const seekTo = useCallback(async (position) => {
        const controller = controllerRef.current;
        if (!controller) return;

        const target = clampWaveformPosition(position, snapshotRef.current?.duration);
        pendingSeekRef.current = target;
        setPreviewPosition(target);
        setDisplayPosition(target);
        setIsSeeking(true);
        setError('');
        try {
            await controller.seek(target);
            if (!mountedRef.current) return;
            const nextSnapshot = controller.getSnapshot();
            setSnapshot(nextSnapshot);
            setDisplayPosition(nextSnapshot.position);
        } catch (failure) {
            if (!mountedRef.current) return;
            setError(failure?.message || 'No se pudo cambiar la posición de reproducción.');
            setDisplayPosition(controller.getPosition());
        } finally {
            pendingSeekRef.current = null;
            if (mountedRef.current) setIsSeeking(false);
        }
    }, []);

    useEffect(() => {
        let active = true;
        let controller = null;
        mountedRef.current = true;

        const updateSnapshot = (nextSnapshot) => {
            if (!active || !nextSnapshot) return;

            const nextTrackKey = nextSnapshot.trackKey || null;
            if (nextTrackKey !== segmentsRef.current.trackKey) {
                segmentsRef.current = {
                    trackKey: nextTrackKey,
                    items: new Map()
                };
                pointerRef.current = null;
                pendingSeekRef.current = null;
                setIsDragging(false);
                setIsSeeking(false);
                setPreviewPosition(0);
            }

            setSnapshot(nextSnapshot);
            if (!pointerRef.current) {
                setDisplayPosition(nextSnapshot.position || 0);
            }
        };

        try {
            const sdk = getFooSdk();
            const cacheSettings = readWaveformCacheSettings();
            controller = new WaveformPlaybackController({
                sdk,
                engineOptions: {
                    resolution: 4096,
                    cacheMaxBytes: cacheSettings.maxBytes
                },
                onSegment(segment) {
                    if (!active || !segment?.trackKey || !segment.peaks) return;

                    if (segmentsRef.current.trackKey !== segment.trackKey) {
                        segmentsRef.current = {
                            trackKey: segment.trackKey,
                            items: new Map()
                        };
                    }

                    segmentsRef.current.items.set(segment.index, {
                        index: segment.index,
                        start: segment.start,
                        end: segment.end,
                        peaks: Float32Array.from(segment.peaks)
                    });
                    setSegmentsRevision((revision) => revision + 1);
                },
                onUpdate(update) {
                    updateSnapshot(update?.snapshot);
                    if (update?.type === 'track-loaded') setError('');
                    if (update?.type === 'error') {
                        setError(update.detail?.message || update.snapshot?.lastError || 'Error del motor waveform.');
                    }
                },
                onError(failure) {
                    if (!active) return;
                    setError(failure?.message || 'No se pudo generar el waveform.');
                }
            });

            controllerRef.current = controller;
            onCacheControllerChange?.({
                getSnapshot: () => controller.getSnapshot()?.waveform?.cache || null,
                maintain: (options) => controller.maintainCache(options),
                clearInactive: () => controller.clearInactiveCache(),
                setMaxBytes: (maxBytes) => controller.setCacheMaxBytes(maxBytes)
            });
            if (import.meta.env.DEV) {
                window.__crayonshellWaveformPlaybackController = controller;
            }
            controller.start().then((initialSnapshot) => {
                updateSnapshot(initialSnapshot);
            }).catch((failure) => {
                if (!active) return;
                setError(failure?.message || 'No se pudo iniciar la integración waveform.');
            });
        } catch (failure) {
            setError(failure?.message || 'El puente de foobar2000 no está disponible.');
        }

        return () => {
            active = false;
            mountedRef.current = false;
            pointerRef.current = null;
            controllerRef.current = null;
            onCacheControllerChange?.(null);
            if (import.meta.env.DEV
                && window.__crayonshellWaveformPlaybackController === controller) {
                delete window.__crayonshellWaveformPlaybackController;
            }
            controller?.dispose();
        };
    }, [onCacheControllerChange]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const color = getComputedStyle(canvas).getPropertyValue('--accent-color').trim();
        if (color) accentColorRef.current = color;
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || typeof ResizeObserver !== 'function') return undefined;

        const observer = new ResizeObserver(() => {
            setSegmentsRevision((revision) => revision + 1);
        });
        observer.observe(canvas);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        let frameId = 0;
        let running = true;
        const shouldAnimate = Boolean(
            (Number(snapshot?.duration) > 0 && snapshot.playbackState === 'playing')
            || isDragging
            || isSeeking
        );

        const render = () => {
            if (!running) return;

            const controller = controllerRef.current;
            const currentSnapshot = snapshotRef.current;
            const duration = Number(currentSnapshot?.duration)
                || Number(currentSnapshot?.waveform?.duration)
                || 0;
            const clockPosition = controller?.getPosition();
            const position = pointerRef.current
                ? pointerRef.current.position
                : pendingSeekRef.current !== null
                    ? pendingSeekRef.current
                    : Number.isFinite(clockPosition)
                        ? clockPosition
                        : Number(currentSnapshot?.position) || 0;

            drawWaveform(
                canvasRef.current,
                segmentsRef.current.items,
                duration,
                position,
                accentColorRef.current
            );

            if (!pointerRef.current && pendingSeekRef.current === null) {
                const wholeSecond = Math.floor(Math.max(0, position));
                if (wholeSecond !== lastDisplayedSecondRef.current) {
                    lastDisplayedSecondRef.current = wholeSecond;
                    setDisplayPosition(wholeSecond);
                }
            }

            if (shouldAnimate) frameId = window.requestAnimationFrame(render);
        };

        render();
        return () => {
            running = false;
            if (frameId) window.cancelAnimationFrame(frameId);
        };
    }, [snapshot?.trackKey, snapshot?.playbackState, segmentsRevision, isDragging, isSeeking]);

    const currentDuration = Number(snapshot?.duration)
        || Number(snapshot?.waveform?.duration)
        || 0;
    const currentPosition = isDragging || isSeeking
        ? previewPosition
        : clampWaveformPosition(displayPosition, currentDuration);
    const canSeek = Boolean(snapshot?.canSeek && currentDuration > 0);
    const timeLabels = getWaveformTimeLabels(currentPosition, currentDuration);
    const statusText = getStatusText(snapshot, error, isSeeking);

    const getPointerPosition = (event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        return getWaveformPositionFromPointer(
            event.clientX,
            bounds,
            currentDuration
        );
    };

    const handlePointerDown = (event) => {
        if (!canSeek || event.button !== 0) return;
        event.preventDefault();
        const position = getPointerPosition(event);
        pointerRef.current = { pointerId: event.pointerId, position };
        setPreviewPosition(position);
        setDisplayPosition(position);
        setIsDragging(true);
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // Some embedded WebView2 surfaces may not expose pointer capture.
        }
    };

    const handlePointerMove = (event) => {
        if (!pointerRef.current || pointerRef.current.pointerId !== event.pointerId) return;
        const position = getPointerPosition(event);
        pointerRef.current.position = position;
        setPreviewPosition(position);
        setDisplayPosition(position);
    };

    const finishPointerSeek = (event, shouldSeek) => {
        if (!pointerRef.current || pointerRef.current.pointerId !== event.pointerId) return;
        const pointerPosition = getPointerPosition(event);
        pointerRef.current = null;
        setIsDragging(false);

        try {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
            }
        } catch {
            // Releasing an already lost capture is harmless.
        }

        const position = shouldSeek
            ? pointerPosition
            : controllerRef.current?.getPosition() || 0;
        setPreviewPosition(position);
        setDisplayPosition(position);
        if (shouldSeek) void seekTo(position);
    };

    const handleKeyDown = (event) => {
        if (!canSeek) return;

        const current = controllerRef.current?.getPosition() || 0;
        const step = event.shiftKey ? 15 : 5;
        let target = current;

        if (event.key === 'ArrowLeft') target -= step;
        else if (event.key === 'ArrowRight') target += step;
        else if (event.key === 'PageDown') target -= currentDuration * 0.1;
        else if (event.key === 'PageUp') target += currentDuration * 0.1;
        else if (event.key === 'Home') target = 0;
        else if (event.key === 'End') target = currentDuration;
        else return;

        event.preventDefault();
        void seekTo(clampWaveformPosition(target, currentDuration));
    };

    return (
        <div className="waveform-seekbar" role="group" aria-label="Controles de posición de reproducción">
            <span className="waveform-seekbar-time waveform-seekbar-current">
                {timeLabels.current}
            </span>
            <canvas
                ref={canvasRef}
                className={'waveform-seekbar-canvas' + (canSeek ? ' is-seekable' : '')}
                role="slider"
                aria-label="Barra de búsqueda de waveform"
                aria-valuemin={0}
                aria-valuemax={currentDuration}
                aria-valuenow={currentPosition}
                aria-valuetext={
                    timeLabels.current + ' transcurridos, '
                    + timeLabels.remaining + ' restantes, duración total '
                    + timeLabels.total
                }
                aria-disabled={!canSeek}
                tabIndex={canSeek ? 0 : -1}
                title={statusText}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={(event) => finishPointerSeek(event, true)}
                onPointerCancel={(event) => finishPointerSeek(event, false)}
                onKeyDown={handleKeyDown}
            />
            <div className="waveform-seekbar-time waveform-seekbar-end">
                <span className="waveform-seekbar-remaining">−{timeLabels.remaining}</span>
                <span className="waveform-seekbar-time-separator">/</span>
                <span className="waveform-seekbar-duration">{timeLabels.total}</span>
            </div>
        </div>
    );
}
