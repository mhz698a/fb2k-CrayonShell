import fb from 'foo-webview-sdk';

function hasNativeBridge() {
    return typeof window !== 'undefined'
        && window.fb2k
        && typeof window.fb2k.invoke === 'function';
}

function getSdk() {
    if (!hasNativeBridge()) {
        throw new Error('No se encontró window.fb2k.invoke. La página no está conectada a foo_ui_webview2.');
    }

    if (!fb.isAvailable()) {
        throw new Error('El SDK foo-webview-sdk no detecta un puente nativo disponible.');
    }

    return fb;
}

function unwrap(response, operation) {
    if (!response) {
        const error = new Error(operation + ' no devolvió una respuesta.');
        error.operation = operation;
        throw error;
    }

    if (response.success === false) {
        const code = response.code || 'UNKNOWN_ERROR';
        const error = new Error((response.error || operation + ' falló') + ' [' + code + ']');
        error.code = code;
        error.details = response.details;
        error.operation = operation;
        throw error;
    }

    return response;
}

function classifyMediaPath(path) {
    if (/^file-relative:\/\//i.test(path)) return 'file-relative://';
    if (/^file:\/\//i.test(path)) return 'file://';
    if (/^unpack:\/\//i.test(path)) return 'unpack://';
    if (/^archive:\/\//i.test(path)) return 'archive://';
    if (/^(https?|ftp|mms|rtsp):\/\//i.test(path)) return 'Ruta de red';
    if (/^[a-z]:[\\/]/i.test(path) || /^\\\\/.test(path)) return 'Ruta local o UNC';
    return 'Ruta virtual o no identificada';
}

function normalizeTrackPath(path, position) {
    const suffix = String(path).match(/^(.*)\|subsong:(\d+)$/i);
    const basePath = suffix ? suffix[1] : String(path);
    const reportedSubsong = position.subsong === undefined || position.subsong === null
        ? NaN
        : Number(position.subsong);
    const suffixSubsong = suffix ? Number(suffix[2]) : NaN;

    return {
        path: basePath,
        subsong: Number.isInteger(reportedSubsong) && reportedSubsong >= 0
            ? reportedSubsong
            : Number.isInteger(suffixSubsong) && suffixSubsong >= 0
                ? suffixSubsong
                : 0
    };
}

export function getMediaSdk() {
    return getSdk();
}

export async function inspectWebViewEnvironment() {
    const origin = window.location.origin;
    const protocol = window.location.protocol;
    const nativeBridgeAvailable = Boolean(hasNativeBridge());

    if (!nativeBridgeAvailable) {
        return {
            hasHostBridge: false,
            hasSdkFacade: false,
            origin,
            protocol,
            isHttpOrigin: protocol === 'http:' || protocol === 'https:',
            isFileOrigin: protocol === 'file:',
            source: 'Navegador externo',
            sourceError: 'No existe window.fb2k. Abre Vite desde WebView2 UI > Developer, no desde Chrome o Edge.'
        };
    }

    const sdkAvailable = Boolean(fb.isAvailable());
    if (!sdkAvailable) {
        return {
            hasHostBridge: true,
            hasSdkFacade: false,
            origin,
            protocol,
            isHttpOrigin: protocol === 'http:' || protocol === 'https:',
            isFileOrigin: protocol === 'file:',
            source: 'Puente nativo detectado',
            sourceError: 'window.fb2k está disponible, pero el SDK importado no pudo enlazarse con el puente.'
        };
    }

    let sourceInfo = null;
    let sourceError = '';

    try {
        sourceInfo = unwrap(
            await fb.webview.getSource(),
            'webview.getSource'
        );
    } catch (error) {
        sourceError = error.message || String(error);
    }

    return {
        hasHostBridge: true,
        hasSdkFacade: true,
        origin,
        protocol,
        isHttpOrigin: protocol === 'http:' || protocol === 'https:',
        isFileOrigin: protocol === 'file:',
        source: sourceInfo?.source || 'No disponible',
        directory: sourceInfo?.directory || '',
        templateName: sourceInfo?.templateName || '',
        activeTemplateName: sourceInfo?.activeTemplateName || '',
        sourceUrl: sourceInfo?.url || '',
        hasMediaApi: Boolean(
            fb.media
            && typeof fb.media.getContainerInfo === 'function'
            && typeof fb.media.getStreamUrl === 'function'
        ),
        hasMediaElementFollower: typeof fb.MediaElementFollower === 'function',
        hasPlaybackApi: Boolean(
            fb.player
            && typeof fb.player.getPosition === 'function'
            && typeof fb.player.getState === 'function'
        ),
        sourceError
    };
}

export async function inspectCurrentMediaTrack() {
    const sdk = getSdk();

    if (!sdk.player || typeof sdk.player.getPosition !== 'function') {
        throw new Error('El SDK importado no expone fb.player.getPosition().');
    }

    if (!sdk.media || typeof sdk.media.getContainerInfo !== 'function') {
        throw new Error('El SDK importado no expone fb.media.getContainerInfo().');
    }

    let position;
    try {
        position = unwrap(
            await sdk.player.getPosition(),
            'player.getPosition'
        );
    } catch (error) {
        error.operation = error.operation || 'player.getPosition';
        throw error;
    }

    const rawPath = typeof position.path === 'string' ? position.path : '';

    if (!rawPath) {
        return {
            hasTrack: false,
            position: Number(position.position) || 0,
            duration: Number(position.duration) || 0
        };
    }

    const normalized = normalizeTrackPath(rawPath, position);
    const mediaContext = {
        hasTrack: true,
        rawPath,
        path: normalized.path,
        pathType: classifyMediaPath(normalized.path),
        subsong: normalized.subsong,
        position: Number(position.position) || 0,
        duration: Number(position.duration) || 0,
        inspectionStage: 'media.getContainerInfo'
    };

    let container;
    try {
        container = unwrap(
            await sdk.media.getContainerInfo(normalized.path),
            'media.getContainerInfo'
        );
    } catch (error) {
        error.operation = error.operation || 'media.getContainerInfo';
        error.mediaContext = mediaContext;
        throw error;
    }

    const tracks = Array.isArray(container.tracks) ? container.tracks : [];
    const videoTrack = tracks.find((track) => track.type === 'video') || null;
    const audioTracks = tracks.filter((track) => track.type === 'audio');

    const chapter = Array.isArray(container.chapters)
        ? container.chapters.find(
            (item) => Number(item.subsong) === normalized.subsong
        ) || null
        : null;

    return {
        hasTrack: true,
        rawPath,
        path: normalized.path,
        pathType: classifyMediaPath(normalized.path),
        subsong: normalized.subsong,
        position: Number(position.position) || 0,
        duration: Number(position.duration) || 0,
        recognized: Boolean(container.recognized),
        containerFormat: container.container || 'Desconocido',
        videoTrack,
        audioTracks,
        tracks,
        trackCount: tracks.length,
        chapter,
        sourcePath: chapter
            ? normalized.path + '|subsong:' + normalized.subsong
            : normalized.path,
        timelineOffset: Number.isFinite(Number(chapter?.start))
            ? Number(chapter.start)
            : 0
    };
}

export async function inspectVideoStream(path, tracks) {
    const sdk = getSdk();
    const mediaTracks = Array.isArray(tracks) ? tracks : [tracks];
    const diagnostics = {
        trackCapabilities: [],
        pageOrigin: window.location.origin,
        streamMimeType: 'Desconocido',
        size: null,
        streamUrlOrigin: '',
        streamUrlProtocol: '',
        streamUrlPath: '',
        headStatus: null,
        rangeStatus: null,
        contentRange: '',
        signature: '',
        streamError: ''
    };

    const canPlay = typeof sdk.media?.canPlay === 'function'
        ? sdk.media.canPlay.bind(sdk.media)
        : typeof sdk.canPlay === 'function'
            ? sdk.canPlay.bind(sdk)
            : null;

    if (canPlay) {
        for (const track of mediaTracks.filter((item) => item && (item.type === 'video' || item.type === 'audio'))) {
            const entry = {
                type: track.type,
                codec: track.codec || 'Códec desconocido',
                codecs: track.codecs || '',
                mimeType: track.mimeType || 'Desconocido',
                canPlayType: 'unknown',
                supported: 'unknown',
                smooth: 'unknown',
                powerEfficient: 'unknown'
            };
            try {
                const capability = await canPlay(track);
                entry.canPlayType = capability.canPlayType ?? 'unknown';
                entry.supported = capability.supported ?? 'unknown';
                entry.smooth = capability.smooth ?? 'unknown';
                entry.powerEfficient = capability.powerEfficient ?? 'unknown';
            } catch (error) {
                entry.error = error.message || String(error);
            }
            diagnostics.trackCapabilities.push(entry);
        }
    } else {
        diagnostics.capabilityError = 'La función canPlay no está disponible en esta versión del SDK.';
    }

    const stream = unwrap(
        await sdk.media.getStreamUrl(path),
        'media.getStreamUrl'
    );
    diagnostics.streamMimeType = stream.mimeType || 'Desconocido';
    diagnostics.size = Number.isFinite(Number(stream.size)) ? Number(stream.size) : null;

    try {
        const streamUrl = new URL(stream.url, window.location.href);
        diagnostics.streamUrlOrigin = streamUrl.origin;
        diagnostics.streamUrlProtocol = streamUrl.protocol;
        // Keep the opaque document-bound token out of the visible diagnostics.
        diagnostics.streamUrlPath = streamUrl.pathname.replace(/\/[^/]+$/, '/[token]');
    } catch (error) {
        diagnostics.streamUrlError = error.message || String(error);
    }

    try {
        const head = await fetch(stream.url, {
            method: 'HEAD',
            mode: 'cors',
            credentials: 'omit',
            cache: 'no-store'
        });
        diagnostics.headStatus = head.status;
        diagnostics.responseMimeType = head.headers.get('Content-Type') || '';
        diagnostics.contentLength = head.headers.get('Content-Length') || '';
        diagnostics.acceptRanges = head.headers.get('Accept-Ranges') || '';
    } catch (error) {
        diagnostics.headErrorName = error.name || 'Error';
        diagnostics.streamError = 'HEAD: ' + (error.name ? error.name + ': ' : '')
            + (error.message || String(error));
    }

    try {
        const range = await fetch(stream.url, {
            headers: { Range: 'bytes=0-15' },
            mode: 'cors',
            credentials: 'omit',
            cache: 'no-store'
        });
        diagnostics.rangeStatus = range.status;
        diagnostics.contentRange = range.headers.get('Content-Range') || '';
        if (range.status === 206) {
            const bytes = new Uint8Array(await range.arrayBuffer());
            diagnostics.signature = Array.from(bytes.slice(0, 16))
                .map((value) => value.toString(16).padStart(2, '0'))
                .join(' ');
        } else {
            // A server that ignores Range may return the whole video; never buffer it.
            await range.body?.cancel();
        }
    } catch (error) {
        diagnostics.rangeErrorName = error.name || 'Error';
        diagnostics.streamError = [
            diagnostics.streamError,
            'Range: ' + (error.name ? error.name + ': ' : '') + (error.message || String(error))
        ].filter(Boolean).join(' · ');
    }

    return diagnostics;
}
