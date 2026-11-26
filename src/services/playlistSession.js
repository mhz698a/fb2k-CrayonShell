export const PLAYLIST_SESSION_STORAGE_KEY = 'crayonshell.playlist.session.v1';

function getStorage(storageOverride) {
    if (storageOverride) return storageOverride;
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function normalizePath(value) {
    return typeof value === 'string'
        ? value.trim().replace(/\\/g, '/').toLocaleLowerCase()
        : '';
}

export function normalizePlaylistSession(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (value.version !== 1 || typeof value.playlistGuid !== 'string'
        || !value.playlistGuid.trim()) return null;

    const focusedItem = Number.isInteger(value.focusedItem) && value.focusedItem >= 0
        ? value.focusedItem
        : -1;

    return {
        version: 1,
        playlistGuid: value.playlistGuid,
        focusedItem,
        focusedHandle: typeof value.focusedHandle === 'string' ? value.focusedHandle : '',
        focusedPath: typeof value.focusedPath === 'string' ? value.focusedPath : '',
        focusedTitle: typeof value.focusedTitle === 'string' ? value.focusedTitle : ''
    };
}

export function readPlaylistSession(storageOverride) {
    const storage = getStorage(storageOverride);
    if (!storage) return null;

    try {
        const raw = storage.getItem(PLAYLIST_SESSION_STORAGE_KEY);
        if (!raw) return null;
        return normalizePlaylistSession(JSON.parse(raw));
    } catch {
        return null;
    }
}

export function writePlaylistSession(value, storageOverride) {
    const storage = getStorage(storageOverride);
    const session = normalizePlaylistSession(value);
    if (!storage || !session) return false;

    try {
        storage.setItem(PLAYLIST_SESSION_STORAGE_KEY, JSON.stringify(session));
        return true;
    } catch {
        return false;
    }
}

export function buildPlaylistSession(playlistGuid, focusedItem, items) {
    if (typeof playlistGuid !== 'string' || !playlistGuid) return null;

    const focused = Array.isArray(items)
        ? items.find((item) => item.index === focusedItem)
        : null;

    return normalizePlaylistSession({
        version: 1,
        playlistGuid,
        focusedItem,
        focusedHandle: focused?.handle || '',
        focusedPath: focused?.path || '',
        focusedTitle: focused?.title || ''
    });
}

export function resolveSavedFocusIndex(sessionValue, playlistGuid, tracks) {
    const session = normalizePlaylistSession(sessionValue);
    if (!session || session.playlistGuid !== playlistGuid || !Array.isArray(tracks)) {
        return -1;
    }

    if (session.focusedHandle) {
        const handleMatch = tracks.find((track) => track.handle === session.focusedHandle);
        if (handleMatch && Number.isInteger(handleMatch.index)) return handleMatch.index;
    }

    const savedPath = normalizePath(session.focusedPath);
    if (savedPath) {
        const pathMatches = tracks.filter((track) =>
            normalizePath(track.path) === savedPath
        );

        if (pathMatches.length === 1 && Number.isInteger(pathMatches[0].index)) {
            return pathMatches[0].index;
        }

        if (pathMatches.length > 1 && session.focusedTitle) {
            const titleMatch = pathMatches.find((track) =>
                String(track.title || '') === session.focusedTitle
            );
            if (titleMatch && Number.isInteger(titleMatch.index)) return titleMatch.index;
        }

        const indexMatch = pathMatches.find((track) =>
            track.index === session.focusedItem
        );
        if (indexMatch && Number.isInteger(indexMatch.index)) return indexMatch.index;
    }

    return Number.isInteger(session.focusedItem)
        && session.focusedItem >= 0
        && session.focusedItem < tracks.length
        ? session.focusedItem
        : -1;
}
