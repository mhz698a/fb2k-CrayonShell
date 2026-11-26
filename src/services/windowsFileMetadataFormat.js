const BOOTSTRAP_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function validateBridgeBootstrap(value) {
    const payload = value && typeof value === 'object'
        ? value
        : null;

    if (!payload || typeof payload !== 'object') {
        throw new Error('foo_ui_webview2 devolvió un descriptor vacío.');
    }

    const baseUrl = typeof payload.baseUrl === 'string' ? payload.baseUrl : '';
    const token = typeof payload.token === 'string' ? payload.token : '';
    const instanceId = typeof payload.instanceId === 'string' ? payload.instanceId : '';
    const expiresAt = Number(payload.expiresAt);
    let parsedUrl = null;

    try {
        parsedUrl = new URL(baseUrl);
    } catch {
        // Rejected below.
    }

    const validBaseUrl = parsedUrl
        && parsedUrl.protocol === 'http:'
        && parsedUrl.hostname === '127.0.0.1'
        && Number.isInteger(Number(parsedUrl.port))
        && Number(parsedUrl.port) >= 1
        && Number(parsedUrl.port) <= 65535
        && (parsedUrl.pathname === '/' || parsedUrl.pathname === '')
        && !parsedUrl.username
        && !parsedUrl.password
        && !parsedUrl.search
        && !parsedUrl.hash;

    if (payload.success !== true
        || payload.service !== 'crayonshell'
        || payload.protocolVersion !== 1
        || !validBaseUrl
        || !BOOTSTRAP_TOKEN_PATTERN.test(token)
        || !instanceId
        || !Number.isSafeInteger(expiresAt)
        || expiresAt <= Date.now()) {
        throw new Error('El descriptor local de CrayonShell no es compatible, está incompleto o expiró.');
    }

    return Object.freeze({
        protocolVersion: 1,
        baseUrl: 'http://127.0.0.1:' + Number(parsedUrl.port),
        token,
        instanceId,
        expiresAt
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

