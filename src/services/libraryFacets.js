const PLAYLIST_NAME = 'Library Viewer Selection';
const DIRECTORY_SCAN_CONCURRENCY = 5;
const DIRECTORY_TRACKS_CONCURRENCY = 5;
const EMPTY_YEAR = '__CRAYONSHELL_EMPTY_YEAR__';
const EMPTY_SUBFOLDER = '__CRAYONSHELL_EMPTY_SUBFOLDER__';

function assertSuccess(response, operation) {
    if (!response) {
        throw new Error(operation + ' no devolvió una respuesta.');
    }
    if (response.success === false) {
        const error = new Error(response.error || (operation + ' falló.'));
        error.code = response.code || 'UNKNOWN_ERROR';
        error.details = response.details;
        throw error;
    }
    return response;
}

function directoryKey(rootId, pathId) {
    return String(rootId) + '::' + String(pathId || '');
}

function splitNativePath(value) {
    return String(value || '')
        .replace(/^file:\/\//i, '')
        .replace(/\//g, '\\')
        .split(/\\+/)
        .filter(Boolean);
}

/**
 * $directory(path,n) starts at the containing folder (level 0) and walks
 * n directory levels toward the root. The tree API gives us that folder path
 * directly, so no per-track Title Formatting pass is needed.
 */
function directoryComponent(absoluteDirectoryPath, levelsUp) {
    const parts = splitNativePath(absoluteDirectoryPath);
    const index = parts.length - 1 - levelsUp;
    return index >= 0 ? parts[index] : '';
}

function createFacetDirectory(node, directTrackCount) {
    const year = directoryComponent(node.absolutePath, 3);
    const subfolder = directoryComponent(node.absolutePath, 1);

    return {
        id: directoryKey(node.rootId, node.pathId),
        rootId: node.rootId,
        pathId: node.pathId || '',
        absolutePath: node.absolutePath,
        yearValue: year || EMPTY_YEAR,
        yearLabel: year || '(Sin año)',
        subfolderValue: subfolder || EMPTY_SUBFOLDER,
        subfolderLabel: subfolder || '(Sin subcarpeta)',
        trackCount: directTrackCount
    };
}

async function mapWithConcurrency(items, limit, mapper) {
    const source = Array.isArray(items) ? items : [];
    const results = new Array(source.length);
    let cursor = 0;

    const workerCount = Math.min(Math.max(1, limit), source.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
        while (cursor < source.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await mapper(source[index], index);
        }
    }));

    return results;
}

export async function buildLibraryFacetTree(sdk, options = {}) {
    const { signal, onProgress } = options;

    if (typeof sdk.library?.getRoots !== 'function') {
        throw new Error('El SDK no expone fb.library.getRoots().');
    }
    if (typeof sdk.library?.enumerateTree !== 'function') {
        throw new Error('El SDK no expone fb.library.enumerateTree().');
    }

    const rootsResponse = assertSuccess(
        await sdk.library.getRoots(),
        'library.getRoots'
    );

    if (rootsResponse.enabled === false) {
        return {
            directories: [],
            totalTracks: 0,
            skippedTracks: 0,
            fromCache: false
        };
    }

    const nodes = new Map();
    let visited = 0;
    const roots = Array.isArray(rootsResponse.roots) ? rootsResponse.roots : [];

    for (const root of roots) {
        if (signal?.aborted) {
            throw new DOMException('La consulta del árbol fue cancelada.', 'AbortError');
        }

        const rootNode = {
            id: directoryKey(root.id, ''),
            rootId: root.id,
            pathId: '',
            parentPathId: null,
            absolutePath: root.absolutePath,
            trackCount: Math.max(0, Number(root.trackCount) || 0)
        };
        nodes.set(rootNode.id, rootNode);

        for await (const batch of sdk.library.enumerateTree({
            rootId: root.id,
            strategy: 'bfs',
            includeFiles: false,
            signal,
            onProgress(info) {
                if (signal?.aborted) return;
                onProgress?.({
                    visited: visited + (Number(info?.visited) || 0),
                    pending: Number(info?.pending) || 0
                });
            }
        })) {
            if (signal?.aborted) {
                throw new DOMException('La consulta del árbol fue cancelada.', 'AbortError');
            }
            if (batch?.success === false) {
                throw new Error(batch.error || 'No se pudo consultar una carpeta de la Media Library.');
            }

            const children = Array.isArray(batch?.directories) ? batch.directories : [];
            children.forEach((directory) => {
                const node = {
                    id: directoryKey(directory.rootId || root.id, directory.pathId),
                    rootId: directory.rootId || root.id,
                    pathId: directory.pathId || '',
                    parentPathId: directory.parentPathId || '',
                    absolutePath: directory.absolutePath,
                    trackCount: Math.max(0, Number(directory.trackCount) || 0)
                };
                nodes.set(node.id, node);
            });

            visited += 1;
            onProgress?.({ visited, pending: Number(batch?.pending) || 0 });
        }
    }

    // trackCount is cumulative for a folder and all descendants. Subtract the
    // immediate children's cumulative counts to get files directly in it.
    const childTrackCounts = new Map();
    nodes.forEach((node) => {
        if (node.parentPathId === null) return;
        const parentKey = directoryKey(node.rootId, node.parentPathId);
        childTrackCounts.set(
            parentKey,
            (childTrackCounts.get(parentKey) || 0) + node.trackCount
        );
    });

    const directories = [];
    let totalTracks = 0;

    nodes.forEach((node) => {
        const directTrackCount = Math.max(
            0,
            node.trackCount - (childTrackCounts.get(node.id) || 0)
        );
        if (directTrackCount === 0 || !node.absolutePath) return;

        directories.push(createFacetDirectory(node, directTrackCount));
        totalTracks += directTrackCount;
    });

    directories.sort((left, right) => left.absolutePath.localeCompare(
        right.absolutePath,
        'es',
        { sensitivity: 'base', numeric: true }
    ));

    return {
        directories,
        totalTracks,
        skippedTracks: Math.max(0, Number(rootsResponse.skippedTracks) || 0),
        fromCache: !!rootsResponse.fromCache
    };
}

async function readDirectoryTracks(sdk, directory) {
    const response = assertSuccess(
        await sdk.library.browseTree({
            rootId: directory.rootId,
            pathId: directory.pathId,
            includeFiles: true,
            recursiveFiles: false
        }),
        'library.browseTree'
    );

    return Array.isArray(response.files) ? response.files : [];
}

async function findSelectionPlaylist(sdk) {
    const response = assertSuccess(
        await sdk.playlist.getAll(),
        'playlist.getAll'
    );
    const expectedName = PLAYLIST_NAME.toLocaleLowerCase('es-MX');

    return (Array.isArray(response.playlists) ? response.playlists : [])
        .find((playlist) => String(playlist.name || '').trim().toLocaleLowerCase('es-MX') === expectedName)
        || null;
}

async function getOrCreateSelectionPlaylist(sdk) {
    let target = await findSelectionPlaylist(sdk);
    if (!target) {
        assertSuccess(
            await sdk.playlist.create(PLAYLIST_NAME),
            'playlist.create'
        );
        target = await findSelectionPlaylist(sdk);
    }

    if (!target) {
        throw new Error('No se pudo crear la playlist "' + PLAYLIST_NAME + '".');
    }
    if (target.isLocked) {
        throw new Error('La playlist "' + PLAYLIST_NAME + '" está bloqueada.');
    }
    if (target.isAutoplaylist) {
        throw new Error('La playlist "' + PLAYLIST_NAME + '" es una autoplaylist y no se puede rellenar manualmente.');
    }

    const playlistRef = target.guid || target.index;
    if (playlistRef === undefined || playlistRef === null) {
        throw new Error('No se pudo identificar la playlist "' + PLAYLIST_NAME + '".');
    }
    return playlistRef;
}

export async function syncLibraryViewerSelection(sdk, directories, options = {}) {
    const source = Array.isArray(directories) ? directories : [];
    const shouldApply = typeof options.shouldApply === 'function'
        ? options.shouldApply
        : () => true;

    const directoryFiles = await mapWithConcurrency(
        source,
        DIRECTORY_TRACKS_CONCURRENCY,
        (directory) => readDirectoryTracks(sdk, directory)
    );

    if (!shouldApply()) return { stale: true, trackCount: 0 };

    const uniqueTracks = new Map();
    directoryFiles.flat().forEach((track) => {
        const path = String(track?.path || '');
        if (!path) return;

        const subsong = Math.max(0, Number(track.subsong) || 0);
        const key = String(track.handle || (path + '|subsong:' + subsong));
        if (!uniqueTracks.has(key)) {
            uniqueTracks.set(key, {
                index: Number.isFinite(Number(track.index)) ? Number(track.index) : Number.MAX_SAFE_INTEGER,
                path,
                subsong
            });
        }
    });

    const orderedTracks = Array.from(uniqueTracks.values()).sort((left, right) => (
        left.index - right.index
    ));
    const handles = orderedTracks.map((track) => (
        track.subsong > 0
            ? { path: track.path, subsong: track.subsong }
            : track.path
    ));

    if (!shouldApply()) return { stale: true, trackCount: handles.length };

    const existingPlaylist = await findSelectionPlaylist(sdk);
    if (!existingPlaylist && handles.length === 0) {
        return { stale: false, trackCount: 0, updated: false };
    }

    const playlistRef = await getOrCreateSelectionPlaylist(sdk);
    if (!shouldApply()) return { stale: true, trackCount: handles.length };

    assertSuccess(
        await sdk.playlist.clear(playlistRef),
        'playlist.clear'
    );

    if (handles.length > 0) {
        assertSuccess(
            await sdk.playlist.addHandles(playlistRef, handles),
            'playlist.addHandles'
        );
    }

    return {
        stale: false,
        updated: true,
        trackCount: handles.length
    };
}

export const EMPTY_FACET_VALUES = Object.freeze({
    year: EMPTY_YEAR,
    subfolder: EMPTY_SUBFOLDER
});
