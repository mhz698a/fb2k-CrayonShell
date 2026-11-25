import {
    requireSettingsStorage,
    resolveSettingsStorage
} from '../settings/storageAccess.js';

export const REFACETS_PRESENTATION_STORAGE_KEY = 'crayonshell.refacets.presentation.v1';
export const REFACETS_COLUMN_SPLIT_STORAGE_KEY = 'crayonshell.refacets.columnSplit.v1';
export const REFACETS_SELECTION_STORAGE_KEY = 'crayonshell.refacets.selection.v1';

export const DEFAULT_REFACETS_PRESENTATION = Object.freeze({
    showHeader: true,
    showFooter: true,
    yearsCount: true,
    subfoldersCount: true
});

export const DEFAULT_REFACETS_COLUMN_SPLIT = 50;
export const MIN_REFACETS_COLUMN_SPLIT = 25;
export const MAX_REFACETS_COLUMN_SPLIT = 75;
const MAX_SELECTION_VALUES = 1000;
const MAX_SELECTION_VALUE_LENGTH = 512;

function getObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeSelectionList(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const normalized = [];

    for (const entry of value) {
        if (typeof entry !== 'string') continue;
        const item = entry.slice(0, MAX_SELECTION_VALUE_LENGTH);
        if (!item.trim() || seen.has(item)) continue;
        seen.add(item);
        normalized.push(item);
        if (normalized.length >= MAX_SELECTION_VALUES) break;
    }

    return normalized;
}

export function normalizeRefacetsPresentation(value = {}) {
    const source = getObject(value);
    return Object.fromEntries(Object.entries(DEFAULT_REFACETS_PRESENTATION).map(([key, fallback]) => [
        key,
        typeof source[key] === 'boolean' ? source[key] : fallback
    ]));
}

export function normalizeRefacetsColumnSplit(value) {
    if (value === null || value === undefined || value === '') {
        return DEFAULT_REFACETS_COLUMN_SPLIT;
    }
    const number = Number(value);
    return Number.isFinite(number)
        ? Math.round(Math.max(MIN_REFACETS_COLUMN_SPLIT, Math.min(MAX_REFACETS_COLUMN_SPLIT, number)))
        : DEFAULT_REFACETS_COLUMN_SPLIT;
}

export function normalizeRefacetsSelection(value = {}) {
    const source = getObject(value);
    return {
        years: normalizeSelectionList(source.years),
        subfolders: normalizeSelectionList(source.subfolders)
    };
}

export function readRefacetsPresentation(storageOverride) {
    const storage = resolveSettingsStorage(storageOverride);
    try {
        return normalizeRefacetsPresentation(JSON.parse(
            storage.getItem(REFACETS_PRESENTATION_STORAGE_KEY) || '{}'
        ));
    } catch {
        return normalizeRefacetsPresentation();
    }
}

export function readRefacetsColumnSplit(storageOverride) {
    const storage = resolveSettingsStorage(storageOverride);
    try {
        const value = storage.getItem(REFACETS_COLUMN_SPLIT_STORAGE_KEY);
        return value === null
            ? DEFAULT_REFACETS_COLUMN_SPLIT
            : normalizeRefacetsColumnSplit(value);
    } catch {
        return DEFAULT_REFACETS_COLUMN_SPLIT;
    }
}

export function readRefacetsSelection(storageOverride) {
    const storage = resolveSettingsStorage(storageOverride);
    try {
        return normalizeRefacetsSelection(JSON.parse(
            storage.getItem(REFACETS_SELECTION_STORAGE_KEY) || '{}'
        ));
    } catch {
        return normalizeRefacetsSelection();
    }
}

export function writeRefacetsSettings(value, storageOverride) {
    const storage = requireSettingsStorage(storageOverride);
    const source = getObject(value);
    const settings = {
        presentation: normalizeRefacetsPresentation(source.presentation),
        columnSplit: normalizeRefacetsColumnSplit(source.columnSplit),
        selection: normalizeRefacetsSelection(source.selection)
    };

    storage.setItem(REFACETS_PRESENTATION_STORAGE_KEY, JSON.stringify(settings.presentation));
    storage.setItem(REFACETS_COLUMN_SPLIT_STORAGE_KEY, String(settings.columnSplit));
    storage.setItem(REFACETS_SELECTION_STORAGE_KEY, JSON.stringify(settings.selection));
    return settings;
}
