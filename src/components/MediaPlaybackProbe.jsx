import { useCallback, useEffect, useRef, useState } from 'react';
import {
    getMediaSdk,
    inspectCurrentMediaTrack,
    inspectEmbeddedFrontCover,
    inspectVideoStream,
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

function describeVideoElement(video) {
    if (!video) return 'Elemento de video no disponible.';
    const error = video.error;
    const names = {
        1: 'MEDIA_ERR_ABORTED',
        2: 'MEDIA_ERR_NETWORK',
        3: 'MEDIA_ERR_DECODE',
        4: 'MEDIA_ERR_SRC_NOT_SUPPORTED'
    };
    return [
        error ? (names[error.code] || 'MEDIA_ERR_UNKNOWN') + ' (' + error.code + ')' : 'sin MediaError',
        'networkState=' + video.networkState,
        'readyState=' + video.readyState,
        'currentTime=' + formatTime(video.currentTime),
        'videoWidth=' + video.videoWidth,
        'videoHeight=' + video.videoHeight,
        'source=' + (() => {
            try {
                const source = new URL(video.currentSrc || video.src, window.location.href);
                return source.origin + source.pathname.replace(/\/[^/]+$/, '/[token]');
            } catch {
                return video.currentSrc || video.src || '—';
            }
        })()
    ].join(' · ');
}

function formatSupport(value) {
    return value === true ? 'Sí'
        : value === false ? 'No'
            : value === '' ? 'No compatible'
                : value === 'unknown' || value == null ? 'Desconocido'
                    : String(value);
}

function isLikelyAudioFilePath(path) {
    const value = String(path || '').replace(/\|subsong:\d+$/i, '').split(/[?#]/, 1)[0];
    return /\.(?:aac|aif|aiff|alac|ape|dff|dsf|flac|m4a|m4b|mka|mp3|mpc|oga|ogg|opus|tak|tta|wav|wave|wma|wv)$/i.test(value);
}

const DIAGNOSTIC_LOG_KEY = 'crayonshell.mediaPlaybackProbe.logs.v1';
const MAX_DIAGNOSTIC_LOGS = 100;

function readDiagnosticLogs() {
    try {
        const saved = JSON.parse(window.localStorage.getItem(DIAGNOSTIC_LOG_KEY) || '[]');
        if (!Array.isArray(saved)) return [];
        return saved.filter((entry) => entry
            && typeof entry.timestamp === 'string'
            && typeof entry.message === 'string').slice(-MAX_DIAGNOSTIC_LOGS);
    } catch {
        return [];
    }
}

function sanitizeDiagnosticText(value) {
    return String(value ?? '')
        .replace(/file:\/\/[^\\/\s]+[\\/][^\s]*/gi, 'file://[ruta local]')
        .replace(/\b[A-Z]:\\[^\r\n]*/g, '[ruta local]');
}

function getMediaFileName(path) {
    if (!path) return '';
    const normalized = String(path).replace(/^file:\/\//i, '');
    return normalized.split(/[\\/]/).filter(Boolean).pop() || normalized;
}

function sanitizeMediaUrl(value) {
    if (!value) return '';
    try {
        const url = new URL(value, window.location.href);
        return url.origin + url.pathname.replace(/\/[^/]+$/, '/[token]');
    } catch {
        return sanitizeDiagnosticText(value);
    }
}

function getVideoElementDiagnostics(video) {
    if (!video) return null;
    return {
        error: video.error ? {
            code: video.error.code,
            message: sanitizeDiagnosticText(video.error.message || '')
        } : null,
        networkState: video.networkState,
        readyState: video.readyState,
        currentTime: video.currentTime,
        duration: Number.isFinite(video.duration) ? video.duration : null,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        source: sanitizeMediaUrl(video.currentSrc || video.src)
    };
}

function getTrackDiagnostics(inspection) {
    if (!inspection) return null;
    const trackFields = (track) => ({
        type: track.type,
        codec: track.codec,
        codecs: track.codecs,
        mimeType: track.mimeType,
        width: track.width,
        height: track.height,
        frameRate: track.frameRate,
        channels: track.channels,
        sampleRate: track.sampleRate,
        bitrate: track.bitrate
    });

    return {
        hasTrack: inspection.hasTrack,
        fileName: getMediaFileName(inspection.path || inspection.rawPath),
        pathType: inspection.pathType,
        subsong: inspection.subsong,
        position: inspection.position,
        duration: inspection.duration,
        timelineOffset: inspection.timelineOffset,
        recognized: inspection.recognized,
        containerFormat: inspection.containerFormat,
        trackCount: inspection.trackCount,
        videoTrack: inspection.videoTrack ? trackFields(inspection.videoTrack) : null,
        audioTracks: (inspection.audioTracks || []).map(trackFields),
        chapter: inspection.chapter || null,
        inspectionFailed: Boolean(inspection.inspectionFailed),
        inspectionStage: inspection.inspectionStage || '',
        inspectionError: sanitizeDiagnosticText(inspection.inspectionError || ''),
        inspectionErrorCode: inspection.inspectionErrorCode || ''
    };
}

async function copyTextToClipboard(text) {
    let clipboardError = null;

    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return;
        } catch (error) {
            clipboardError = error;
        }
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();

    let copied = false;
    try {
        copied = document.execCommand('copy');
    } finally {
        textarea.remove();
    }

    if (!copied) {
        throw clipboardError || new Error('El navegador rechazó la operación de copia.');
    }
}

function getEnvironmentStatus(environment) {
    if (!environment?.hasHostBridge) {
        return 'Sin puente nativo. Para probar Vite, ábrelo dentro de foobar2000 mediante WebView2 UI > Developer > Use development server. Un navegador externo no recibe window.fb2k.';
    }

    if (!environment.hasSdkFacade) {
        return 'El puente nativo está conectado, pero la fachada tipada foo-webview-sdk no se enlazó. Comprueba que CrayonShell se haya compilado con el paquete npm importado.';
    }

    if (environment.mediaRouteSupported === false) {
        return 'foo_ui_webview2 ' + environment.pluginVersion
            + ' no puede resolver las URL multimedia de esta prueba. Actualiza el componente a 2.2.0 o posterior; la versión 2.1.0 produce ERR_FILE_NOT_FOUND en fb2k-media.';
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

export default function MediaPlaybackProbe({ viewMode = 'playlist', diagnosticsOpen = false, onCloseDiagnostics }) {
    const videoRef = useRef(null);
    const diagnosticsDialogRef = useRef(null);
    const previousViewRef = useRef(viewMode);
    const previousTrackSourceRef = useRef('');
    const viewModeRef = useRef(viewMode);
    const inspectionRef = useRef(inspection);
    const startFollowingRef = useRef(null);
    const followerRef = useRef(null);
    const hostSubscriptionsRef = useRef([]);
    const followerErrorUnsubscribeRef = useRef(null);
    const requestIdRef = useRef(0);
    const mountedRef = useRef(false);

    const [environment, setEnvironment] = useState(null);
    const [inspection, setInspection] = useState(null);
    const [mediaDiagnostics, setMediaDiagnostics] = useState(null);
    const [status, setStatus] = useState('Comprobando conexión con WebView2…');
    const [lastEvent, setLastEvent] = useState('Sin eventos');
    const [videoTime, setVideoTime] = useState(0);
    const [isInspecting, setIsInspecting] = useState(false);
    const [isFollowing, setIsFollowing] = useState(false);
    const [isVideoVisible, setIsVideoVisible] = useState(false);
    const [embeddedArtwork, setEmbeddedArtwork] = useState(null);
    const [diagnosticLogs, setDiagnosticLogs] = useState(readDiagnosticLogs);
    const [copyFeedback, setCopyFeedback] = useState('');

    viewModeRef.current = viewMode;
    inspectionRef.current = inspection;

    useEffect(() => {
        const dialog = diagnosticsDialogRef.current;
        if (!dialog) return;

        if (diagnosticsOpen && !dialog.open) {
            dialog.showModal();
        } else if (!diagnosticsOpen && dialog.open) {
            dialog.close();
        }
    }, [diagnosticsOpen]);

    const addDiagnosticLog = useCallback((level, message) => {
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            message: sanitizeDiagnosticText(message)
        };
        setDiagnosticLogs((previous) => [...previous, entry].slice(-MAX_DIAGNOSTIC_LOGS));
    }, []);

    useEffect(() => {
        try {
            window.localStorage.setItem(DIAGNOSTIC_LOG_KEY, JSON.stringify(diagnosticLogs));
        } catch {
            // Diagnostics remain available for the current session if storage is unavailable.
        }
    }, [diagnosticLogs]);

    const clearHostSubscriptions = useCallback(() => {
        hostSubscriptionsRef.current.forEach((unsubscribe) => {
            try {
                unsubscribe();
            } catch {
                // Ignore stale SDK subscriptions during cleanup.
            }
        });
        hostSubscriptionsRef.current = [];
    }, []);

    const releaseFollowing = useCallback(() => {
        if (followerErrorUnsubscribeRef.current) {
            followerErrorUnsubscribeRef.current();
            followerErrorUnsubscribeRef.current = null;
        }

        if (followerRef.current) {
            followerRef.current.dispose();
            followerRef.current = null;
        }

        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.removeAttribute('src');
            videoRef.current.load();
        }

        if (mountedRef.current) {
            setIsFollowing(false);
            setIsVideoVisible(false);
            setVideoTime(0);
        }
    }, []);

    const stopFollowing = useCallback((
        updateStatus = true,
        message = 'Seguimiento detenido.'
    ) => {
        requestIdRef.current += 1;
        releaseFollowing();

        if (updateStatus && mountedRef.current) {
            setStatus(message);
            addDiagnosticLog('info', message);
        }
    }, [addDiagnosticLog, releaseFollowing]);

    const showAudioArtwork = useCallback(async (path, requestId) => {
        releaseFollowing();
        setEmbeddedArtwork(null);

        if (!path) return null;

        try {
            const cover = await inspectEmbeddedFrontCover(path);
            if (!mountedRef.current || requestId !== requestIdRef.current) return null;

            setEmbeddedArtwork(cover);
            if (cover.available) {
                setStatus('Pista de audio · Carátula incrustada disponible.');
                setLastEvent('Carátula incrustada del archivo cargada');
                addDiagnosticLog('info', 'Carátula frontal incrustada detectada · '
                    + (cover.mimeType || 'MIME desconocido') + ' · '
                    + (cover.size == null ? 'tamaño desconocido' : cover.size + ' bytes'));
            } else {
                setStatus('Pista de audio · El archivo no contiene una carátula frontal incrustada.');
                setLastEvent('Pista de audio sin carátula incrustada');
                addDiagnosticLog('info', 'No se encontró una carátula frontal incrustada en el archivo.');
            }
            return cover;
        } catch (error) {
            if (!mountedRef.current || requestId !== requestIdRef.current) return null;
            setEmbeddedArtwork({
                available: false,
                error: error.message || String(error)
            });
            setStatus('Pista de audio · No se pudo leer la carátula incrustada: '
                + (error.message || String(error)));
            setLastEvent('Error al leer la carátula incrustada');
            addDiagnosticLog('warning', 'No se pudo leer la carátula incrustada: '
                + (error.message || String(error)));
            return null;
        }
    }, [addDiagnosticLog, releaseFollowing]);

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
            addDiagnosticLog('info', result.hasTrack
                ? 'Pista detectada: ' + getMediaFileName(result.path || result.rawPath)
                    + ' · contenedor ' + (result.containerFormat || 'desconocido')
                    + ' · video ' + (result.videoTrack?.codec || 'no detectado')
                : 'Inspección completada: no hay una pista activa.');

            if (!result.hasTrack) {
                releaseFollowing();
                setEmbeddedArtwork(null);
                setStatus('foobar2000 no tiene una pista en reproducción.');
                setLastEvent('Inspección completada: sin pista activa');
                return;
            }

            if (!result.recognized) {
                if (isLikelyAudioFilePath(result.path)) {
                    await showAudioArtwork(result.path, requestId);
                    return;
                }

                releaseFollowing();
                setEmbeddedArtwork(null);
                setStatus('Archivo activo detectado, pero el contenedor no pertenece a MP4, MOV, Matroska o WebM.');
                setLastEvent('Contenedor no reconocido');
                addDiagnosticLog('warning', 'Se liberó la fuente anterior porque el nuevo contenedor no es compatible.');
                return;
            }

            if (!result.videoTrack) {
                if ((result.audioTracks?.length || 0) > 0 || isLikelyAudioFilePath(result.path)) {
                    await showAudioArtwork(result.path, requestId);
                } else {
                    releaseFollowing();
                    setEmbeddedArtwork(null);
                    setStatus('Pista activa detectada: ' + result.containerFormat + ', sin pista de video ni pista de audio.');
                    setLastEvent('Archivo multimedia sin video');
                }
                return;
            }

            setEmbeddedArtwork(null);
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
                    setIsVideoVisible(true);
                    setEmbeddedArtwork(null);
                    setStatus('Fuente de video actualizada y enlazada al reloj de foobar2000.');
                }
            }
        } catch (error) {
            if (!mountedRef.current || requestId !== requestIdRef.current) return;

            const message = error.message || String(error);
            const code = error.code ? ' [' + error.code + ']' : '';
            addDiagnosticLog('error', 'Falló ' + (error.operation || 'la inspección multimedia')
                + ': ' + message + code);
            const diagnostic = error.mediaContext
                ? {
                    ...error.mediaContext,
                    inspectionFailed: true,
                    inspectionError: message,
                    inspectionErrorCode: error.code || '',
                    inspectionStage: error.operation || error.mediaContext.inspectionStage
                }
                : null;
            setInspection(diagnostic);
            releaseFollowing();
            setEmbeddedArtwork(null);

            const failedPath = error.mediaContext?.path || error.mediaContext?.rawPath || '';
            if (isLikelyAudioFilePath(failedPath)) {
                await showAudioArtwork(failedPath, requestId);
                setLastEvent('Archivo de audio: inspección de video no aplicable');
                return;
            }

            if (error.code === 'ORIGIN_DENIED') {
                setStatus('El host rechazó el origen de esta página. Carga Vite desde Developer > Use development server o usa una plantilla de WebView2. ' + message + code);
            } else if (error.code === 'PERMISSION_DENIED' && message.includes('open (5)')) {
                setStatus('Windows rechazó la apertura del archivo (ERROR_ACCESS_DENIED, 5). La ruta pasó la validación MediaRead del host, pero media.getContainerInfo no pudo abrir el archivo para leer su contenedor. ' + message + code);
            } else {
                setStatus('No se pudo inspeccionar la pista: ' + message + code);
            }

            setLastEvent(error.operation
                ? 'Error en ' + error.operation
                : 'Error durante la inspección');
        } finally {
            if (mountedRef.current && requestId === requestIdRef.current) {
                setIsInspecting(false);
            }
        }
    }, [addDiagnosticLog, releaseFollowing, showAudioArtwork]);

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
            hostSubscriptionsRef.current.push(
                sdk.on('playback:trackChanged', () => {
                    setLastEvent('Cambio de pista recibido. Detectando el nuevo archivo…');
                    addDiagnosticLog('info', 'Evento foobar2000: playback:trackChanged');
                    void inspectCurrentTrack({ automatic: true });
                })
            );

            hostSubscriptionsRef.current.push(
                sdk.on('playback:seeked', (payload) => {
                    const seekMessage = 'Búsqueda de foobar2000: ' + formatTime(payload?.position);
                    setLastEvent(seekMessage);
                    addDiagnosticLog('info', seekMessage);
                })
            );

            hostSubscriptionsRef.current.push(
                sdk.on('playback:stateChanged', (payload) => {
                    const playbackState = String(payload?.state || '').toLowerCase();
                    const stateMessage = 'Estado de foobar2000: ' + (payload?.state || 'actualizado');
                    setLastEvent(stateMessage);
                    addDiagnosticLog('info', stateMessage);

                    if ((playbackState === 'stopped' || playbackState === 'stop')
                        && followerRef.current) {
                        stopFollowing(true, 'Reproducción detenida en foobar2000. El video se ocultó.');
                    } else if (playbackState === 'playing'
                        && viewModeRef.current === 'video'
                        && inspectionRef.current?.videoTrack
                        && !followerRef.current) {
                        void startFollowingRef.current?.();
                    }
                })
            );

            hostSubscriptionsRef.current.push(
                sdk.on('playback:stopped', () => {
                    if (!followerRef.current) return;
                    setLastEvent('foobar2000 detuvo la reproducción.');
                    stopFollowing(true, 'Reproducción detenida en foobar2000. El video se ocultó.');
                })
            );
        }

        inspectWebViewEnvironment()
            .then((result) => {
                if (!active || !mountedRef.current) return;
                setEnvironment(result);
                setStatus(getEnvironmentStatus(result));
                addDiagnosticLog(
                    result.mediaRouteSupported === false ? 'warning' : 'info',
                    'Entorno WebView2: componente ' + (result.pluginVersion || 'versión desconocida')
                        + ' · origen ' + result.origin
                        + ' · fuente ' + (result.source || 'desconocida')
                        + (result.mediaRouteSupported === false ? ' · se requiere 2.2.0 o posterior' : '')
                );

                if (result.hasHostBridge && result.isHttpOrigin
                    && result.hasPlaybackApi && result.hasMediaApi) {
                    void inspectCurrentTrack({ automatic: true });
                }
            })
            .catch((error) => {
                if (!active || !mountedRef.current) return;
                setStatus('No se pudo consultar el entorno: ' + (error.message || String(error)));
                addDiagnosticLog('error', 'No se pudo consultar el entorno: ' + (error.message || String(error)));
            });

        return () => {
            active = false;
            mountedRef.current = false;
            clearHostSubscriptions();
            stopFollowing(false);
        };
    }, [addDiagnosticLog, clearHostSubscriptions, inspectCurrentTrack, stopFollowing]);

    const startFollowing = useCallback(async () => {
        if (followerRef.current || !videoRef.current) return;

        setStatus('Iniciando MediaElementFollower…');
        addDiagnosticLog('info', 'Solicitud para iniciar MediaElementFollower.');

        try {
            const sdk = getMediaSdk();

            if (!environment?.hasHostBridge || !environment?.isHttpOrigin) {
                throw new Error('La página debe ejecutarse dentro del host desde un origen HTTP(S) confiable.');
            }

            if (environment.mediaRouteSupported !== true) {
                throw new Error(environment.mediaRouteSupported === false
                    ? 'foo_ui_webview2 ' + environment.pluginVersion
                        + ' usa una ruta multimedia incompatible con el mapeo de plantillas. Actualiza a 2.2.0 o posterior.'
                    : 'No se pudo confirmar la versión del componente nativo. Se requiere foo_ui_webview2 2.2.0 o posterior para iniciar streams.');
            }

            if (typeof sdk.MediaElementFollower !== 'function') {
                throw new Error('MediaElementFollower no está disponible en el SDK.');
            }

            const playback = unwrap(await sdk.player.getState(), 'player.getState');
            if (String(playback.state || '').toLowerCase() === 'stopped') {
                releaseFollowing();
                setStatus('foobar2000 está detenido. El video permanece oculto hasta que comience la reproducción.');
                return;
            }

            const result = await inspectCurrentMediaTrack();
            setInspection(result);
            inspectionRef.current = result;
            setEmbeddedArtwork(null);

            if (!result.hasTrack || !result.videoTrack) {
                throw new Error('La pista activa no contiene video.');
            }

            setMediaDiagnostics(null);
            setStatus('Comprobando compatibilidad del navegador y respuesta multimedia…');
            try {
                const diagnostics = await inspectVideoStream(result.sourcePath, result.tracks);
                setMediaDiagnostics(diagnostics);
                addDiagnosticLog(
                    diagnostics.streamError ? 'warning' : 'info',
                    'Diagnóstico de stream: HEAD=' + (diagnostics.headStatus ?? 'falló')
                        + ' · Range=' + (diagnostics.rangeStatus ?? 'falló')
                        + ' · MIME=' + diagnostics.streamMimeType
                );
            } catch (diagnosticError) {
                setMediaDiagnostics({
                    streamError: diagnosticError.message || String(diagnosticError)
                });
                addDiagnosticLog('error', 'No se pudo inspeccionar el stream: '
                    + (diagnosticError.message || String(diagnosticError)));
            }

            const follower = new sdk.MediaElementFollower(videoRef.current);
            followerRef.current = follower;

            followerErrorUnsubscribeRef.current = follower.onError((error) => {
                const elementState = describeVideoElement(videoRef.current);
                setStatus('Error del seguidor multimedia: ' + (error.message || String(error))
                    + ' · Estado del elemento: ' + elementState);
                setMediaDiagnostics((previous) => ({
                    ...(previous || {}),
                    elementError: elementState
                }));
                setLastEvent('MediaElementFollower informó un error');
                addDiagnosticLog('error', 'MediaElementFollower: ' + (error.message || String(error))
                    + ' · ' + elementState);
                releaseFollowing();
            });

            await follower.setSource(result.sourcePath, {
                timelineOffset: result.timelineOffset
            });

            if (!mountedRef.current || followerRef.current !== follower) {
                follower.dispose();
                return;
            }

            setIsFollowing(true);
            setIsVideoVisible(true);
            setEmbeddedArtwork(null);
            setStatus('Video enlazado al reloj de foobar2000. Prueba pausa, reanudación y búsqueda desde el reproductor.');
            setLastEvent('MediaElementFollower iniciado');
            addDiagnosticLog('info', 'MediaElementFollower inició correctamente.');
        } catch (error) {
            const message = error.message || String(error);
            const code = error.code ? ' [' + error.code + ']' : '';
            setStatus('No se pudo iniciar el seguimiento: ' + message + code);
            addDiagnosticLog('error', 'No se pudo iniciar el seguimiento: ' + message + code);

            releaseFollowing();
        }
    }, [addDiagnosticLog, environment, releaseFollowing]);

    startFollowingRef.current = startFollowing;

    const handleVideoError = useCallback((event) => {
        const message = describeMediaError(event.currentTarget);
        const elementState = describeVideoElement(event.currentTarget);
        setStatus('El elemento de video no pudo reproducir la fuente: ' + message);
        setIsVideoVisible(false);
        setLastEvent('HTMLVideoElement error');
        addDiagnosticLog('error', 'HTMLVideoElement: ' + message + ' · ' + elementState);
        releaseFollowing();
    }, [addDiagnosticLog, releaseFollowing]);

    const handleVideoMetadata = useCallback(() => {
        setLastEvent('Metadata de video cargada');
        addDiagnosticLog('info', 'HTMLVideoElement cargó metadata del video.');
    }, [addDiagnosticLog]);

    const handleVideoPlaying = useCallback(() => {
        setLastEvent('El elemento de video está reproduciendo');
        addDiagnosticLog('info', 'HTMLVideoElement comenzó la reproducción.');
    }, [addDiagnosticLog]);

    const copyDiagnosticReport = useCallback(async () => {
        const video = videoRef.current;
        const report = {
            application: 'CrayonShell',
            reportVersion: 1,
            capturedAt: new Date().toISOString(),
            runtime: {
                pageOrigin: environment?.origin || window.location.origin,
                pageProtocol: environment?.protocol || window.location.protocol,
                pageSource: environment?.source || '',
                pageSourceUrl: environment?.sourceUrl || '',
                templateName: environment?.templateName || environment?.activeTemplateName || '',
                nativeComponent: environment?.pluginVersion || 'unknown',
                mediaRouteSupported: environment?.mediaRouteSupported ?? null,
                versionQueryError: sanitizeDiagnosticText(environment?.versionError || ''),
                hostBridgeAvailable: environment?.hasHostBridge ?? null,
                sdkFacadeAvailable: environment?.hasSdkFacade ?? null,
                playbackApiAvailable: environment?.hasPlaybackApi ?? null,
                mediaApiAvailable: environment?.hasMediaApi ?? null,
                artworkApiAvailable: environment?.hasArtworkApi ?? null,
                mediaElementFollowerAvailable: environment?.hasMediaElementFollower ?? null,
                sdkPackage: 'foo-webview-sdk ^2.2.0',
                userAgent: navigator.userAgent,
                platform: navigator.platform,
                language: navigator.language
            },
            state: {
                status: sanitizeDiagnosticText(status),
                lastEvent: sanitizeDiagnosticText(lastEvent),
                isInspecting,
                isFollowing,
                isVideoVisible,
                videoTime,
                videoElement: getVideoElementDiagnostics(video)
            },
            track: getTrackDiagnostics(inspection),
            embeddedArtwork: embeddedArtwork ? {
                available: Boolean(embeddedArtwork.available),
                type: embeddedArtwork.type || 'front',
                mimeType: embeddedArtwork.mimeType || '',
                size: embeddedArtwork.size ?? null,
                error: sanitizeDiagnosticText(embeddedArtwork.error || '')
            } : null,
            stream: mediaDiagnostics || null,
            eventLog: diagnosticLogs
        };
        const reportText = 'CrayonShell — informe de diagnóstico multimedia\n'
            + JSON.stringify(report, null, 2);

        try {
            await copyTextToClipboard(reportText);
            setCopyFeedback('Informe copiado al portapapeles.');
            addDiagnosticLog('info', 'Informe técnico copiado al portapapeles.');
        } catch (error) {
            setCopyFeedback('No se pudo copiar: ' + (error.message || String(error)));
            addDiagnosticLog('error', 'No se pudo copiar el informe: ' + (error.message || String(error)));
        }
    }, [
        addDiagnosticLog, diagnosticLogs, embeddedArtwork, environment, inspection,
        isFollowing, isInspecting, isVideoVisible, lastEvent, mediaDiagnostics, status, videoTime
    ]);

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
        && environment?.mediaRouteSupported === true
        && inspection?.videoTrack
    );

    useEffect(() => {
        const viewChanged = previousViewRef.current !== viewMode;
        const sourcePath = inspection?.sourcePath || '';
        const trackChanged = previousTrackSourceRef.current !== sourcePath;

        previousViewRef.current = viewMode;
        previousTrackSourceRef.current = sourcePath;

        if (viewMode === 'video'
            && (viewChanged || trackChanged)
            && inspection?.videoTrack
            && !isFollowing
            && !isInspecting) {
            void startFollowing();
        }
    }, [
        viewMode, inspection?.sourcePath, inspection?.videoTrack,
        isFollowing, isInspecting, startFollowing
    ]);

    return (
        <>
            <section
                className={'media-viewer' + (viewMode === 'video' ? '' : ' is-hidden')}
                aria-label="Visor de video"
                aria-hidden={viewMode !== 'video'}
            >
                <video
                    ref={videoRef}
                    className={'media-viewer-video' + (isVideoVisible ? '' : ' is-hidden')}
                    muted
                    crossOrigin="anonymous"
                    playsInline
                    preload="metadata"
                    onTimeUpdate={(event) => setVideoTime(event.currentTarget.currentTime)}
                    onLoadedMetadata={handleVideoMetadata}
                    onPlaying={handleVideoPlaying}
                    onError={handleVideoError}
                />
                {!inspection?.videoTrack && embeddedArtwork?.available && (
                    <img
                        className="media-viewer-artwork"
                        src={embeddedArtwork.dataUrl}
                        alt="Carátula incrustada del archivo de audio"
                    />
                )}
                {!isVideoVisible && !embeddedArtwork?.available && (
                    <div className="media-viewer-placeholder">
                        {inspection?.videoTrack
                            ? status
                            : inspection?.hasTrack
                                ? status
                                : 'No hay video activo. Reproduce un video en foobar2000.'}
                    </div>
                )}
                {isVideoVisible && inspection?.videoTrack && isFollowing && (
                    <div className="media-viewer-time">
                        {formatTime(videoTime)}
                        {videoRef.current?.duration && Number.isFinite(videoRef.current.duration)
                            ? ' / ' + formatTime(videoRef.current.duration)
                            : ''}
                    </div>
                )}
            </section>

            <dialog
                ref={diagnosticsDialogRef}
                className="media-probe-dialog"
                aria-labelledby="MediaProbeDialogTitle"
                onCancel={(event) => {
                    event.preventDefault();
                    onCloseDiagnostics?.();
                }}
                onClose={() => onCloseDiagnostics?.()}
                onClick={(event) => {
                    if (event.target === event.currentTarget) {
                        onCloseDiagnostics?.();
                    }
                }}
            >
                <div className="media-probe-dialog-inner">
                    <section className="media-probe" aria-label="Diagnóstico multimedia">
                        <div className="media-probe-heading">
                            <div>
                                <strong id="MediaProbeDialogTitle">Diagnóstico multimedia</strong>
                                <span>Información técnica, historial de eventos y herramientas para reportar fallos.</span>
                            </div>
                            <span className={isFollowing ? 'media-probe-state is-active' : 'media-probe-state'}>
                                {isFollowing ? 'Siguiendo reproducción' : 'Seguimiento detenido'}
                            </span>
                            <button
                                className="media-probe-close"
                                type="button"
                                aria-label="Cerrar diagnóstico"
                                title="Cerrar"
                                onClick={() => onCloseDiagnostics?.()}
                            >
                                ×
                            </button>
                        </div>

                        <div className="media-probe-content">
                            <div className="media-probe-details">
                                <div className="media-probe-status">{status}</div>
                                <div><b>Origen:</b> {environment?.origin || 'Consultando…'}</div>
                                <div><b>Puente nativo:</b> {environment
                                    ? (environment.hasHostBridge ? 'Conectado' : 'No conectado')
                                    : 'Consultando…'}</div>
                                <div><b>SDK tipado:</b> {environment
                                    ? (environment.hasSdkFacade ? 'Enlazado al puente' : 'No disponible')
                                    : 'Consultando…'}</div>
                                <div><b>Componente nativo:</b> {environment?.pluginVersion || 'Versión no identificada'}
                                    {environment?.mediaRouteSupported === false
                                        ? ' · Requiere 2.2.0 o posterior para resolver streams multimedia'
                                        : environment?.mediaRouteSupported === true
                                            ? ' · Enrutamiento multimedia compatible'
                                            : environment
                                                ? ' · No se pudo verificar la compatibilidad multimedia del host'
                                                : ''}
                                </div>
                                <div><b>Origen de la página:</b> {environment?.source || '—'}
                                    {environment?.templateName || environment?.activeTemplateName
                                        ? ' · Plantilla: ' + (environment.templateName || environment.activeTemplateName)
                                        : ''}
                                </div>
                                {environment?.sourceUrl && (
                                    <div><b>URL reportada por WebView2:</b> {environment.sourceUrl}</div>
                                )}
                                <div><b>Media API:</b> {environment
                                    ? (environment.hasMediaApi ? 'Disponible' : 'No disponible')
                                        + ' · '
                                        + (environment.hasMediaElementFollower ? 'MediaElementFollower disponible' : 'MediaElementFollower no disponible')
                                    : '—'}</div>
                                <div><b>Archivo activo:</b> {inspection?.path || inspection?.rawPath || 'Sin archivo detectado'}</div>
                                {inspection?.rawPath && inspection.rawPath !== inspection.path && (
                                    <div><b>Ruta original:</b> {inspection.rawPath}</div>
                                )}
                                {inspection?.pathType && (
                                    <div><b>Tipo de ruta:</b> {inspection.pathType}</div>
                                )}
                                <div><b>Contenedor:</b> {inspection?.containerFormat || '—'}
                                    {inspection?.recognized === false ? ' · No reconocido' : ''}
                                </div>
                                <div><b>Pista de video:</b> {inspection?.videoTrack
                                    ? [
                                        inspection.videoTrack.codec || 'Códec desconocido',
                                        inspection.videoTrack.codecs || '',
                                        inspection.videoTrack.width && inspection.videoTrack.height
                                            ? inspection.videoTrack.width + '×' + inspection.videoTrack.height
                                            : '',
                                        inspection.videoTrack.frameRate
                                            ? inspection.videoTrack.frameRate + ' fps'
                                            : '',
                                        inspection.videoTrack.mimeType || ''
                                    ].filter(Boolean).join(' · ')
                                    : inspection?.inspectionFailed
                                        ? 'No evaluada: falló la apertura del contenedor'
                                        : 'No detectada'}</div>
                                <div><b>Pistas de audio:</b> {inspection?.audioTracks?.length
                                    ? inspection.audioTracks.map((track) => [
                                        track.codec || 'Códec desconocido',
                                        track.codecs || '',
                                        track.channels ? track.channels + ' canales' : '',
                                        track.sampleRate ? (track.sampleRate / 1000) + ' kHz' : '',
                                        track.mimeType || ''
                                    ].filter(Boolean).join(' · ')).join(' | ')
                                    : 'Ninguna declarada'}</div>
                                {embeddedArtwork && (
                                    <div><b>Carátula frontal incrustada:</b> {embeddedArtwork.available
                                        ? 'Encontrada · ' + (embeddedArtwork.mimeType || 'MIME desconocido')
                                            + ' · ' + (embeddedArtwork.size == null
                                                ? 'tamaño desconocido'
                                                : embeddedArtwork.size + ' bytes')
                                        : embeddedArtwork.error
                                            ? 'No disponible · ' + embeddedArtwork.error
                                            : 'No encontrada en el archivo'}</div>
                                )}
                                <div><b>Artwork API:</b> {environment
                                    ? (environment.hasArtworkApi ? 'Disponible' : 'No disponible')
                                    : 'Consultando…'}</div>
                                {mediaDiagnostics && (
                                    <>
                                        {mediaDiagnostics.trackCapabilities?.map((track, index) => (
                                            <div key={track.type + '-' + index}>
                                                <b>Compatibilidad {track.type} ({track.codecs || track.codec}):</b>
                                                canPlayType={formatSupport(track.canPlayType)}
                                                {' · '}MediaCapabilities={formatSupport(track.supported)}
                                                {' · '}Suavidad={formatSupport(track.smooth)}
                                            </div>
                                        ))}
                                        {mediaDiagnostics.capabilityError && (
                                            <div><b>Compatibilidad:</b> {mediaDiagnostics.capabilityError}</div>
                                        )}
                                        <div><b>Stream:</b> MIME={mediaDiagnostics.streamMimeType || '—'}
                                            {' · '}Tamaño={mediaDiagnostics.size == null
                                                ? '—'
                                                : (mediaDiagnostics.size / (1024 * 1024)).toFixed(2) + ' MiB'}
                                        </div>
                                        <div><b>Ruta virtual:</b> {mediaDiagnostics.streamUrlProtocol || '—'}//{mediaDiagnostics.streamUrlOrigin?.replace(/^https?:\/\//, '') || '—'}
                                            {mediaDiagnostics.streamUrlPath || ''}
                                            {' · '}Origen de documento={mediaDiagnostics.pageOrigin || '—'}
                                        </div>
                                        <div><b>Respuesta HTTP:</b> HEAD={mediaDiagnostics.headStatus ?? '—'}
                                            {' · '}Range={mediaDiagnostics.rangeStatus ?? '—'}
                                            {mediaDiagnostics.responseMimeType ? ' · ' + mediaDiagnostics.responseMimeType : ''}
                                        </div>
                                        {mediaDiagnostics.contentRange && (
                                            <div><b>Content-Range:</b> {mediaDiagnostics.contentRange}</div>
                                        )}
                                        {mediaDiagnostics.signature && (
                                            <div><b>Firma inicial:</b> {mediaDiagnostics.signature}</div>
                                        )}
                                        {mediaDiagnostics.streamError && (
                                            <div><b>Diagnóstico de stream:</b> {mediaDiagnostics.streamError}</div>
                                        )}
                                        {mediaDiagnostics.elementError && (
                                            <div><b>Estado HTMLVideoElement:</b> {mediaDiagnostics.elementError}</div>
                                        )}
                                    </>
                                )}
                                {inspection?.inspectionStage && (
                                    <div><b>Etapa de error:</b> {inspection.inspectionStage}</div>
                                )}
                                {inspection?.inspectionErrorCode && (
                                    <div><b>Código de error:</b> {inspection.inspectionErrorCode}</div>
                                )}
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
                            <button
                                type="button"
                                onClick={copyDiagnosticReport}
                            >
                                Copiar informe técnico
                            </button>
                            {copyFeedback && <span className="media-probe-copy-feedback">{copyFeedback}</span>}
                        </div>

                        <details className="media-probe-log" open>
                            <summary>Registro de eventos guardado ({diagnosticLogs.length})</summary>
                            <div className="media-probe-log-list">
                                {diagnosticLogs.length === 0
                                    ? <div className="media-probe-log-empty">Los eventos aparecerán aquí y se conservarán entre recargas.</div>
                                    : [...diagnosticLogs].reverse().map((entry, index) => (
                                        <div className={'media-probe-log-entry is-' + entry.level} key={entry.timestamp + '-' + index}>
                                            <time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleString()}</time>
                                            <span>{entry.message}</span>
                                        </div>
                                    ))}
                            </div>
                        </details>
                    </section>
                </div>
            </dialog>
        </>
    );
}