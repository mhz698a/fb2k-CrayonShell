import { invoke } from './foobarApi.js';
import {
    buildServiceDescriptorPath,
    parseServiceDescriptor
} from './windowsFileMetadataFormat.js';

const DESCRIPTOR_READ_ATTEMPTS = 5;
const DESCRIPTOR_RETRY_DELAY_MS = 200;
let connectionPromise = null;
let connection = null;

export { formatFileSize, formatWindowsTimestamp } from './windowsFileMetadataFormat.js';

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function readServiceDescriptor() {
    const profile = await invoke('misc.getProfilePath');
    const profilePath = profile?.path || profile?.value;
    const descriptorPath = buildServiceDescriptorPath(profilePath);

    let lastError = null;
    for (let attempt = 0; attempt < DESCRIPTOR_READ_ATTEMPTS; attempt += 1) {
        try {
            // Both APIs are built into foo_ui_webview2. file.read applies the
            // host's Read path policy, which explicitly includes the FB2K profile.
            const file = await invoke('file.read', { path: descriptorPath });
            if (typeof file?.content !== 'string') {
                throw new Error('foo_ui_webview2 no devolvió el contenido del descriptor.');
            }
            return parseServiceDescriptor(file.content);
        } catch (error) {
            lastError = error;
            const transient = error?.code === 'NOT_FOUND'
                || error?.code === 'INVALID_PATH'
                || error?.code === 'OPERATION_FAILED';
            if (!transient || attempt === DESCRIPTOR_READ_ATTEMPTS - 1) break;
            await delay(DESCRIPTOR_RETRY_DELAY_MS);
        }
    }

    if (lastError?.code === 'NOT_FOUND' || lastError?.code === 'INVALID_PATH') {
        throw new Error(
            'No se encontró el descriptor local. Comprueba que foo_crayonshell_bridge esté iniciado.'
        );
    }
    throw lastError || new Error('No se pudo leer el descriptor local de CrayonShell.');
}

async function getConnection(forceRefresh = false) {
    if (!forceRefresh && connection && connection.expiresAt > Date.now()) return connection;
    if (connection && connection.expiresAt <= Date.now()) connection = null;
    if (!forceRefresh && connectionPromise) return connectionPromise;

    connectionPromise = (async () => {
        const nextConnection = await readServiceDescriptor();
        connection = nextConnection;
        return nextConnection;
    })();

    try {
        return await connectionPromise;
    } finally {
        connectionPromise = null;
    }
}

async function requestFileMetadata(playlistIndex, itemIndex, signal, retryUnauthorized) {
    const current = await getConnection();
    const url = current.baseUrl
        + '/api/v1/playlists/' + playlistIndex
        + '/items/' + itemIndex
        + '/timestamps';

    let response;
    try {
        response = await fetch(url, {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + current.token
            },
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'error',
            signal
        });
    } catch (failure) {
        if (failure?.name === 'AbortError') throw failure;
        if (retryUnauthorized && !signal?.aborted) {
            connection = null;
            await getConnection(true);
            return requestFileMetadata(playlistIndex, itemIndex, signal, false);
        }
        throw new Error(
            'No se pudo conectar con el servicio local de CrayonShell. '
            + 'Comprueba que foo_crayonshell_bridge esté iniciado y que el origen WebView2 esté permitido.'
        );
    }

    if (response.status === 401 && retryUnauthorized) {
        connection = null;
        await getConnection(true);
        return requestFileMetadata(playlistIndex, itemIndex, signal, false);
    }

    let payload;
    try {
        payload = await response.json();
    } catch {
        throw new Error('El servicio local devolvió una respuesta JSON no válida.');
    }

    if (!response.ok || payload?.success !== true || !payload.data) {
        const message = payload?.error?.message
            || ('El servicio local respondió HTTP ' + response.status + '.');
        const error = new Error(message);
        error.code = payload?.error?.code || 'HTTP_' + response.status;
        throw error;
    }

    return payload.data;
}

export function resetWindowsFileMetadataConnection() {
    connection = null;
    connectionPromise = null;
}

export async function readWindowsFileMetadata(playlistIndex, itemIndex, signal) {
    if (!Number.isInteger(playlistIndex) || playlistIndex < 0
        || !Number.isInteger(itemIndex) || itemIndex < 0) {
        throw new TypeError('Los índices de playlist y pista deben ser enteros no negativos.');
    }

    return requestFileMetadata(playlistIndex, itemIndex, signal, true);
}
