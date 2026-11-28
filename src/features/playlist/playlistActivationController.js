function normalizeGuid(value) {
    return String(value || '')
        .trim()
        .replace(/[{}]/g, '')
        .toLocaleUpperCase('en-US');
}

function normalizeIndex(value, items) {
    const index = Number(value);
    if (!Number.isInteger(index) || index < 0) return -1;
    return items.some((item) => Number(item.index) === index) ? index : -1;
}

/**
 * Resolve activation from the SDK's two independent coordinates:
 * the active playlist GUID and the playing track's source playlist GUID/index.
 * No path/handle fallback is used here: a similar track in another playlist
 * must never be mistaken for the original playing row.
 */
export function resolvePlaylistActivationSnapshot({
    requestedPlaylistGuid = '',
    activePlaylist = null,
    playingLocation = null,
    playingPlaylist = null,
    playback = null,
    nativeFocus = null,
    items = []
} = {}) {
    const requestedGuid = normalizeGuid(requestedPlaylistGuid);
    const activeGuid = normalizeGuid(activePlaylist?.guid);
    const activeMatches = Boolean(requestedGuid && activeGuid === requestedGuid);

    let playingGuid = String(playingLocation?.playlistGuid || '');
    if (
        !playingGuid
        && playingLocation?.found === true
        && playingPlaylist?.found === true
        && Number(playingLocation.playlist) === Number(playingPlaylist.index)
    ) {
        playingGuid = String(playingPlaylist.guid || '');
    }

    const locatedTrackIndex = (
        playingLocation?.found === true
        && normalizeGuid(playingGuid) === requestedGuid
    )
        ? normalizeIndex(playingLocation.index, items)
        : -1;

    const playbackState = String(playback?.state || 'stopped');
    const nativeFocusIndex = normalizeIndex(nativeFocus?.index, items);
    const selectionIndex = locatedTrackIndex >= 0
        ? locatedTrackIndex
        : nativeFocusIndex;

    return {
        requestedPlaylistGuid,
        activePlaylistGuid: String(activePlaylist?.guid || ''),
        activeMatches,
        playingPlaylistGuid: playingGuid,
        playingLocationFound: playingLocation?.found === true,
        locatedTrackIndex,
        playingItemIndex: playbackState === 'stopped' ? -1 : locatedTrackIndex,
        nativeFocusIndex,
        selectionIndex,
        selectionSource: locatedTrackIndex >= 0 ? 'playing-location' : (
            nativeFocusIndex >= 0 ? 'native-focus' : 'none'
        ),
        playbackState
    };
}

/**
 * Read one activation snapshot after the target playlist's rows have loaded.
 * getActive is read last so the activation guard uses the latest native state.
 */
export async function readPlaylistActivationSnapshot({
    invoke,
    playlistGuid,
    items
}) {
    const [playingLocation, playingPlaylist, playback, nativeFocus] = await Promise.all([
        invoke('playback.getCurrentTrackIndex', { includeTrackInfo: true })
            .catch(() => ({ found: false })),
        invoke('playlist.getPlaying')
            .catch(() => ({ found: false })),
        invoke('playback.getState')
            .catch(() => ({ state: 'stopped' })),
        invoke('playlist.getFocusedTrack', { playlistGuid })
            .catch(() => ({ index: -1 }))
    ]);

    const activePlaylist = await invoke('playlist.getActive');

    return resolvePlaylistActivationSnapshot({
        requestedPlaylistGuid: playlistGuid,
        activePlaylist,
        playingLocation,
        playingPlaylist,
        playback,
        nativeFocus,
        items
    });
}

/**
 * Apply both native states once, then read them back independently.
 * A mismatch is returned to the caller for diagnostics; it is not hidden by
 * an unbounded retry loop.
 */
export async function applyPlaylistActivationSelection({
    invoke,
    playlistGuid,
    index,
    expectedVersion = ''
}) {
    const selectionIndex = Number(index);
    if (!Number.isInteger(selectionIndex) || selectionIndex < 0) {
        return { applied: false, reason: 'invalid-index' };
    }

    const activePlaylist = await invoke('playlist.getActive');
    if (normalizeGuid(activePlaylist?.guid) !== normalizeGuid(playlistGuid)) {
        return {
            applied: false,
            reason: 'active-playlist-changed',
            activePlaylistGuid: String(activePlaylist?.guid || '')
        };
    }

    await invoke('playlist.setSelection', {
        playlistGuid,
        indices: [selectionIndex],
        clearOthers: true,
        ...(expectedVersion ? { expectedVersion } : {})
    });
    await invoke('playlist.setFocusedTrack', {
        playlistGuid,
        index: selectionIndex,
        ...(expectedVersion ? { expectedVersion } : {})
    });

    const [nativeSelection, nativeFocus] = await Promise.all([
        invoke('playlist.getSelection', { playlistGuid }),
        invoke('playlist.getFocusedTrack', { playlistGuid })
    ]);

    const selectionMatches = Array.isArray(nativeSelection.items)
        && nativeSelection.items.map(Number).includes(selectionIndex);
    const focusMatches = Number(nativeFocus.index) === selectionIndex;

    return {
        applied: true,
        selectionIndex,
        selectionMatches,
        focusMatches,
        nativeSelection: Array.isArray(nativeSelection.items)
            ? nativeSelection.items.map(Number)
            : [],
        nativeFocusIndex: Number.isInteger(Number(nativeFocus.index))
            ? Number(nativeFocus.index)
            : -1
    };
}