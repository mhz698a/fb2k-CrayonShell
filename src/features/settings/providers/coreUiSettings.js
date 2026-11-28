import {
    requireSettingsStorage,
    resolveSettingsStorage
} from '../storageAccess.js';

export const SIDEBAR_WIDTH_STORAGE_KEY = 'crayonshell.sidebar.width.v1';
export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'crayonshell.sidebar.collapsed.v1';
export const SIDEBAR_VIEW_STORAGE_KEY = 'crayonshell.sidebar.view.v1';
export const REFACETS_HEIGHT_STORAGE_KEY = 'crayonshell.sidebar.refacetsHeight.v1';
export const PROPERTIES_WIDTH_STORAGE_KEY = 'crayonshell.properties.width.v1';
export const PROPERTIES_COLLAPSED_STORAGE_KEY = 'crayonshell.properties.collapsed.v1';

export const DEFAULT_SIDEBAR_WIDTH = 320;
export const MIN_SIDEBAR_WIDTH = 240;
export const MAX_SIDEBAR_WIDTH = 520;
export const DEFAULT_REFACETS_HEIGHT = 68;
export const MIN_REFACETS_HEIGHT = 30;
export const MAX_REFACETS_HEIGHT = 85;
export const DEFAULT_PROPERTIES_WIDTH = 340;
export const MIN_PROPERTIES_WIDTH = 260;
export const MAX_PROPERTIES_WIDTH = 520;

function clampNumber(value, minimum, maximum, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    const number = Number(value);
    return Number.isFinite(number)
        ? Math.max(minimum, Math.min(maximum, number))
        : fallback;
}

function normalizeSidebarWidth(value) {
    const number = Number(value);
    return Number.isFinite(number)
        && number >= MIN_SIDEBAR_WIDTH
        && number <= MAX_SIDEBAR_WIDTH
        ? number
        : DEFAULT_SIDEBAR_WIDTH;
}

function readStorageValue(storage, key) {
    try {
        return storage.getItem(key);
    } catch {
        return null;
    }
}

export function normalizeCoreUiSettings(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
    const sidebar = source.sidebar && typeof source.sidebar === 'object'
        ? source.sidebar
        : {};
    const refacets = source.refacets && typeof source.refacets === 'object'
        ? source.refacets
        : {};
    const properties = source.properties && typeof source.properties === 'object'
        ? source.properties
        : {};

    return {
        sidebar: {
            width: normalizeSidebarWidth(sidebar.width),
            collapsed: typeof sidebar.collapsed === 'boolean' ? sidebar.collapsed : true,
            view: sidebar.view === 'yearbook' || sidebar.view === 'playlists' ? sidebar.view : 'library'
        },
        refacets: {
            height: clampNumber(
                refacets.height,
                MIN_REFACETS_HEIGHT,
                MAX_REFACETS_HEIGHT,
                DEFAULT_REFACETS_HEIGHT
            )
        },
        properties: {
            width: clampNumber(
                properties.width,
                MIN_PROPERTIES_WIDTH,
                MAX_PROPERTIES_WIDTH,
                DEFAULT_PROPERTIES_WIDTH
            ),
            collapsed: typeof properties.collapsed === 'boolean'
                ? properties.collapsed
                : false
        }
    };
}

export function readCoreUiSettings(storageOverride) {
    const storage = resolveSettingsStorage(storageOverride);
    const collapsed = readStorageValue(storage, SIDEBAR_COLLAPSED_STORAGE_KEY);
    const view = readStorageValue(storage, SIDEBAR_VIEW_STORAGE_KEY);
    const propertiesCollapsed = readStorageValue(storage, PROPERTIES_COLLAPSED_STORAGE_KEY);
    return normalizeCoreUiSettings({
        sidebar: {
            width: readStorageValue(storage, SIDEBAR_WIDTH_STORAGE_KEY),
            collapsed: collapsed === null ? true : collapsed === 'true',
            view: view === 'yearbook' || view === 'playlists' ? view : 'library'
        },
        refacets: {
            height: readStorageValue(storage, REFACETS_HEIGHT_STORAGE_KEY)
        },
        properties: {
            width: readStorageValue(storage, PROPERTIES_WIDTH_STORAGE_KEY),
            collapsed: propertiesCollapsed === null ? false : propertiesCollapsed === 'true'
        }
    });
}

export function writeCoreUiSettings(value, storageOverride) {
    const storage = requireSettingsStorage(storageOverride);
    const settings = normalizeCoreUiSettings(value);
    storage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(settings.sidebar.width));
    storage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(settings.sidebar.collapsed));
    storage.setItem(SIDEBAR_VIEW_STORAGE_KEY, settings.sidebar.view);
    storage.setItem(REFACETS_HEIGHT_STORAGE_KEY, String(settings.refacets.height));
    storage.setItem(PROPERTIES_WIDTH_STORAGE_KEY, String(settings.properties.width));
    storage.setItem(PROPERTIES_COLLAPSED_STORAGE_KEY, String(settings.properties.collapsed));
    return settings;
}

export function readSidebarWidth(storage) {
    return readCoreUiSettings(storage).sidebar.width;
}

export function readSidebarCollapsed(storage) {
    return readCoreUiSettings(storage).sidebar.collapsed;
}

export function readSidebarView(storage) {
    return readCoreUiSettings(storage).sidebar.view;
}

export function readRefacetsHeight(storage) {
    return readCoreUiSettings(storage).refacets.height;
}

export function readPropertiesWidth(storage) {
    return readCoreUiSettings(storage).properties.width;
}

export function readPropertiesCollapsed(storage) {
    return readCoreUiSettings(storage).properties.collapsed;
}
