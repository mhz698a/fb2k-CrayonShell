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

    const videoTrack = Array.isArray(container.tracks)
        ? container.tracks.find((track) => track.type === 'video') || null
        : null;

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
        trackCount: Array.isArray(container.tracks) ? container.tracks.length : 0,
        chapter,
        sourcePath: chapter
            ? normalized.path + '|subsong:' + normalized.subsong
            : normalized.path,
        timelineOffset: Number.isFinite(Number(chapter?.start))
            ? Number(chapter.start)
            : 0
    };
}
