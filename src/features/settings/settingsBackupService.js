import packageInfo from '../../../package.json' with { type: 'json' };

export const SETTINGS_BACKUP_FORMAT = 'crayonshell-settings';
export const SETTINGS_BACKUP_FORMAT_VERSION = 1;

const UNSAFE_JSON_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function cloneJsonValue(value, path = '$', ancestors = new WeakSet()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError('El ajuste "' + path + '" contiene un número no finito.');
        }
        return value;
    }

    if (typeof value !== 'object') {
        throw new TypeError('El ajuste "' + path + '" contiene un valor no serializable.');
    }

    if (ancestors.has(value)) {
        throw new TypeError('El ajuste "' + path + '" contiene una referencia circular.');
    }

    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('El ajuste "' + path + '" debe contener únicamente objetos JSON simples.');
    }

    if (Reflect.ownKeys(value).some((key) => typeof key === 'symbol')) {
        throw new TypeError('El ajuste "' + path + '" contiene propiedades Symbol no serializables.');
    }

    ancestors.add(value);
    let cloned;

    if (Array.isArray(value)) {
        cloned = value.map((entry, index) => cloneJsonValue(entry, path + '[' + index + ']', ancestors));
        for (let index = 0; index < value.length; index += 1) {
            if (!Object.prototype.hasOwnProperty.call(value, index)) {
                throw new TypeError('El ajuste "' + path + '" contiene una posición vacía en un arreglo.');
            }
        }
    } else {
        cloned = {};
        for (const [key, entry] of Object.entries(value)) {
            if (UNSAFE_JSON_KEYS.has(key)) {
                throw new TypeError('El ajuste "' + path + '" contiene una propiedad no permitida: ' + key);
            }
            cloned[key] = cloneJsonValue(entry, path + '.' + key, ancestors);
        }
    }

    ancestors.delete(value);
    return cloned;
}

function getRuntimeName(runtime) {
    if (runtime) return String(runtime);
    if (typeof window !== 'undefined' && typeof window.fb2k?.invoke === 'function') {
        return 'foobar2000-webview2';
    }
    return 'browser';
}

function getRegistryProviders(registry) {
    if (!registry || typeof registry.getProviders !== 'function'
        || typeof registry.getProvider !== 'function') {
        throw new TypeError('Se requiere un SettingsRegistry válido para exportar ajustes.');
    }

    const metadata = registry.getProviders();
    if (!metadata.length) {
        throw new Error('No hay proveedores registrados para exportar los ajustes de CrayonShell.');
    }
    return metadata;
}

export function createSettingsBackup(registry, options = {}) {
    const providersMetadata = getRegistryProviders(registry);
    const now = typeof options.now === 'function' ? options.now() : new Date();
    const exportedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
    const providers = {};

    for (const metadata of providersMetadata) {
        const provider = registry.getProvider(metadata.id);
        if (!provider) {
            throw new Error('El proveedor "' + metadata.id + '" dejó de estar registrado durante la exportación.');
        }

        const currentSettings = provider.readSettings();
        const validatedSettings = provider.validateSettings(currentSettings);
        providers[metadata.id] = {
            version: provider.version,
            settings: cloneJsonValue(validatedSettings, '$.providers.' + metadata.id + '.settings')
        };
    }

    return {
        format: SETTINGS_BACKUP_FORMAT,
        formatVersion: SETTINGS_BACKUP_FORMAT_VERSION,
        exportedAt,
        application: {
            name: 'CrayonShell',
            version: String(options.applicationVersion || packageInfo.version || 'unknown'),
            runtime: getRuntimeName(options.runtime)
        },
        providers
    };
}

export function serializeSettingsBackup(registry, options = {}) {
    const backup = createSettingsBackup(registry, options);
    return JSON.stringify(backup, null, 2);
}
