export function resolveSettingsStorage(storageOverride) {
    if (storageOverride) return storageOverride;
    try {
        return typeof window !== 'undefined' ? window.localStorage : null;
    } catch {
        return null;
    }
}

export function requireSettingsStorage(storageOverride) {
    const storage = resolveSettingsStorage(storageOverride);
    if (!storage || typeof storage.getItem !== 'function'
        || typeof storage.setItem !== 'function') {
        throw new Error('El almacenamiento local de CrayonShell no está disponible.');
    }
    return storage;
}
