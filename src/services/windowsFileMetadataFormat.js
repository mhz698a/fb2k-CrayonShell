const BOOTSTRAP_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

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

