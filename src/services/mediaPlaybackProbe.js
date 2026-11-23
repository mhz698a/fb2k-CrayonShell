function getSdk() {
    if (typeof window === 'undefined' || !window.fb) {
        throw new Error('No se encontró el SDK fb de foo_ui_webview2.');
    }

    return window.fb;
}

function unwrap(response, operation) {
    if (!response) {
        throw new Error(operation + ' no devolvió una respuesta.');
    }

    if (response.success === false) {
        const code = response.code ? ' (' + response.code + ')' : '';
        throw new Error((response.error || operation + ' falló') + code);
    }

    return response;
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
                : null
    };
}

export function getMediaSdk() {
    return getSdk();
}

export async function inspectWebViewEnvironment() {
    const sdk = getSdk();
    const origin = window.location.origin;
    const protocol = window.location.protocol;
    let source = null;
    let sourceError = '';

    if (sdk.webview && typeof sdk.webview.getSource === 'function') {
        try {
            source = unwrap(
                await sdk.webview.getSource(),
                'webview.getSource'
            );
        } catch (error) {
            sourceError = error.message || String(error);
        }
    } else {
        sourceError = 'El SDK no expone webview.getSource().';
    }

    return {
        origin,
        protocol,
        isHttpOrigin: protocol === 'http:' || protocol === 'https:',
        source: source?.source || 'No disponible',
        directory: source?.directory || '',
        templateName: source?.templateName || '',
        hasMediaApi: Boolean(
            sdk.media
            && typeof sdk.media.getContainerInfo === 'function'
            && typeof sdk.media.getStreamUrl === 'function'
        ),
        hasMediaElementFollower: typeof sdk.MediaElementFollower === 'function',
        hasPlaybackApi: Boolean(
            sdk.player
            && typeof sdk.player.getPosition === 'function'
            && typeof sdk.player.getState === 'function'
        ),
        sourceError
    };
}

export async function inspectCurrentMediaTrack() {
    const sdk = getSdk();

    if (!sdk.player || typeof sdk.player.getPosition !== 'function') {
        throw new Error('El SDK no expone fb.player.getPosition().');
    }

    if (!sdk.media || typeof sdk.media.getContainerInfo !== 'function') {
        throw new Error('El SDK no expone fb.media.getContainerInfo().');
    }

    const position = unwrap(
        await sdk.player.getPosition(),
        'player.getPosition'
    );
    const rawPath = typeof position.path === 'string' ? position.path : '';

    if (!rawPath) {
        return {
            hasTrack: false,
            position: Number(position.position) || 0,
            duration: Number(position.duration) || 0
        };
    }

    const normalized = normalizeTrackPath(rawPath, position);
    const container = unwrap(
        await sdk.media.getContainerInfo(normalized.path),
        'media.getContainerInfo'
    );

    const videoTrack = Array.isArray(container.tracks)
        ? container.tracks.find((track) => track.type === 'video') || null
        : null;

    let capabilities = null;
    let capabilityError = '';

    if (videoTrack && typeof sdk.media.canPlay === 'function') {
        try {
            capabilities = await sdk.media.canPlay(videoTrack);
            if (capabilities?.success === false) {
                capabilityError = capabilities.error || 'La consulta de capacidades falló.';
                capabilities = null;
            }
        } catch (error) {
            capabilityError = error.message || String(error);
        }
    }

    const chapter = normalized.subsong === null
        ? null
        : (Array.isArray(container.chapters)
            ? container.chapters.find(
                (item) => Number(item.subsong) === normalized.subsong
            ) || null
            : null);

    return {
        hasTrack: true,
        path: normalized.path,
        subsong: normalized.subsong,
        position: Number(position.position) || 0,
        duration: Number(position.duration) || 0,
        recognized: Boolean(container.recognized),
        containerFormat: container.container || 'Desconocido',
        videoTrack,
        capabilities,
        capabilityError,
        chapter,
        sourcePath: chapter
            ? normalized.path + '|subsong:' + normalized.subsong
            : normalized.path,
        timelineOffset: Number.isFinite(Number(chapter?.start))
            ? Number(chapter.start)
            : 0
    };
}
