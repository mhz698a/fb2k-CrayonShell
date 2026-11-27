export function getTrackIdentity(track) {
    if (track?.handle) return String(track.handle);

    const path = String(track?.absolutePath || track?.path || '').trim();
    if (!path) return '';

    const subsong = track.subsong === null || track.subsong === undefined
        ? null
        : Number(track.subsong);
    return path.toLocaleLowerCase('en-US') + (subsong === null ? '' : '|subsong:' + subsong);
}

export function findUnmatchedPlaylistRows(currentItems = [], identityRows = []) {
    const available = new Map();

    currentItems.forEach((item) => {
        const identity = getTrackIdentity(item);
        if (identity) available.set(identity, (available.get(identity) || 0) + 1);
    });

    return identityRows.filter((row) => {
        const identity = getTrackIdentity(row);
        if (!identity) return true;

        const count = available.get(identity) || 0;
        if (count > 0) {
            available.set(identity, count - 1);
            return false;
        }
        return true;
    });
}

/**
 * Rebuild the visible playlist order from a lightweight handle snapshot.
 * Existing rows are reused by identity; only identities absent from the
 * previous snapshot need a separately hydrated full row.
 */
export function reconcilePlaylistItems({
    currentItems = [],
    identityRows = [],
    hydratedItems = []
} = {}) {
    const reusableByIdentity = new Map();

    currentItems.forEach((item) => {
        const identity = getTrackIdentity(item);
        if (!identity) return;

        const queue = reusableByIdentity.get(identity) || [];
        queue.push(item);
        reusableByIdentity.set(identity, queue);
    });

    const hydratedByIndex = new Map(
        hydratedItems.map((item) => [Number(item.index), item])
    );

    const nextItems = identityRows.map((identityRow) => {
        const index = Number(identityRow.index);
        const identity = getTrackIdentity(identityRow);
        const queue = identity ? reusableByIdentity.get(identity) : null;
        const existing = queue?.length ? queue.shift() : null;

        if (existing) {
            return existing.index === index
                ? existing
                : { ...existing, index };
        }

        const hydrated = hydratedByIndex.get(index);
        if (!hydrated) {
            const error = new Error('No se recibieron los datos de la nueva pista en la fila ' + index + '.');
            error.code = 'STALE_SNAPSHOT';
            throw error;
        }

        if (identity && getTrackIdentity(hydrated) !== identity) {
            const error = new Error('La pista cambió durante la hidratación de la fila ' + index + '.');
            error.code = 'STALE_SNAPSHOT';
            throw error;
        }

        return hydrated.index === index
            ? hydrated
            : { ...hydrated, index };
    });

    const unchanged = nextItems.length === currentItems.length
        && nextItems.every((item, index) => item === currentItems[index]);

    return unchanged ? currentItems : nextItems;
}

/**
 * On startup, keep the actual playing track selected when it belongs to the
 * active playlist. Otherwise restore the last focused row, then native focus.
 */
export function resolveInitialSelectionIndex({
    playingIndex = -1,
    savedFocusIndex = -1,
    focusedIndex = -1,
    itemCount = 0
} = {}) {
    const isValid = (index) => Number.isInteger(index) && index >= 0 && index < itemCount;

    if (isValid(playingIndex)) return playingIndex;
    if (isValid(savedFocusIndex)) return savedFocusIndex;
    if (isValid(focusedIndex)) return focusedIndex;
    return -1;
}

/**
 * Keep an automatically restored playing row stable against delayed native
 * focus notifications. Explicit user selection releases the pin in usePlaylist.
 */
export function shouldIgnorePinnedFocusChange({
    pinnedSelection = null,
    playlistGuid = '',
    nextIndex = -1
} = {}) {
    return Boolean(
        pinnedSelection
        && pinnedSelection.playlistGuid === playlistGuid
        && Number(nextIndex) !== pinnedSelection.index
    );
}

export function resolvePinnedSelectionIndex(items = [], pinnedSelection = null, playlistGuid = '') {
    if (!pinnedSelection || pinnedSelection.playlistGuid !== playlistGuid || !pinnedSelection.identity) {
        return -1;
    }

    return items.findIndex((item) => getTrackIdentity(item) === pinnedSelection.identity);
}
