function requireSuccessfulResult(result, operation) {
    if (!result) {
        throw new Error(operation + ' no devolvió una respuesta.');
    }
    if (result.success === false) {
        const error = new Error(result.error || (operation + ' falló.'));
        error.code = result.code || 'UNKNOWN_ERROR';
        error.details = result.details;
        throw error;
    }
    return result;
}

export function joinWindowsPath(...parts) {
    return parts
        .map((part) => String(part || '').replace(/^[\\/]+|[\\/]+$/g, ''))
        .filter(Boolean)
        .join('\\');
}

export function sortDirectoryNames(names) {
    return [...names].sort((a, b) => String(a).localeCompare(b, undefined, {
        numeric: true,
        sensitivity: 'base'
    }));
}

export function getYearDirectories(names, currentYear = new Date().getFullYear()) {
    return sortDirectoryNames(names).filter((name) => {
        const value = String(name);
        if (!/^\d{4}$/.test(value)) return false;
        const year = Number(value);
        return year >= 1999 && year <= currentYear;
    });
}

export function isAlbumContainer(name) {
    return /\.\s*album/i.test(String(name || ''));
}

export async function listYearbookDirectories(sdk, path) {
    if (typeof sdk?.file?.list !== 'function') {
        throw new Error('El SDK no proporciona file.list.');
    }

    const result = requireSuccessfulResult(await sdk.file.list(path), 'file.list');
    const directories = Array.isArray(result.directories) ? result.directories : [];
    const names = directories.map((entry) => {
        const value = typeof entry === 'string'
            ? entry
            : String(entry?.name || entry?.path || '');
        return value.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
    }).filter(Boolean);

    return sortDirectoryNames(names);
}

export async function openYearbookDirectory(sdk, settings, path, { gallery = false } = {}) {
    const targetPath = String(path || '').trim();
    if (!targetPath) throw new Error('No hay una carpeta seleccionada para abrir.');

    if (gallery) {
        const pythonExecutable = String(settings?.pythonExecutable || 'pythonw.exe').trim();
        const scriptPath = String(settings?.galleryAnuaryScript || '').trim();
        if (!pythonExecutable) {
            throw new Error('Configura el ejecutable de Python en "Configurar herramientas externas".');
        }
        if (!scriptPath) {
            throw new Error('Configura la ruta de GalleryAnuary en "Configurar herramientas externas".');
        }

        return requireSuccessfulResult(
            await sdk.shell.spawn(pythonExecutable, {
                args: [scriptPath, targetPath],
                hidden: false
            }),
            'shell.spawn'
        );
    }

    return requireSuccessfulResult(
        await sdk.shell.showInExplorer(targetPath),
        'shell.showInExplorer'
    );
}
