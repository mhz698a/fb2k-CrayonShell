function decodePath(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function splitSubsongSuffix(value) {
    const match = value.match(/\|subsong:(\d+)$/i);
    return match
        ? { path: value.slice(0, match.index), subsong: Number(match[1]) }
        : { path: value, subsong: null };
}

/**
 * Normalize local track paths for identity matching across Windows paths and file URLs.
 * The optional subsong suffix is preserved separately so cue/subsong entries are not
 * accidentally treated as different files when only one side exposes that metadata.
 */
export function normalizeTrackPath(value) {
    let path = String(value || '').trim();
    if (!path) return { path: '', subsong: null };

    if (/^file:\/\//i.test(path)) {
        path = decodePath(path.slice(7));

        if (/^\/[a-z]:[\\/]/i.test(path)) {
            path = path.slice(1);
        } else if (!path.startsWith('/') && !/^[a-z]:[\\/]/i.test(path)) {
            path = '\\\\' + path;
        }
    } else {
        path = decodePath(path);
    }

    path = path.replace(/\//g, '\\');
    if (path.startsWith('\\\\')) {
        path = '\\\\' + path.slice(2).replace(/\\{2,}/g, '\\');
    } else {
        path = path.replace(/\\{2,}/g, '\\');
    }

    const split = splitSubsongSuffix(path);
    return {
        path: split.path.replace(/\\+$/, '').toLocaleLowerCase('en-US'),
        subsong: split.subsong
    };
}

export function trackPathsMatch(left, right) {
    const normalizedLeft = normalizeTrackPath(left);
    const normalizedRight = normalizeTrackPath(right);

    if (!normalizedLeft.path || normalizedLeft.path !== normalizedRight.path) return false;
    if (normalizedLeft.subsong !== null && normalizedRight.subsong !== null) {
        return normalizedLeft.subsong === normalizedRight.subsong;
    }
    return true;
}

function getTrackPath(track) {
    return String(track?.absolutePath || track?.path || '');
}

/**
 * Resolve the row representing the actual playing track.
 * A native playlist index is the most precise identity when it belongs to the
 * active playlist; handle and normalized path provide the cross-playlist fallback.
 */
export function resolvePlayingTrackIndex({
    items = [],
    playingTrackIndex = null,
    currentTrackResponse = null,
    activePlaylistGuid = '',
    playbackState = 'stopped'
} = {}) {
    if (playbackState === 'stopped') return -1;

    if (
        playingTrackIndex?.found === true
        && playingTrackIndex.playlistGuid === activePlaylistGuid
        && playingTrackIndex.index !== null
        && playingTrackIndex.index !== undefined
        && playingTrackIndex.index !== ''
        && Number.isInteger(Number(playingTrackIndex.index))
    ) {
        const indexedItem = items.find((item) => item.index === Number(playingTrackIndex.index));
        if (indexedItem) return indexedItem.index;
    }

    const currentTrack = currentTrackResponse?.track
        || currentTrackResponse?.currentTrack
        || (currentTrackResponse && currentTrackResponse.found === true ? currentTrackResponse : null);

    if (!currentTrack) return -1;

    const currentHandle = currentTrack.handle === null || currentTrack.handle === undefined
        ? ''
        : String(currentTrack.handle);
    if (currentHandle) {
        const handleMatch = items.find((item) => item.handle && String(item.handle) === currentHandle);
        if (handleMatch) return handleMatch.index;
    }

    const currentPath = getTrackPath(currentTrack);
    if (!currentPath) return -1;

    const pathMatch = items.find((item) =>
        trackPathsMatch(item.absolutePath || item.path, currentPath)
    );
    return pathMatch ? pathMatch.index : -1;
}
