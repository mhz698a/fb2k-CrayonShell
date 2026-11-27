import {
    requireSettingsStorage,
    resolveSettingsStorage
} from '../settings/storageAccess.js';

export const WAVEFORM_CACHE_SETTINGS_STORAGE_KEY = 'crayonshell.waveform.cache.settings.v1';
export const WAVEFORM_CACHE_SETTINGS_VERSION = 1;
export const MEBIBYTE = 1024 * 1024;
export const DEFAULT_WAVEFORM_CACHE_MAX_BYTES = 1024 * MEBIBYTE;
export const MIN_WAVEFORM_CACHE_MAX_BYTES = 64 * MEBIBYTE;
export const MAX_WAVEFORM_CACHE_MAX_BYTES = 64 * 1024 * MEBIBYTE;

export function normalizeWaveformCacheSettings(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
    const candidate = Number(source.maxBytes);
    const valid = Number.isFinite(candidate) && candidate > 0;
    const rounded = valid
        ? Math.round(candidate / MEBIBYTE) * MEBIBYTE
        : DEFAULT_WAVEFORM_CACHE_MAX_BYTES;

    return {
        maxBytes: Math.max(
            MIN_WAVEFORM_CACHE_MAX_BYTES,
            Math.min(MAX_WAVEFORM_CACHE_MAX_BYTES, rounded)
        )
    };
}

export function readWaveformCacheSettings(storageOverride) {
    const storage = resolveSettingsStorage(storageOverride);
    if (!storage || typeof storage.getItem !== 'function') {
        return normalizeWaveformCacheSettings();
    }

    try {
        const raw = storage.getItem(WAVEFORM_CACHE_SETTINGS_STORAGE_KEY);
        if (!raw) return normalizeWaveformCacheSettings();
        return normalizeWaveformCacheSettings(JSON.parse(raw));
    } catch {
        return normalizeWaveformCacheSettings();
    }
}

export function writeWaveformCacheSettings(value, storageOverride) {
    const storage = requireSettingsStorage(storageOverride);
    const settings = normalizeWaveformCacheSettings(value);
    storage.setItem(WAVEFORM_CACHE_SETTINGS_STORAGE_KEY, JSON.stringify({
        version: WAVEFORM_CACHE_SETTINGS_VERSION,
        ...settings
    }));
    return settings;
}
