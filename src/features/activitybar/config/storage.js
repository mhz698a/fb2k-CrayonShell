import { getDefaultActivityBarConfig, normalizeActivityBarConfig } from './schema.js';

export const ACTIVITY_BAR_STORAGE_KEY = 'crayonshell.activitybar.config.v1';

function migrateLegacyDefault(config) {
    const isPreviousDefault = config.buttons.length === 1
        && config.buttons[0].id === 'ui.toggleSidebar'
        && config.buttons[0].actionId === 'ui.toggleSidebar'
        && config.buttons[0].label === 'Panel izquierdo'
        && config.buttons[0].icon === 'columns';

    if (!isPreviousDefault) return config;

    return normalizeActivityBarConfig({
        ...config,
        buttons: [
            {
                ...config.buttons[0],
                label: 'Biblioteca'
            },
            {
                id: 'legacy.yearbookExplorer',
                actionId: 'legacy.yearbookExplorer',
                label: 'Yearbook Explorer',
                icon: 'calendar'
            }
        ]
    });
}

export function loadActivityBarConfig(storage = window.localStorage) {
    try {
        const saved = storage.getItem(ACTIVITY_BAR_STORAGE_KEY);
        if (!saved) return getDefaultActivityBarConfig();
        return migrateLegacyDefault(normalizeActivityBarConfig(JSON.parse(saved)));
    } catch (error) {
        console.warn('[ActivityBar] Se usará la configuración predeterminada.', error);
        return getDefaultActivityBarConfig();
    }
}

export function saveActivityBarConfig(config, storage = window.localStorage) {
    const normalized = normalizeActivityBarConfig(config);
    storage.setItem(ACTIVITY_BAR_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
}
