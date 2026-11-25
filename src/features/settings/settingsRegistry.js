const PROVIDER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const MAX_PROVIDER_ID_LENGTH = 64;
const MAX_LABEL_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 240;

function normalizeProvider(definition) {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
        throw new TypeError('La definición de un proveedor de ajustes debe ser un objeto.');
    }

    const id = String(definition.id || '').trim();
    if (!id || id.length > MAX_PROVIDER_ID_LENGTH || !PROVIDER_ID_PATTERN.test(id)) {
        throw new TypeError(
            'El proveedor debe tener un ID estable de hasta '
            + MAX_PROVIDER_ID_LENGTH
            + ' caracteres, usando minúsculas, números, puntos, guiones o guiones bajos.'
        );
    }

    const label = String(definition.label || '').trim();
    if (!label) {
        throw new TypeError('El proveedor "' + id + '" debe proporcionar una etiqueta.');
    }

    const version = Number(definition.version);
    if (!Number.isSafeInteger(version) || version < 1) {
        throw new TypeError('El proveedor "' + id + '" debe declarar una versión entera positiva.');
    }

    for (const method of ['readSettings', 'validateSettings', 'applySettings']) {
        if (typeof definition[method] !== 'function') {
            throw new TypeError(
                'El proveedor "' + id + '" debe implementar ' + method + '().'
            );
        }
    }

    const order = Number(definition.order);
    return Object.freeze({
        id,
        label: label.slice(0, MAX_LABEL_LENGTH),
        description: String(definition.description || '')
            .trim()
            .slice(0, MAX_DESCRIPTION_LENGTH),
        version,
        order: Number.isFinite(order) ? order : 0,
        readSettings: definition.readSettings,
        validateSettings: definition.validateSettings,
        applySettings: definition.applySettings
    });
}

function toProviderMetadata(provider) {
    return {
        id: provider.id,
        label: provider.label,
        description: provider.description,
        version: provider.version,
        order: provider.order
    };
}

/**
 * Registry for the persistent settings owned by CrayonShell features.
 *
 * Providers are intentionally storage-agnostic. A provider may use localStorage,
 * another browser storage adapter, or a host-backed store without changing the
 * registry or the future backup/import services.
 *
 * Provider contract:
 * - readSettings(): returns the provider's current serializable settings.
 * - validateSettings(value): validates and returns normalized settings without
 *   mutating persistent storage.
 * - applySettings(value, context): applies previously validated settings.
 */
export function createSettingsRegistry() {
    const providers = new Map();
    const listeners = new Set();
    let revision = 0;

    function notify() {
        revision += 1;
        for (const listener of listeners) {
            try {
                listener();
            } catch (error) {
                console.error('[Settings] Error notificando un cambio del registro.', error);
            }
        }
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') {
            throw new TypeError('El suscriptor del registro debe ser una función.');
        }

        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    function registerMany(definitions) {
        if (!Array.isArray(definitions) || definitions.length === 0) {
            throw new TypeError('Debe registrarse una lista no vacía de proveedores de ajustes.');
        }

        // Validate the complete batch before publishing any provider.
        const staged = definitions.map(normalizeProvider);
        const stagedIds = new Set();

        for (const provider of staged) {
            if (stagedIds.has(provider.id) || providers.has(provider.id)) {
                throw new Error(
                    'Ya existe un proveedor de ajustes con el identificador: ' + provider.id
                );
            }
            stagedIds.add(provider.id);
        }

        staged.forEach((provider) => providers.set(provider.id, provider));
        notify();

        let registered = true;
        return () => {
            if (!registered) return false;
            registered = false;

            let removed = false;
            for (const provider of staged) {
                if (providers.get(provider.id) !== provider) continue;
                providers.delete(provider.id);
                removed = true;
            }

            if (removed) notify();
            return removed;
        };
    }

    function register(definition) {
        const disposeBatch = registerMany([definition]);
        return disposeBatch;
    }

    function getProvider(id) {
        return providers.get(String(id || '')) || null;
    }

    function getProviders() {
        return Array.from(providers.values())
            .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
            .map(toProviderMetadata);
    }

    return Object.freeze({
        register,
        registerMany,
        getProvider,
        getProviders,
        has: (id) => providers.has(String(id || '')),
        subscribe,
        getRevision: () => revision
    });
}
