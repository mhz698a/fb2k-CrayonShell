import { invoke } from './foobarApi.js';

const BOOTSTRAP_METHOD = 'crayonshell_bridge.getBootstrap';
const BOOTSTRAP_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
let connectionPromise = null;
let connection = null;

export function validateBridgeBootstrap(value) {
    const payload = value?.data && typeof value.data === 'object'
        ? value.data
        : value;

    if (!payload || typeof payload !== 'object') {
        throw new Error('foo_ui_webview2 devolvió un bootstrap vacío.');
    }

    const port = Number(payload.port);
    const bearerToken = typeof payload.bearerToken === 'string'
        ? payload.bearerToken
        : '';

    if (payload.protocolVersion !== 1
        || !Number.isInteger(port)
        || port < 1
        || port > 65535
        || !BOOTSTRAP_TOKEN_PATTERN.test(bearerToken)) {
        throw new Error('El bootstrap de foo_crayonshell_bridge no es compatible o está incompleto.');
    }

    return Object.freeze({
        protocolVersion: 1,
        componentVersion: String(payload.componentVersion || ''),
        port,
        bearerToken,
        baseUrl: 'http://127.0.0.1:' + port
    });
}

export function formatFileSize(bytes) {
    if (!Number.isSafeInteger(bytes) || bytes < 0) return 'No disponible';
    if (bytes === 0) return '0 bytes';

    const units = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const unitIndex = Math.min(
        Math.floor(Math.log(bytes) / Math.log(1024)),
        units.length - 1
    );
    const value = bytes / (1024 ** unitIndex);
    const digits = unitIndex === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;

    return value.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: digits
    }) + ' ' + units[unitIndex];
}

export function formatWindowsTimestamp(value) {
    if (!value || value.readable !== true
        || !Number.isSafeInteger(value.unixMilliseconds)
        || value.unixMilliseconds < 0) {
        return 'No disponible';
    }

    const date = new Date(value.unixMilliseconds);
    if (Number.isNaN(date.getTime())) return 'No disponible';

    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'medium'
    }).format(date);
}

async function getConnection(forceRefresh = false) {
    if (!forceRefresh && connection) return connection;
    if (!forceRefresh && connectionPromise) return connectionPromise;

    connectionPromise = (async () => {
        const bootstrap = await invoke(BOOTSTRAP_METHOD);
        const nextConnection = validateBridgeBootstrap(bootstrap);
        connection = nextConnection;
        return nextConnection;
    })();

    try {
        return await connectionPromise;
    } finally {
        connectionPromise = null;
    }
}

async function requestFileMetadata(port, itemIndex, signal, retryUnauthorized) {
    const current = await getConnection();
    const url = current.baseUrl
        + '/api/v1/playlists/' + port
        + '/items/' + itemIndex
        + '/timestamps';

    let response;
    try {
        response = await fetch(url, {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + current.bearerToken
            },
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'error',
            signal
        });
    } catch (failure) {
        if (failure?.name === 'AbortError') throw failure;
        throw new Error(
            'No se pudo conectar con el servicio local de CrayonShell. '
            + 'Comprueba que foo_crayonshell_bridge esté iniciado y que el origen WebView2 esté permitido.'
        );
    }

    if (response.status === 401 && retryUnauthorized) {
        connection = null;
        await getConnection(true);
        return requestFileMetadata(port, itemIndex, signal, false);
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
