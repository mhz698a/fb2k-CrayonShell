export const SIDEBAR_WIDTH_STORAGE_KEY = 'crayonshell.sidebar.width.v1';
export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'crayonshell.sidebar.collapsed.v1';
export const SIDEBAR_VIEW_STORAGE_KEY = 'crayonshell.sidebar.view.v1';
export const REFACETS_HEIGHT_STORAGE_KEY = 'crayonshell.sidebar.refacetsHeight.v1';

export const DEFAULT_SIDEBAR_WIDTH = 320;
export const MIN_SIDEBAR_WIDTH = 240;
export const MAX_SIDEBAR_WIDTH = 520;
export const DEFAULT_REFACETS_HEIGHT = 68;
export const MIN_REFACETS_HEIGHT = 30;
export const MAX_REFACETS_HEIGHT = 85;

function clampNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number)
        ? Math.max(minimum, Math.min(maximum, number))
        : fallback;
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

    return {
        sidebar: {
            width: clampNumber(
                sidebar.width,
                MIN_SIDEBAR_WIDTH,
                MAX_SIDEBAR_WIDTH,
                DEFAULT_SIDEBAR_WIDTH
            ),
            collapsed: typeof sidebar.collapsed === 'boolean' ? sidebar.collapsed : true,
            view: sidebar.view === 'yearbook' ? 'yearbook' : 'library'
        },
        refacets: {
            height: clampNumber(
                refacets.height,
                MIN_REFACETS_HEIGHT,
                MAX_REFACETS_HEIGHT,
                DEFAULT_REFACETS_HEIGHT
            )
        }
    };
}

export function readCoreUiSettings(storage = window.localStorage) {
    const collapsed = readStorageValue(storage, SIDEBAR_COLLAPSED_STORAGE_KEY);
    const view = readStorageValue(storage, SIDEBAR_VIEW_STORAGE_KEY);
    return normalizeCoreUiSettings({
        sidebar: {
            width: readStorageValue(storage, SIDEBAR_WIDTH_STORAGE_KEY),
            collapsed: collapsed === null ? true : collapsed === 'true',
            view: view === 'yearbook' ? 'yearbook' : 'library'
        },
        refacets: {
            height: readStorageValue(storage, REFACETS_HEIGHT_STORAGE_KEY)
        }
    });
}

export function writeCoreUiSettings(value, storage = window.localStorage) {
    const settings = normalizeCoreUiSettings(value);
    storage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(settings.sidebar.width));
    storage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(settings.sidebar.collapsed));
    storage.setItem(SIDEBAR_VIEW_STORAGE_KEY, settings.sidebar.view);
    storage.setItem(REFACETS_HEIGHT_STORAGE_KEY, String(settings.refacets.height));
    return settings;
}

export function readSidebarWidth(storage = window.localStorage) {
    return readCoreUiSettings(storage).sidebar.width;
}

export function readSidebarCollapsed(storage = window.localStorage) {
    return readCoreUiSettings(storage).sidebar.collapsed;
}

export function readSidebarView(storage = window.localStorage) {
    return readCoreUiSettings(storage).sidebar.view;
}

export function readRefacetsHeight(storage = window.localStorage) {
    return readCoreUiSettings(storage).refacets.height;
}
