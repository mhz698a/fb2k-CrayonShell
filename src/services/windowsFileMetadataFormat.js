const BOOTSTRAP_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const WINDOWS_DRIVE_PATH = /^[A-Za-z]:\\/;
const WINDOWS_UNC_PATH = /^\\\\[^\\]+\\[^\\]+/;

export function buildServiceDescriptorPath(profilePath) {
    if (typeof profilePath !== 'string' || !profilePath.trim()) {
        throw new Error('foobar2000 devolvió una ruta de perfil vacía.');
    }

    let normalized = profilePath.trim();

    // misc.getProfilePath normally returns a native path. Accept the file://
    // spelling as well because foobar2000 SDK paths can use that prefix.
    if (/^file:\/\//i.test(normalized)) {
        normalized = normalized.replace(/^file:\/\//i, '');
        normalized = normalized.replace(/^\/(?=[A-Za-z]:[\\/])/i, '');
    }

    normalized = normalized.replace(/\//g, '\\');

    const isDriveRoot = /^[A-Za-z]:\\+$/i.test(normalized);
    if (!isDriveRoot) normalized = normalized.replace(/\\+$/, '');

    const validAbsolutePath = WINDOWS_DRIVE_PATH.test(normalized)
        || WINDOWS_UNC_PATH.test(normalized);
    const segments = normalized.split('\\');

    if (!validAbsolutePath
        || segments.some(segment => segment === '.' || segment === '..')
        || normalized.includes('\0')
        || normalized.includes('?')
        || normalized.includes('#')) {
        throw new Error('La ruta de perfil de foobar2000 no es una ruta local absoluta válida.');
    }

    const separator = normalized.endsWith('\\') ? '' : '\\';
    return normalized + separator + 'foo_crayonshell_bridge\\service.json';
}

export function parseServiceDescriptor(content) {
    if (typeof content !== 'string' || !content.trim()) {
        throw new Error('El descriptor local de CrayonShell está vacío.');
    }

    let payload;
    try {
        payload = JSON.parse(content);
    } catch {
        throw new Error('El descriptor local de CrayonShell no contiene JSON válido.');
    }

    return validateBridgeBootstrap(payload);
}

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
    const pid = Number(payload.pid);
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
        || !BOOTSTRAP_TOKEN_PATTERN.test(instanceId)
        || !Number.isSafeInteger(pid)
        || pid <= 0
        || !Number.isSafeInteger(expiresAt)
        || expiresAt <= Date.now()) {
        throw new Error('El descriptor local de CrayonShell no es compatible, está incompleto o expiró.');
    }

    return Object.freeze({
        protocolVersion: 1,
        baseUrl: 'http://127.0.0.1:' + Number(parsedUrl.port),
        token,
        instanceId,
        pid,
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

export function formatWindowsFileMetadataError(payload, status) {
    const errorCode = payload?.error?.code;

    if (errorCode === 'ITEM_HAS_NO_NATIVE_PATH') {
        return 'El elemento seleccionado no tiene una ruta de archivo nativa de Windows. '
            + 'El panel no puede leer atributos del sistema de archivos para streams '
            + 'o ubicaciones virtuales.';
    }

    const message = payload?.error?.message
        || ('El servicio local respondió HTTP ' + status + '.');
    const win32Error = payload?.error?.win32Error;

    return Number.isInteger(win32Error) && win32Error > 0
        ? message + ' (Código Win32: ' + win32Error + ').'
        : message;
}

export function formatWindowsTimestamp_Basic(value) {
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

export function formatWindowsTimestamp(value) {
    if (!value || value.readable !== true
        || !Number.isSafeInteger(value.unixMilliseconds)
        || value.unixMilliseconds < 0) {
        return 'No disponible';
    }

    const date = new Date(value.unixMilliseconds);
    if (Number.isNaN(date.getTime())) return 'No disponible';

    const pad = (number) => String(number).padStart(2, '0');

    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}