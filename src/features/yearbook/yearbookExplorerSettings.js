export const YEARBOOK_EXPLORER_EXPANDED_STORAGE_KEY = 'crayonshell.yearbookExplorer.expanded.v1';

const MAX_EXPANDED_PATHS = 500;
const MAX_RELATIVE_PATH_LENGTH = 1024;

function normalizeWindowsPath(value) {
    return String(value || '').trim().replace(/\//g, '\\').replace(/\\+$/, '');
}

function normalizeRelativePath(value) {
    if (typeof value !== 'string') return '';
    const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) return '';
    const parts = normalized.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..')) return '';
    return normalized.slice(0, MAX_RELATIVE_PATH_LENGTH);
}

function getRelativePath(rootPath, absolutePath) {
    const root = normalizeWindowsPath(rootPath);
    const candidate = normalizeWindowsPath(absolutePath);
    if (!root || !candidate) return '';

    const rootLower = root.toLocaleLowerCase();
    const candidateLower = candidate.toLocaleLowerCase();
    if (candidateLower === rootLower) return '';

    const prefix = root + '\\';
    if (!candidateLower.startsWith(prefix.toLocaleLowerCase())) return '';
    return normalizeRelativePath(candidate.slice(prefix.length));
}

function joinRootAndRelativePath(rootPath, relativePath) {
    const root = normalizeWindowsPath(rootPath);
    const relative = normalizeRelativePath(relativePath);
    if (!root || !relative) return '';
    return root + '\\' + relative.replace(/\//g, '\\');
}

function parseStoredExpansion(storage) {
    try {
        const saved = JSON.parse(storage.getItem(YEARBOOK_EXPLORER_EXPANDED_STORAGE_KEY) || '{}');
        return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    } catch {
        return {};
    }
}

export function normalizeYearbookExplorerSettings(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
    const seen = new Set();
    const expandedRelativePaths = [];

    if (Array.isArray(source.expandedRelativePaths)) {
        for (const entry of source.expandedRelativePaths) {
            const path = normalizeRelativePath(entry);
            if (!path || seen.has(path.toLocaleLowerCase())) continue;
            seen.add(path.toLocaleLowerCase());
            expandedRelativePaths.push(path);
            if (expandedRelativePaths.length >= MAX_EXPANDED_PATHS) break;
        }
    }

    return { expandedRelativePaths };
}

export function readYearbookExpandedPaths(rootPath, storage = window.localStorage) {
    const saved = parseStoredExpansion(storage);
    const storedRootPath = normalizeWindowsPath(saved.rootPath || rootPath);
    const activeRootPath = normalizeWindowsPath(rootPath);

    if (!storedRootPath || storedRootPath.toLocaleLowerCase() !== activeRootPath.toLocaleLowerCase()
        || !Array.isArray(saved.paths)) {
        return new Set();
    }

    return new Set(saved.paths
        .map((path) => getRelativePath(storedRootPath, path))
        .filter(Boolean)
        .map((path) => joinRootAndRelativePath(activeRootPath, path)));
}

export function readYearbookExplorerSettings(rootPath, storage = window.localStorage) {
    const saved = parseStoredExpansion(storage);
    const sourceRootPath = normalizeWindowsPath(saved.rootPath || rootPath);
    const activeRootPath = normalizeWindowsPath(rootPath);
    if (!sourceRootPath
        || sourceRootPath.toLocaleLowerCase() !== activeRootPath.toLocaleLowerCase()) {
        return { expandedRelativePaths: [] };
    }

    const expandedRelativePaths = Array.isArray(saved.paths)
        ? saved.paths
            .map((path) => getRelativePath(sourceRootPath, path))
            .filter(Boolean)
        : [];

    return normalizeYearbookExplorerSettings({ expandedRelativePaths });
}

export function writeYearbookExplorerSettings(value, rootPath, storage = window.localStorage) {
    const settings = normalizeYearbookExplorerSettings(value);
    const root = normalizeWindowsPath(rootPath);
    const paths = settings.expandedRelativePaths
        .map((path) => joinRootAndRelativePath(root, path))
        .filter(Boolean);

    storage.setItem(YEARBOOK_EXPLORER_EXPANDED_STORAGE_KEY, JSON.stringify({
        rootPath: root,
        paths
    }));
    return settings;
}
