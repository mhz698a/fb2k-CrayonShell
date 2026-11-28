import { parseTrackDuration } from '../../utils/playlistStatus.js';

const DEFAULT_PAGE_SIZE = 200;
const CLIPBOARD_PREFIX = 'CRAYONSHELL_PLAYLIST_CLIPBOARD:';
let demoClipboardText = '';

function requireInvoke(invokeOperation) {
    if (typeof invokeOperation !== 'function') {
        throw new TypeError('Se necesita una función invoke para operar con playlists.');
    }
}

async function readPlaylistRows(playlist, fields, invokeOperation, pageSize) {
    const playlistGuid = String(playlist?.guid || '').trim();
    if (!playlistGuid) throw new Error('La playlist no tiene un GUID válido.');

    for (let attempt = 0; attempt < 2; attempt += 1) {
        let start = 0;
        let total = Math.max(0, Number(playlist.trackCount) || 0);
        let contentVersion = '';
        const rows = [];
        let stale = false;

        while (start < total) {
            const page = await invokeOperation('playlist.getTracks', {
                playlistGuid,
                start,
                count: pageSize,
                fields
            });

            if (String(page.playlistGuid || '') !== playlistGuid) {
                throw new Error('La playlist ya no existe o cambió mientras se leían sus pistas.');
            }

            const nextVersion = String(page.contentVersion || '');
            if (contentVersion && nextVersion && nextVersion !== contentVersion) {
                stale = true;
                break;
            }
            if (nextVersion) contentVersion = nextVersion;

            if (start === 0 && Number.isFinite(Number(page.total))) {
                total = Math.max(0, Number(page.total));
            }

            const tracks = Array.isArray(page.tracks) ? page.tracks : [];
            rows.push(...tracks);
            if (tracks.length === 0) break;
            start += tracks.length;
        }

        if (!stale) {
            if (rows.length < total) {
                throw new Error('No se pudieron leer todas las pistas de la playlist.');
            }
            return { rows, contentVersion, total };
        }
    }

    const error = new Error('La playlist cambió durante la lectura. Vuelve a intentarlo.');
    error.code = 'STALE_TARGET';
    throw error;
}

export async function loadPlaylistStatistics(
    playlist,
    { invoke: invokeOperation, pageSize = DEFAULT_PAGE_SIZE } = {}
) {
    requireInvoke(invokeOperation);
    const expectedCount = Math.max(0, Number(playlist?.trackCount) || 0);
    if (expectedCount === 0) {
        return {
            trackCount: 0,
            durationSeconds: 0,
            fileSizeBytes: 0,
            knownSizeCount: 0,
            unknownSizeCount: 0,
            unknownDurationCount: 0,
            contentVersion: ''
        };
    }

    const { rows, contentVersion } = await readPlaylistRows(
        playlist,
        ['duration', 'fileSize'],
        invokeOperation,
        pageSize
    );

    let durationSeconds = 0;
    let fileSizeBytes = 0;
    let knownSizeCount = 0;
    let unknownSizeCount = 0;
    let unknownDurationCount = 0;

    rows.forEach((track) => {
        const duration = parseTrackDuration(track.duration);
        if (duration === null) unknownDurationCount += 1;
        else durationSeconds += duration;

        const size = Number(track.fileSize);
        if (
            track.fileSize !== null
            && track.fileSize !== undefined
            && String(track.fileSize).trim() !== ''
            && Number.isFinite(size)
            && size > 0
        ) {
            fileSizeBytes += size;
            knownSizeCount += 1;
        } else {
            unknownSizeCount += 1;
        }
    });

    return {
        trackCount: rows.length,
        durationSeconds,
        fileSizeBytes,
        knownSizeCount,
        unknownSizeCount,
        unknownDurationCount,
        contentVersion
    };
}

export function formatByteSize(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1024) return Math.round(bytes) + ' B';

    const units = ['KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = -1;
    do {
        size /= 1024;
        unitIndex += 1;
    } while (size >= 1024 && unitIndex < units.length - 1);

    return size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2) + ' ' + units[unitIndex];
}

export function parsePlaylistClipboard(text) {
    const value = String(text || '');
    if (!value.startsWith(CLIPBOARD_PREFIX)) return null;

    try {
        const payload = JSON.parse(value.slice(CLIPBOARD_PREFIX.length));
        if (
            payload?.schema !== 1
            || payload?.kind !== 'crayonshell.playlist'
            || !['copy', 'cut'].includes(payload.operation)
            || !Array.isArray(payload.handles)
            || !payload.handles.every((handle) => typeof handle === 'string' && handle.trim())
        ) {
            return null;
        }

        return {
            schema: 1,
            kind: 'crayonshell.playlist',
            operation: payload.operation,
            name: String(payload.name || 'Playlist').trim() || 'Playlist',
            sourceGuid: String(payload.sourceGuid || ''),
            handles: payload.handles.map((handle) => handle.trim())
        };
    } catch {
        return null;
    }
}

export async function copyPlaylistToClipboard(
    playlist,
    {
        invoke: invokeOperation,
        writeText,
        operation = 'copy',
        pageSize = DEFAULT_PAGE_SIZE
    } = {}
) {
    requireInvoke(invokeOperation);
    if (!['copy', 'cut'].includes(operation)) {
        throw new TypeError('La operación de portapapeles debe ser copy o cut.');
    }

    const { rows } = await readPlaylistRows(
        playlist,
        ['handle'],
        invokeOperation,
        pageSize
    );
    const handles = rows.map((track) => String(track.handle || '').trim());
    if (handles.some((handle) => !handle)) {
        throw new Error('La playlist contiene pistas sin un handle que pueda copiarse.');
    }

    const payload = {
        schema: 1,
        kind: 'crayonshell.playlist',
        operation,
        name: String(playlist.name || 'Playlist').trim() || 'Playlist',
        sourceGuid: String(playlist.guid),
        handles
    };
    const clipboardText = CLIPBOARD_PREFIX + JSON.stringify(payload);

    if (typeof writeText === 'function') {
        await writeText(clipboardText);
    } else {
        demoClipboardText = clipboardText;
    }

    if (operation === 'cut') {
        await invokeOperation('playlist.remove', {
            playlistGuid: String(playlist.guid)
        });
    }

    return {
        operation,
        name: payload.name,
        trackCount: handles.length
    };
}

export async function pastePlaylistFromClipboard({
    invoke: invokeOperation,
    readText,
    writeText
} = {}) {
    requireInvoke(invokeOperation);
    const clipboardText = typeof readText === 'function'
        ? await readText()
        : demoClipboardText;
    const payload = parsePlaylistClipboard(clipboardText);

    if (!payload) {
        throw new Error('El portapapeles no contiene una playlist copiada desde CrayonShell.');
    }

    const targetName = payload.operation === 'cut'
        ? payload.name
        : payload.name + ' (Copy)';
    const created = await invokeOperation('playlist.create', { name: targetName });
    const targetGuid = String(created.guid || '');
    if (!targetGuid) {
        throw new Error('foobar2000 no devolvió el GUID de la nueva playlist.');
    }

    try {
        let addedCount = 0;
        if (payload.handles.length > 0) {
            const result = await invokeOperation('playlist.addHandles', {
                playlistGuid: targetGuid,
                handles: payload.handles
            });
            addedCount = Number(result.addedCount) || 0;
            if (addedCount !== payload.handles.length) {
                throw new Error(
                    'Solo se pudieron restaurar ' + addedCount
                    + ' de ' + payload.handles.length + ' pistas.'
                );
            }
        }

        if (payload.operation === 'cut') {
            if (typeof writeText === 'function') {
                try {
                    await writeText('');
                } catch {
                    // The playlist was restored; a clipboard cleanup failure must not roll it back.
                }
            } else {
                demoClipboardText = '';
            }
        }

        return {
            guid: targetGuid,
            name: targetName,
            trackCount: addedCount,
            operation: payload.operation
        };
    } catch (error) {
        try {
            await invokeOperation('playlist.remove', { playlistGuid: targetGuid });
        } catch (rollbackError) {
            error.message += ' Además, no se pudo retirar la playlist incompleta: '
                + (rollbackError?.message || String(rollbackError));
        }
        throw error;
    }
}
