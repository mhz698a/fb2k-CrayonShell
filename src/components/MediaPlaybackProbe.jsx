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

function describeMediaError(video) {
    const error = video?.error;
    if (!error) return 'Error multimedia sin detalle.';

    const names = {
        1: 'MEDIA_ERR_ABORTED',
        2: 'MEDIA_ERR_NETWORK',
        3: 'MEDIA_ERR_DECODE',
        4: 'MEDIA_ERR_SRC_NOT_SUPPORTED'
    };

    return (names[error.code] || 'MEDIA_ERR_UNKNOWN')
        + (error.message ? ': ' + error.message : '');
}

function getEnvironmentStatus(environment) {
    if (!environment?.hasHostBridge) {
        return 'Sin puente de foobar2000. Para probar Vite, ábrelo dentro de WebView2 UI mediante Developer > Use development server. Un navegador externo no recibe window.fb.';
    }

    if (environment.isFileOrigin) {
        return 'La página está abierta como file://. El puente del host puede existir, pero Media API no admite este origen. Instala la compilación como plantilla de WebView2.';
    }

    if (!environment.isHttpOrigin) {
        return 'Origen no compatible para Media API. Usa el servidor de desarrollo de WebView2 o una plantilla instalada.';
    }

    if (!environment.hasPlaybackApi || !environment.hasMediaApi) {
        return 'El host respondió, pero faltan APIs de reproducción o multimedia en el SDK cargado.';
    }

    if (!environment.hasMediaElementFollower) {
        return 'La inspección está disponible, pero MediaElementFollower no está presente en el SDK.';
    }

    if (environment.source === 'devServer') {
        return 'WebView2 está cargando Vite. Esperando una pista activa para inspeccionarla.';
    }

    return 'WebView2 está conectado. Esperando una pista activa para inspeccionarla.';
}

export default function MediaPlaybackProbe() {
    const videoRef = useRef(null);
    const followerRef = useRef(null);
    const unsubscribeRef = useRef([]);
    const requestIdRef = useRef(0);
    const mountedRef = useRef(false);

    const [environment, setEnvironment] = useState(null);
    const [inspection, setInspection] = useState(null);
    const [status, setStatus] = useState('Comprobando conexión con WebView2…');
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
            setStatus('Seguimiento detenido.');
        }
    }, [clearSubscriptions]);

    const inspectCurrentTrack = useCallback(async (options = {}) => {
        const requestId = ++requestIdRef.current;
        const automatic = Boolean(options.automatic);
        setIsInspecting(true);

        if (!automatic) {
            setStatus('Consultando pista activa de foobar2000…');
        }

        try {
            const result = await inspectCurrentMediaTrack();
            if (!mountedRef.current || requestId !== requestIdRef.current) return;

            setInspection(result);

            if (!result.hasTrack) {
                setStatus('foobar2000 no tiene una pista en reproducción.');
                setLastEvent('Inspección completada: sin pista activa');
                return;
            }

            if (!result.recognized) {
                setStatus('Archivo activo detectado, pero el contenedor no pertenece a MP4, MOV, Matroska o WebM.');
                setLastEvent('Contenedor no reconocido');
                return;
            }

            if (!result.videoTrack) {
                setStatus('Pista activa detectada: ' + result.containerFormat + ', sin pista de video. No se inicia el seguidor.');
                setLastEvent('Archivo multimedia sin video');
                if (followerRef.current) {
                    await followerRef.current.setSource(null);
                    setIsFollowing(false);
                    setVideoTime(0);
                }
                return;
            }

            setStatus('Video detectado: ' + result.containerFormat
                + (result.videoTrack.codec ? ' · ' + result.videoTrack.codec : '')
                + '. Listo para iniciar el seguimiento.');

            setLastEvent(automatic
                ? 'Detección automática: pista de video'
                : 'Inspección completada: pista de video');

            const follower = followerRef.current;
            if (follower) {
                await follower.setSource(result.sourcePath, {
                    timelineOffset: result.timelineOffset
                });
                if (requestId === requestIdRef.current) {
                    setIsFollowing(true);
                    setStatus('Fuente de video actualizada y enlazada al reloj de foobar2000.');
                }
            }
        } catch (error) {
            if (!mountedRef.current || requestId !== requestIdRef.current) return;

            const message = error.message || String(error);
            const code = error.code ? ' [' + error.code + ']' : '';
            setInspection(null);

            if (error.code === 'ORIGIN_DENIED') {
                setStatus('El host rechazó el origen de esta página. Carga Vite desde Developer > Use development server o usa una plantilla de WebView2. ' + message + code);
            } else {
                setStatus('No se pudo inspeccionar la pista: ' + message + code);
            }

            setLastEvent('Error durante la inspección');
        } finally {
            if (mountedRef.current && requestId === requestIdRef.current) {
                setIsInspecting(false);
            }
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        let active = true;
        let sdk = null;

        try {
            sdk = getMediaSdk();
        } catch {
            sdk = null;
        }

        if (sdk?.on) {
            unsubscribeRef.current.push(
                sdk.on('playback:trackChanged', () => {
                    setLastEvent('Cambio de pista recibido. Detectando el nuevo archivo…');
                    void inspectCurrentTrack({ automatic: true });
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
        }

        inspectWebViewEnvironment()
            .then((result) => {
                if (!active || !mountedRef.current) return;
                setEnvironment(result);
                setStatus(getEnvironmentStatus(result));

                if (result.hasHostBridge && result.isHttpOrigin
                    && result.hasPlaybackApi && result.hasMediaApi) {
                    void inspectCurrentTrack({ automatic: true });
                }
            })
            .catch((error) => {
                if (!active || !mountedRef.current) return;
                setStatus('No se pudo consultar el entorno: ' + (error.message || String(error)));
            });

        return () => {
            active = false;
            mountedRef.current = false;
            stopFollowing(false);
        };
    }, [inspectCurrentTrack, stopFollowing]);

    const startFollowing = useCallback(async () => {
        if (followerRef.current || !videoRef.current) return;

        setStatus('Iniciando MediaElementFollower…');

        try {
            const sdk = getMediaSdk();

            if (!environment?.hasHostBridge || !environment?.isHttpOrigin) {
                throw new Error('La página debe ejecutarse dentro del host desde un origen HTTP(S) confiable.');
            }

            if (typeof sdk.MediaElementFollower !== 'function') {
                throw new Error('MediaElementFollower no está disponible en el SDK.');
            }

            const result = await inspectCurrentMediaTrack();
            setInspection(result);

            if (!result.hasTrack || !result.videoTrack) {
                throw new Error('La pista activa no contiene video.');
            }

            const follower = new sdk.MediaElementFollower(videoRef.current);
            followerRef.current = follower;

            unsubscribeRef.current.push(
                follower.onError((error) => {
                    setStatus('Error del seguidor multimedia: ' + (error.message || String(error)));
                    setLastEvent('MediaElementFollower informó un error');
                })
            );

            await follower.setSource(result.sourcePath, {
                timelineOffset: result.timelineOffset
            });

            if (!mountedRef.current) {
                follower.dispose();
                followerRef.current = null;
                return;
            }

            setIsFollowing(true);
            setStatus('Video enlazado al reloj de foobar2000. Prueba pausa, reanudación y búsqueda desde el reproductor.');
            setLastEvent('MediaElementFollower iniciado');
        } catch (error) {
            const message = error.message || String(error);
            const code = error.code ? ' [' + error.code + ']' : '';
            setStatus('No se pudo iniciar el seguimiento: ' + message + code);

            if (followerRef.current) {
                followerRef.current.dispose();
                followerRef.current = null;
            }

            clearSubscriptions();
            setIsFollowing(false);
        }
    }, [clearSubscriptions, environment]);

    const handleVideoError = useCallback((event) => {
        const message = describeMediaError(event.currentTarget);
        setStatus('El elemento de video no pudo reproducir la fuente: ' + message);
        setLastEvent('HTMLVideoElement error');
    }, []);

    const canInspect = Boolean(
        environment?.hasHostBridge
        && environment?.isHttpOrigin
        && environment?.hasPlaybackApi
        && environment?.hasMediaApi
    );
    const canStart = Boolean(
        !isFollowing
        && environment?.hasHostBridge
        && environment?.isHttpOrigin
        && environment?.hasMediaElementFollower
        && inspection?.videoTrack
    );

    return (
        <section className="media-probe" aria-label="Prueba multimedia de fase 1">
            <div className="media-probe-heading">
                <div>
                    <strong>Prueba multimedia · Fase 1</strong>
                    <span>Detección automática de la pista activa. No sustituye ni desactiva foo_mpv o Artwork View.</span>
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
                        onLoadedMetadata={() => setLastEvent('Metadata de video cargada')}
                        onPlaying={() => setLastEvent('El elemento de video está reproduciendo')}
                        onError={handleVideoError}
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
                    <div><b>Host foobar2000:</b> {environment
                        ? (environment.hasHostBridge ? 'Conectado' : 'No conectado')
                        : 'Consultando…'}</div>
                    <div><b>Origen de la página:</b> {environment?.source || '—'}
                        {environment?.templateName || environment?.activeTemplateName
                            ? ' · Plantilla: ' + (environment.templateName || environment.activeTemplateName)
                            : ''}
                    </div>
                    <div><b>Media API:</b> {environment
                        ? (environment.hasMediaApi ? 'Disponible' : 'No disponible')
                            + ' · '
                            + (environment.hasMediaElementFollower ? 'MediaElementFollower disponible' : 'MediaElementFollower no disponible')
                        : '—'}</div>
                    <div><b>Archivo activo:</b> {inspection?.path || 'Sin archivo detectado'}</div>
                    <div><b>Contenedor:</b> {inspection?.containerFormat || '—'}
                        {inspection?.recognized === false ? ' · No reconocido' : ''}
                    </div>
                    <div><b>Pista de video:</b> {inspection?.videoTrack
                        ? [
                            inspection.videoTrack.codec || 'Códec desconocido',
                            inspection.videoTrack.width && inspection.videoTrack.height
                                ? inspection.videoTrack.width + '×' + inspection.videoTrack.height
                                : '',
                            inspection.videoTrack.frameRate
                                ? inspection.videoTrack.frameRate + ' fps'
                                : ''
                        ].filter(Boolean).join(' · ')
                        : 'No detectada'}</div>
                    <div><b>Evento reciente:</b> {lastEvent}</div>
                    {environment?.sourceError && (
                        <div><b>Información del host:</b> {environment.sourceError}</div>
                    )}
                </div>
            </div>

            <div className="media-probe-actions">
                <button
                    type="button"
                    onClick={() => inspectCurrentTrack()}
                    disabled={!canInspect || isInspecting || isFollowing}
                >
                    {isInspecting ? 'Inspeccionando…' : 'Volver a inspeccionar'}
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
