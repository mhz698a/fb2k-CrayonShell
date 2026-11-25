export const EXTERNAL_TOOLS_STORAGE_KEY = 'crayonshell.externalTools.v1';

export const DEFAULT_EXTERNAL_TOOLS_CONFIG = Object.freeze({
    pythonExecutable: 'pythonw.exe',
    frameEtudeScript: '',
    catchEtudeScript: '',
    anuarySignatureScript: '',
    numHandScript: '',
    smbYearScript: '',
    galleryAnuaryScript: '',
    internalBasePath: 'E:\\_Internal',
    recycleBinPath: 'E:\\_Exclude\\l_reallydeleted'
});

const CONFIG_FIELDS = Object.keys(DEFAULT_EXTERNAL_TOOLS_CONFIG);

export function normalizeExternalToolsConfig(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};

    return Object.fromEntries(CONFIG_FIELDS.map((key) => {
        const raw = source[key];
        const normalized = typeof raw === 'string' ? raw.trim() : '';
        return [key, normalized.slice(0, 2048)];
    }));
}

export function loadExternalToolsConfig(storage = window.localStorage) {
    try {
        const raw = storage.getItem(EXTERNAL_TOOLS_STORAGE_KEY);
        if (!raw) return { ...DEFAULT_EXTERNAL_TOOLS_CONFIG };
        return {
            ...DEFAULT_EXTERNAL_TOOLS_CONFIG,
            ...normalizeExternalToolsConfig(JSON.parse(raw))
        };
    } catch {
        return { ...DEFAULT_EXTERNAL_TOOLS_CONFIG };
    }
}

export function saveExternalToolsConfig(value, storage = window.localStorage) {
    const config = normalizeExternalToolsConfig(value);
    storage.setItem(EXTERNAL_TOOLS_STORAGE_KEY, JSON.stringify(config));
    return config;
}
