import { getDefaultActivityBarConfig, normalizeActivityBarConfig } from './schema.js';

export const ACTIVITY_BAR_STORAGE_KEY = 'crayonshell.activitybar.config.v1';

export function loadActivityBarConfig() {
    try {
        const saved = window.localStorage.getItem(ACTIVITY_BAR_STORAGE_KEY);
        if (!saved) return getDefaultActivityBarConfig();
        return normalizeActivityBarConfig(JSON.parse(saved));
    } catch (error) {
        console.warn('[ActivityBar] Se usará la configuración predeterminada.', error);
        return getDefaultActivityBarConfig();
    }
}

export function saveActivityBarConfig(config) {
    const normalized = normalizeActivityBarConfig(config);
    window.localStorage.setItem(ACTIVITY_BAR_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
}
