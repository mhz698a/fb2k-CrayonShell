import {
    requireSettingsStorage,
    resolveSettingsStorage
} from '../settings/storageAccess.js';

export const DSP_AUTO_PRESET_SETTINGS_STORAGE_KEY = 'crayonshell.dsp.auto-preset.settings.v1';
export const DSP_AUTO_PRESET_SETTINGS_VERSION = 1;

let nextRuleId = 0;

function normalizePresetName(value, fieldName) {
    const name = String(value ?? '').trim();
    if (name.length > 200) {
        throw new TypeError(fieldName + ' no puede superar 200 caracteres.');
    }
    return name;
}

function normalizeRule(rule, kind, seenPaths) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
        throw new TypeError('Cada regla DSP debe ser un objeto.');
    }

    const id = String(rule.id || '').trim();
    const path = String(rule.path || '').trim();
    const presetName = normalizePresetName(rule.presetName, 'El nombre del DSP Preset');

    if (!id || id.length > 100) {
        throw new TypeError('Cada regla DSP debe tener un identificador estable.');
    }
    if (!path || path.length > 32768) {
        throw new TypeError('Cada regla DSP debe contener una ruta válida.');
    }

    const normalizedPath = normalizeDspRulePath(path);
    if (seenPaths.has(normalizedPath)) {
        throw new TypeError('Existe más de una regla para la misma ruta: ' + path);
    }
    seenPaths.add(normalizedPath);

    return { id, path, presetName, kind };
}

export function normalizeDspRulePath(path) {
    let normalized = String(path || '').trim().replace(/\//g, '\\');
    normalized = normalized.replace(/\\+$/, '');
    return normalized.toLocaleLowerCase('en-US');
}

export function normalizeDspAutoPresetSettings(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};

    const folderRulesSource = Array.isArray(source.folderRules) ? source.folderRules : [];
    const trackRulesSource = Array.isArray(source.trackRules) ? source.trackRules : [];

    if (folderRulesSource.length > 500 || trackRulesSource.length > 2000) {
        throw new TypeError('El administrador DSP supera el límite permitido de reglas.');
    }

    const folderPaths = new Set();
    const trackPaths = new Set();

    return {
        defaultPreset: normalizePresetName(source.defaultPreset, 'El DSP Preset predeterminado'),
        folderRules: folderRulesSource.map((rule) => normalizeRule(rule, 'folder', folderPaths))
            .map(({ id, path, presetName }) => ({ id, path, presetName })),
        trackRules: trackRulesSource.map((rule) => normalizeRule(rule, 'track', trackPaths))
            .map(({ id, path, presetName }) => ({ id, path, presetName }))
    };
}

export function readDspAutoPresetSettings(storageOverride) {
    const storage = resolveSettingsStorage(storageOverride);
    if (!storage || typeof storage.getItem !== 'function') {
        return normalizeDspAutoPresetSettings();
    }

    try {
        const raw = storage.getItem(DSP_AUTO_PRESET_SETTINGS_STORAGE_KEY);
        if (!raw) return normalizeDspAutoPresetSettings();
        const parsed = JSON.parse(raw);
        if (parsed?.version !== undefined && parsed.version !== DSP_AUTO_PRESET_SETTINGS_VERSION) {
            return normalizeDspAutoPresetSettings();
        }
        return normalizeDspAutoPresetSettings(parsed);
    } catch {
        return normalizeDspAutoPresetSettings();
    }
}

export function writeDspAutoPresetSettings(value, storageOverride) {
    const storage = requireSettingsStorage(storageOverride);
    const settings = normalizeDspAutoPresetSettings(value);
    storage.setItem(DSP_AUTO_PRESET_SETTINGS_STORAGE_KEY, JSON.stringify({
        version: DSP_AUTO_PRESET_SETTINGS_VERSION,
        ...settings
    }));
    return settings;
}

export function createDspAutoPresetRule(path, presetName = '') {
    const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : 'dsp-rule-' + Date.now().toString(36) + '-' + (++nextRuleId).toString(36);

    return {
        id,
        path: String(path || '').trim(),
        presetName: String(presetName || '').trim()
    };
}
