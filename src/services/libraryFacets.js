const TITLE_FORMAT_FIELDS = Object.freeze({
    year: '$directory(%path%,3)',
    subfolder: '$directory(%path%,1)'
});

const ENUMERATION_PAGE_SIZE = 250;
const TRACK_LOOKUP_BATCH_SIZE = 5000;
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

function normalizeFacetValue(value) {
    return String(value ?? '').trim();
}

function createFacetRecord(track, result) {
    const year = result?.success === false
        ? ''
        : normalizeFacetValue(result?.year);
    const subfolder = result?.success === false
        ? ''
        : normalizeFacetValue(result?.subfolder);

    return {
        handle: String(track.handle || ''),
        path: String(track.path || track.absolutePath || ''),
        absolutePath: String(track.absolutePath || track.path || ''),
        index: Number.isInteger(track.index) ? track.index : -1,
        yearValue: year || EMPTY_YEAR,
        yearLabel: year || '(Sin año)',
        subfolderValue: subfolder || EMPTY_SUBFOLDER,
        subfolderLabel: subfolder || '(Sin subcarpeta)'
    };
}

export async function evaluateFacetTracks(sdk, tracks, signal) {
    const source = Array.isArray(tracks) ? tracks : [];
    const records = [];

    for (let offset = 0; offset < source.length; offset += ENUMERATION_PAGE_SIZE) {
        if (signal?.aborted) {
            throw new DOMException('La indexación fue cancelada.', 'AbortError');
        }

        const batch = source.slice(offset, offset + ENUMERATION_PAGE_SIZE);
        const validTracks = batch.filter((track) => track
            && typeof track.handle === 'string'
            && track.handle.length > 0
            && typeof (track.path || track.absolutePath) === 'string'
            && (track.path || track.absolutePath).length > 0);

        if (validTracks.length === 0) continue;

        const paths = validTracks.map((track) => track.path || track.absolutePath);
        const response = assertSuccess(
            await sdk.titleformat.evalFieldsBatch(paths, TITLE_FORMAT_FIELDS),
            'titleformat.evalFieldsBatch'
        );
        const results = Array.isArray(response.results) ? response.results : [];

        validTracks.forEach((track, index) => {
            records.push(createFacetRecord(track, results[index]));
        });
    }

    return records;
}

export async function buildLibraryFacetIndex(sdk, options = {}) {
    const { signal, onProgress } = options;
    const records = new Map();

    if (typeof sdk.library?.enumerateTracks !== 'function') {
        throw new Error('El SDK no expone fb.library.enumerateTracks().');
    }
    if (typeof sdk.titleformat?.evalFieldsBatch !== 'function') {
        throw new Error('El SDK no expone fb.titleformat.evalFieldsBatch().');
    }

    let fetched = 0;
    let total = 0;
    let pages = 0;

    const iterator = sdk.library.enumerateTracks({
        pageSize: ENUMERATION_PAGE_SIZE,
        useCache: true,
        signal,
        onProgress(info) {
            if (signal?.aborted) return;
            onProgress?.({
                fetched: Number(info?.fetched) || fetched,
                total: Number(info?.total) || total,
                pages: Number(info?.pages) || pages
            });
        }
    });

    for await (const page of iterator) {
        if (signal?.aborted) {
            throw new DOMException('La indexación fue cancelada.', 'AbortError');
        }

        const tracks = Array.isArray(page.tracks)
            ? page.tracks
            : Array.isArray(page.items)
                ? page.items
                : [];

        const batchRecords = await evaluateFacetTracks(sdk, tracks, signal);
        batchRecords.forEach((record) => records.set(record.handle, record));

        fetched = Number(page.fetched) || fetched + tracks.length;
        total = Number(page.total) || total;
        pages = Number(page.pages) || pages + 1;
        onProgress?.({ fetched, total, pages });
    }

    return records;
}

export async function fetchChangedFacetTracks(sdk, handles) {
    const uniqueHandles = Array.from(new Set(
        (Array.isArray(handles) ? handles : [])
            .filter((handle) => typeof handle === 'string' && handle.length > 0)
    ));
    const records = new Map();
    const missing = new Set();

    for (let offset = 0; offset < uniqueHandles.length; offset += TRACK_LOOKUP_BATCH_SIZE) {
        const batch = uniqueHandles.slice(offset, offset + TRACK_LOOKUP_BATCH_SIZE);
        const response = assertSuccess(
            await sdk.library.getTracks(batch, ['handle', 'path', 'absolutePath', 'index']),
            'library.getTracks'
        );

        (Array.isArray(response.missing) ? response.missing : []).forEach((handle) => {
            missing.add(String(handle));
        });

        const tracks = Array.isArray(response.tracks) ? response.tracks : [];
        const enriched = await evaluateFacetTracks(sdk, tracks);
        enriched.forEach((record) => records.set(record.handle, record));
    }

    return { records, missing };
}

export function assertLibraryResponse(response, operation) {
    return assertSuccess(response, operation);
}

export const EMPTY_FACET_VALUES = Object.freeze({
    year: EMPTY_YEAR,
    subfolder: EMPTY_SUBFOLDER
});
