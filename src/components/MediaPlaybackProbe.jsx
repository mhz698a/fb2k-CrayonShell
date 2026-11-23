import { useCallback, useEffect, useRef, useState } from 'react';
import {
    getMediaSdk,
    inspectCurrentMediaTrack,
    inspectWebViewEnvironment
} from '../services/mediaPlaybackProbe.js';

function formatTime(value) {
    const seconds = Math.max(0, Number(value) || 0);
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.floor(seconds % 60);

    return String(minutes).padStart(2, '0')
        + ':'
        + String(remainder).padStart(2, '0');
}

function describeCapability(value) {
    if (value === true) return 'Sí';
    if (value === false) return 'No';
    return value || 'Desconocido';
}

export default function MediaPlaybackProbe() {
    const videoRef = useRef(null);
    const followerRef = useRef(null);
    const unsubscribeRef = useRef([]);
    const requestIdRef = useRef(0);

    const [environment, setEnvironment] = useState(null);
    const [inspection, setInspection] = useState(null);
    const [status, setStatus] = useState('Preparando diagnóstico…');
    const [lastEvent, setLastEvent] = useState('Sin eventos');
    const [videoTime, setVideoTime] = useState(0);
    const [isInspecting, setIsInspecting] = useState(false);
    const [isFollowing, setIsFollowing] = useState(false);

    const clearSubscriptions = useCallback(() => {
        unsubscribeRef.current.forEach((unsubscribe) => {
            try {
                unsubscribe();
            } catch {
                // Ignore stale SDK subscriptions during cleanup.
            }
        });
        unsubscribeRef.current = [];
    }, []);

    const stopFollowing = useCallback((updateStatus = true) => {
        requestIdRef.current += 1;
        clearSubscriptions();

        if (followerRef.current) {
            followerRef.current.dispose();
            followerRef.current = null;
        }

        if (updateStatus) {
            setIsFollowing(false);
            setVideoTime(0);
        }

        if (updateStatus) {
            setStatus('Seguimiento detenido.');
        }
    }, [clearSubscriptions]);

    const loadTrackIntoFollower = useCallback(async () => {
        const requestId = ++requestIdRef.current;

        try {
            const nextInspection = await inspectCurrentMediaTrack();
            if (requestId !== requestIdRef.current) return;

            setInspection(nextInspection);

            const follower = followerRef.current;
            if (!follower) return;

            if (!nextInspection.hasTrack || !nextInspection.videoTrack) {
                await follower.setSource(null);
                if (requestId === requestIdRef.current) {
                    setStatus(nextInspection.hasTrack
                        ? 'La pista actual no contiene video. El seguidor permanece activo.'
                        : 'No hay una pista cargada. El seguidor permanece activo.');
                    setLastEvent('Fuente de video liberada');
                }
                return;
            }

            await follower.setSource(nextInspection.sourcePath, {
                timelineOffset: nextInspection.timelineOffset
            });

            if (requestId === requestIdRef.current) {
                setStatus('Video enlazado al reloj de foobar2000.');
                setLastEvent('Fuente actualizada: ' + nextInspection.containerFormat);
            }
        } catch (error) {
            if (requestId !== requestIdRef.current) return;

            const message = error.message || String(error);
            setStatus('No se pudo actualizar el video: ' + message);

            if (followerRef.current) {
                try {
                    await followerRef.current.setSource(null);
                } catch {
                    // The follower may already have been disposed.
                }
            }
        }
    }, []);

    useEffect(() => {
        let active = true;

        inspectWebViewEnvironment()
            .then((result) => {
                if (!active) return;
                setEnvironment(result);

                if (!result.isHttpOrigin) {
                    setStatus('El origen actual no es HTTP(S). getStreamUrl no podrá emitir una URL multimedia.');
                } else if (!result.hasMediaElementFollower || !result.hasMediaApi) {
                    setStatus('El SDK cargó, pero faltan las APIs multimedia requeridas.');
                } else {
                    setStatus('Entorno detectado. Inspecciona la pista de video actual.');
                }
            })
            .catch((error) => {
                if (!active) return;
                setStatus(error.message || String(error));
            });

        return () => {
            active = false;
            stopFollowing(false);
        };
    }, [stopFollowing]);

    const inspectCurrentTrack = useCallback(async () => {
        setIsInspecting(true);
        setStatus('Inspeccionando la pista actual…');

        try {
            const result = await inspectCurrentMediaTrack();
            setInspection(result);

            if (!result.hasTrack) {
                setStatus('foobar2000 no tiene una pista cargada.');
            } else if (!result.recognized) {
                setStatus('El contenedor no está entre los formatos que inspecciona el SDK.');
            } else if (!result.videoTrack) {
                setStatus('El contenedor se reconoció, pero no contiene una pista de video.');
            } else {
                setStatus('Pista de video detectada. Puedes iniciar la prueba de sincronización.');
            }
        } catch (error) {
            setStatus('Falló la inspección: ' + (error.message || String(error)));
            setInspection(null);
        } finally {
            setIsInspecting(false);
        }
    }, []);

    const startFollowing = useCallback(async () => {
        if (followerRef.current) return;

        setStatus('Iniciando seguidor multimedia…');

        try {
            const sdk = getMediaSdk();

            if (window.location.protocol !== 'http:'
                && window.location.protocol !== 'https:') {
                throw new Error('El origen debe ser HTTP(S). La API de streaming local rechaza file:// y orígenes opacos.');
            }

            if (typeof sdk.MediaElementFollower !== 'function') {
                throw new Error('MediaElementFollower no está disponible en el SDK autoinyectado.');
            }

            if (!videoRef.current) {
                throw new Error('No se encontró el elemento video de diagnóstico.');
            }

            const nextInspection = await inspectCurrentMediaTrack();
            setInspection(nextInspection);

            if (!nextInspection.hasTrack || !nextInspection.videoTrack) {
                throw new Error('La pista actual no contiene una pista de video compatible con el inspector.');
            }

            const follower = new sdk.MediaElementFollower(videoRef.current);
            followerRef.current = follower;

            unsubscribeRef.current.push(
                follower.onError((error) => {
                    setStatus('Error del seguidor: ' + (error.message || String(error)));
                })
            );

            unsubscribeRef.current.push(
                sdk.on('playback:trackChanged', () => {
                    setLastEvent('Cambio de pista recibido de foobar2000');
                    void loadTrackIntoFollower();
                })
            );

            unsubscribeRef.current.push(
                sdk.on('playback:seeked', (payload) => {
                    setLastEvent('Búsqueda de foobar2000: ' + formatTime(payload?.position));
                })
            );

            unsubscribeRef.current.push(
                sdk.on('playback:stateChanged', (payload) => {
                    setLastEvent('Estado de foobar2000: ' + (payload?.state || 'actualizado'));
                })
            );

            await follower.setSource(nextInspection.sourcePath, {
                timelineOffset: nextInspection.timelineOffset
            });

            setIsFollowing(true);
            setStatus('Video enlazado al reloj de foobar2000. Prueba pausa, búsqueda y cambio de pista.');
            setLastEvent('Seguidor iniciado');
        } catch (error) {
            const message = error.message || String(error);
            setStatus('No se pudo iniciar el seguimiento: ' + message);

            if (followerRef.current) {
                stopFollowing(false);
                setStatus('No se pudo iniciar el seguimiento: ' + message);
            }
        }
    }, [loadTrackIntoFollower, stopFollowing]);

    const canInspect = Boolean(environment?.hasPlaybackApi && environment?.hasMediaApi);
    const canStart = Boolean(
        !isFollowing
        && environment?.isHttpOrigin
        && environment?.hasMediaElementFollower
        && inspection?.videoTrack
    );

    return (
        <section className="media-probe" aria-label="Prueba multimedia de fase 1">
            <div className="media-probe-heading">
                <div>
                    <strong>Prueba multimedia · Fase 1</strong>
                    <span>Diagnóstico temporal; no sustituye ni desactiva foo_mpv o Artwork View.</span>
                </div>
                <span className={isFollowing ? 'media-probe-state is-active' : 'media-probe-state'}>
                    {isFollowing ? 'Siguiendo reproducción' : 'Prueba detenida'}
                </span>
            </div>

            <div className="media-probe-content">
                <div className="media-probe-preview">
                    <video
                        ref={videoRef}
                        className="media-probe-video"
                        muted
                        playsInline
                        preload="metadata"
                        onTimeUpdate={(event) => setVideoTime(event.currentTarget.currentTime)}
                    />
                    <div className="media-probe-video-time">
                        Video: {formatTime(videoTime)}
                        {videoRef.current?.duration && Number.isFinite(videoRef.current.duration)
                            ? ' / ' + formatTime(videoRef.current.duration)
                            : ''}
                    </div>
                </div>

                <div className="media-probe-details">
                    <div className="media-probe-status">{status}</div>
                    <div><b>Origen:</b> {environment?.origin || 'Consultando…'}</div>
                    <div><b>Origen HTTP(S):</b> {environment ? (environment.isHttpOrigin ? 'Sí' : 'No') : '—'}</div>
                    <div><b>Origen de la página:</b> {environment?.source || '—'}{environment?.templateName ? ' · Plantilla: ' + environment.templateName : ''}</div>
                    <div><b>Media API / Follower:</b> {environment
                        ? (environment.hasMediaApi ? 'Media API disponible' : 'Media API ausente')
                            + ' · '
                            + (environment.hasMediaElementFollower ? 'Follower disponible' : 'Follower ausente')
                        : '—'}</div>
                    <div><b>Archivo:</b> {inspection?.path || 'Sin inspeccionar'}</div>
                    <div><b>Contenedor:</b> {inspection?.containerFormat || '—'}
                        {inspection?.recognized === false ? ' · No reconocido' : ''}
                    </div>
                    <div><b>Pista de video:</b> {inspection?.videoTrack
                        ? (inspection.videoTrack.codec || inspection.videoTrack.codecName || 'Detectada')
                        : 'No detectada'}</div>
                    {inspection?.capabilities && (
                        <div><b>Decodificación:</b> {describeCapability(inspection.capabilities.supported)}
                            {' · Smooth: '}{describeCapability(inspection.capabilities.smooth)}
                            {' · canPlayType: '}{describeCapability(inspection.capabilities.canPlayType)}
                        </div>
                    )}
                    {inspection?.capabilityError && (
                        <div><b>Consulta de códec:</b> {inspection.capabilityError}</div>
                    )}
                    {environment?.sourceError && (
                        <div><b>Origen del host:</b> {environment.sourceError}</div>
                    )}
                    <div><b>Evento reciente:</b> {lastEvent}</div>
                </div>
            </div>

            <div className="media-probe-actions">
                <button
                    type="button"
                    onClick={inspectCurrentTrack}
                    disabled={!canInspect || isInspecting || isFollowing}
                >
                    {isInspecting ? 'Inspeccionando…' : 'Inspeccionar pista actual'}
                </button>
                <button
                    type="button"
                    onClick={startFollowing}
                    disabled={!canStart || isInspecting}
                >
                    Iniciar seguimiento
                </button>
                <button
                    type="button"
                    onClick={() => stopFollowing()}
                    disabled={!isFollowing}
                >
                    Detener
                </button>
            </div>
        </section>
    );
}
