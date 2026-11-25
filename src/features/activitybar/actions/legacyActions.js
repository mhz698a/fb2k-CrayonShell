import { getFooSdk, hasNativeBridge } from '../../../services/fooSdk.js';

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


function getExternalToolSettings(context) {
    return context?.externalTools && typeof context.externalTools === 'object'
        ? context.externalTools
        : {};
}

function getNativeTrackPath(track) {
    const path = String(track?.absolutePath || track?.path || '').trim();
    if (!/^(?:[a-z]:[\\\\/]|\\\\\\\\)/i.test(path)) {
        throw new Error('La pista seleccionada no tiene una ruta local de Windows utilizable.');
    }
    return path;
}

async function getFirstSelectedTrackPath(context, sdk) {
    const tracks = await getSelectedTracks(context, sdk);
    return getNativeTrackPath(tracks[0]);
}

async function spawnConfiguredPythonTool(context, sdk, scriptKey, args = []) {
    const settings = getExternalToolSettings(context);
    const pythonExecutable = String(settings.pythonExecutable || 'pythonw.exe').trim();
    const scriptPath = String(settings[scriptKey] || '').trim();
    if (!pythonExecutable) {
        throw new Error('Configura el ejecutable de Python desde "Configurar herramientas externas".');
    }
    if (!scriptPath) {
        throw new Error('Falta configurar la ruta del script en "Configurar herramientas externas".');
    }

    const result = await sdk.shell.spawn(pythonExecutable, {
        args: [scriptPath, ...args.map((arg) => String(arg))],
        hidden: true
    });
    return requireSuccessfulResult(result, 'shell.spawn');
}

function requireActivePlaylist(context) {
    const playlistGuid = String(context?.activePlaylistGuid || '').trim();
    if (!playlistGuid) {
        throw new Error('No hay una playlist activa.');
    }
    return playlistGuid;
}

async function getSelectedTracks(context, sdk) {
    const playlistGuid = requireActivePlaylist(context);
    const result = requireSuccessfulResult(
        await sdk.playlist.getSelectedTracks(playlistGuid),
        'playlist.getSelectedTracks'
    );
    const tracks = Array.isArray(result.tracks) ? result.tracks : [];
    if (!tracks.length) {
        throw new Error('No hay archivos seleccionados en la playlist activa.');
    }
    return tracks;
}

function getFileName(path, includeExtension = true) {
    const value = String(path || '').replace(/\|subsong:\d+$/i, '');
    const decoded = (() => {
        try {
            return decodeURIComponent(value);
        } catch {
            return value;
        }
    })();
    const name = decoded.replace(/\\/g, '/').split('/').pop() || '';
    if (includeExtension) return name;
    const extensionIndex = name.lastIndexOf('.');
    return extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
}

async function copySelectedTracks(context, sdk, getValue, label) {
    const tracks = await getSelectedTracks(context, sdk);
    const value = tracks.map(getValue).filter((item) => item !== '').join('\r\n');
    if (!value) throw new Error('La selección no contiene valores para copiar.');
    requireSuccessfulResult(await sdk.clipboard.write(value), 'clipboard.write');
    return { count: tracks.length, label };
}

async function runContextCommand(sdk, command) {
    return requireSuccessfulResult(
        await sdk.menu.runContextCommand(command),
        'menu.runContextCommand'
    );
}

async function runMainMenuCommand(sdk, command) {
    return requireSuccessfulResult(
        await sdk.menu.runMainMenuCommand(command),
        'menu.runMainMenuCommand'
    );
}

function buildGoogleQueries(track) {
    const filename = getFileName(track.path || track.absolutePath, false);
    const title = String(track.title || '')
        .replace(/\s*\(ID:\s*\d+\)\s*$/, '')
        .trim();
    const artist = String(track.artist || track.albumArtist || '').trim();
    const titleArtist = [title, artist].filter(Boolean).join(' ').trim();
    const base = titleArtist || filename;

    return [
        { id: 'filename', label: 'Buscar por nombre de archivo', query: filename },
        { id: 'filename-lyrics', label: 'Nombre de archivo + lyrics', query: filename ? filename + ' lyrics' : '' },
        { id: 'filename-release', label: 'Nombre de archivo + release date', query: filename ? filename + ' release date' : '' },
        { id: 'title-artist', label: 'Buscar por título + artista', query: base },
        { id: 'title-artist-lyrics', label: 'Título + artista + lyrics', query: base ? base + ' lyrics' : '' },
        { id: 'title-artist-release', label: 'Título + artista + release date', query: base ? base + ' release date' : '' }
    ].filter((item) => item.query);
}

async function openGoogleSearcher(context, sdk) {
    const tracks = await getSelectedTracks(context, sdk);
    const track = tracks[0];
    const items = buildGoogleQueries(track).map((item) => ({
        id: item.id,
        label: item.label
    }));
    const selectedId = await sdk.menu.popup(items, undefined, {
        windowModel: 'contentSized'
    });
    if (!selectedId) return { cancelled: true };

    const selected = buildGoogleQueries(track).find((item) => item.id === selectedId);
    if (!selected) return { cancelled: true };

    const url = 'https://www.google.com/search?q=' + encodeURIComponent(selected.query);
    requireSuccessfulResult(await sdk.shell.openExternal(url), 'shell.openExternal');
    return { query: selected.query, url };
}

async function openNewgroundsPage(context, sdk) {
    const tracks = await getSelectedTracks(context, sdk);
    const track = tracks[0];
    const fileName = getFileName(track.path || track.absolutePath, false);
    if (!/\s\(\u03b7\)$/i.test(fileName)) {
        throw new Error('El nombre del archivo debe terminar con " (η)".');
    }

    const title = String(track.title || '').trim();
    const match = title.match(/\(ID:\s*(\d+)\)$/i);
    if (!match) {
        throw new Error('El título de la pista debe terminar con "(ID: XXXXX)".');
    }

    const url = 'https://www.newgrounds.com/audio/listen/' + match[1];
    requireSuccessfulResult(await sdk.shell.openExternal(url), 'shell.openExternal');
    return { url };
}


function joinWindowsPath(...parts) {
    return parts
        .map((part) => String(part || '').replace(/^[\\/]+|[\\/]+$/g, ''))
        .filter(Boolean)
        .join('\\');
}

async function listSubdirectories(sdk, path) {
    const result = requireSuccessfulResult(
        await sdk.file.list(path),
        'file.list'
    );
    return Array.isArray(result.directories) ? result.directories : [];
}

async function showYearbookExplorer(context, sdk) {
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let year = 1999; year <= currentYear; year += 1) {
        years.push({ id: 'year:' + year, label: String(year) });
    }

    const selectedYear = await sdk.menu.popup(years, undefined, {
        windowModel: 'contentSized'
    });
    if (!selectedYear || !selectedYear.startsWith('year:')) {
        return { cancelled: true };
    }

    const year = Number(selectedYear.slice(5));
    if (!Number.isInteger(year) || year < 1999 || year > currentYear) {
        throw new Error('El año seleccionado no es válido.');
    }

    const internalBasePath = String(getExternalToolSettings(context).internalBasePath || '').trim();
    if (!internalBasePath) {
        throw new Error('Configura la raíz de Yearbook Explorer en "Configurar herramientas externas".');
    }
    const yearRoot = joinWindowsPath(internalBasePath, String(year));
    const folders = (await listSubdirectories(sdk, yearRoot))
        .sort((a, b) => String(a).localeCompare(String(b), undefined, {
            numeric: true,
            sensitivity: 'base'
        }));

    const folderItems = [
        { id: 'open-year-root', label: '...' },
        { type: 'separator' },
        ...(folders.length
            ? folders.map((folder, index) => ({
                id: 'folder:' + index,
                label: folder
            }))
            : [{ id: 'no-folders', label: '(sin carpetas)', enabled: false }])
    ];

    const selectedFolder = await sdk.menu.popup(folderItems, undefined, {
        windowModel: 'contentSized'
    });
    if (!selectedFolder) return { cancelled: true };

    if (selectedFolder === 'open-year-root') {
        return requireSuccessfulResult(
            await sdk.shell.showInExplorer(yearRoot),
            'shell.showInExplorer'
        );
    }
    if (selectedFolder === 'no-folders') return { cancelled: true };

    const folderIndex = Number(selectedFolder.slice('folder:'.length));
    if (!Number.isInteger(folderIndex) || folderIndex < 0 || folderIndex >= folders.length) {
        return { cancelled: true };
    }

    const folderName = folders[folderIndex];
    const folderPath = joinWindowsPath(yearRoot, folderName);
    if (folderName.toLocaleLowerCase().includes('.album')) {
        return spawnConfiguredPythonTool(
            context,
            sdk,
            'galleryAnuaryScript',
            [folderPath]
        );
    }
    const children = (await listSubdirectories(sdk, folderPath))
        .sort((a, b) => String(a).localeCompare(String(b), undefined, {
            numeric: true,
            sensitivity: 'base'
        }));

    const childItems = [
        { id: 'open-parent-folder', label: '...' },
        { type: 'separator' },
        ...(children.length
            ? children.map((folder, index) => ({
                id: 'child:' + index,
                label: folder
            }))
            : [{ id: 'no-children', label: '(sin subcarpetas)', enabled: false }])
    ];

    const selectedChild = await sdk.menu.popup(childItems, undefined, {
        windowModel: 'contentSized'
    });
    if (!selectedChild) return { cancelled: true };

    let targetPath = '';
    if (selectedChild === 'open-parent-folder') {
        targetPath = folderPath;
    } else if (selectedChild.startsWith('child:')) {
        const childIndex = Number(selectedChild.slice('child:'.length));
        if (Number.isInteger(childIndex) && childIndex >= 0 && childIndex < children.length) {
            targetPath = joinWindowsPath(folderPath, children[childIndex]);
        }
    }

    if (!targetPath) return { cancelled: true };

    return requireSuccessfulResult(
        await sdk.shell.showInExplorer(targetPath),
        'shell.showInExplorer'
    );
}

async function showNumHandExtrasMenu(context, sdk) {
    const items = [
        { id: 'copy-names', label: 'Copy Names' },
        { id: 'copy-paths', label: 'Copy Paths' },
        { id: 'numhand', label: 'Open NumHand For This Folder' },
        { id: 'smb-year', label: 'Connect current year to SMB' },
        { id: 'explore-directory', label: 'Explore folder of current song' },
        { type: 'separator' },
        { id: 'recycle-bin', label: 'Open Recycle Bin' }
    ];
    const selectedId = await sdk.menu.popup(items, undefined, {
        windowModel: 'contentSized'
    });

    switch (selectedId) {
        case 'copy-names':
            return copySelectedTracks(
                context,
                sdk,
                (track) => getFileName(track.path || track.absolutePath, true),
                'nombres'
            );
        case 'copy-paths':
            return copySelectedTracks(
                context,
                sdk,
                (track) => String(track.absolutePath || track.path || ''),
                'rutas'
            );
        case 'numhand': {
            const trackPath = await getFirstSelectedTrackPath(context, sdk);
            return spawnConfiguredPythonTool(context, sdk, 'numHandScript', [trackPath]);
        }
        case 'smb-year': {
            const trackPath = await getFirstSelectedTrackPath(context, sdk);
            return spawnConfiguredPythonTool(context, sdk, 'smbYearScript', [trackPath]);
        }
        case 'explore-directory':
            return runContextCommand(sdk, 'Run service/Explore Directory');
        case 'recycle-bin': {
            const recycleBinPath = String(getExternalToolSettings(context).recycleBinPath || '').trim();
            if (!recycleBinPath) {
                throw new Error('Configura la carpeta de reciclaje en "Configurar herramientas externas".');
            }
            return requireSuccessfulResult(
                await sdk.shell.showInExplorer(recycleBinPath),
                'shell.showInExplorer'
            );
        }
        default:
            return { cancelled: true };
    }
}

export function createLegacyActivityActions({
    getSdk = getFooSdk,
    isNativeAvailable = hasNativeBridge
} = {}) {
    const nativeAvailability = (context) => ({
        available: isNativeAvailable() && context?.isDemoMode !== true,
        reason: 'Esta acción requiere CrayonShell dentro de foobar2000/WebView2.'
    });
    const selectionAvailability = (context) => {
        const host = nativeAvailability(context);
        if (!host.available) return host;
        return {
            available: Boolean(context?.activePlaylistGuid),
            reason: 'No hay una playlist activa.'
        };
    };

    return [
        {
            id: 'legacy.shazam',
            label: 'Buscar con Shazam',
            category: 'Servicios de foobar2000',
            description: 'Ejecuta el servicio Search with Shazam sobre la pista actual.',
            defaultIcon: 'music',
            isAvailable: nativeAvailability,
            execute: () => runContextCommand(getSdk(), 'Run service/Search with Shazam')
        },
        {
            id: 'legacy.mp3tag.editFolder',
            label: 'Editar carpeta con mp3tag',
            category: 'Servicios de foobar2000',
            description: 'Ejecuta el servicio Edit Folder with mp3Tag sobre la pista o selección actual.',
            defaultIcon: 'tags',
            isAvailable: nativeAvailability,
            execute: () => runContextCommand(getSdk(), 'Run service/Edit Folder with mp3Tag')
        },
        {
            id: 'legacy.exploreDirectory',
            label: 'Explorar carpeta de la pista',
            category: 'Servicios de foobar2000',
            description: 'Ejecuta el servicio nativo Explore Directory.',
            defaultIcon: 'folder-open',
            isAvailable: nativeAvailability,
            execute: () => runContextCommand(getSdk(), 'Run service/Explore Directory')
        },
        {
            id: 'legacy.effects.playbackRate',
            label: 'DSP: Playback Rate',
            category: 'DSP y reproducción',
            description: 'Abre el panel Playback Rate de foobar2000.',
            defaultIcon: 'tachometer',
            isAvailable: nativeAvailability,
            execute: () => runMainMenuCommand(getSdk(), 'View/DSP/Playback Rate')
        },
        {
            id: 'legacy.effects.tempo',
            label: 'DSP: Tempo',
            category: 'DSP y reproducción',
            description: 'Abre el panel Tempo de foobar2000.',
            defaultIcon: 'sliders',
            isAvailable: nativeAvailability,
            execute: () => runMainMenuCommand(getSdk(), 'View/DSP/Tempo')
        },
        {
            id: 'legacy.effects.iirFilter',
            label: 'DSP: IIR Filter',
            category: 'DSP y reproducción',
            description: 'Abre el panel IIR Filter de foobar2000.',
            defaultIcon: 'filter',
            isAvailable: nativeAvailability,
            execute: () => runMainMenuCommand(getSdk(), 'View/DSP/IIR Filter')
        },
        {
            id: 'legacy.youtube.omniget',
            label: 'Descargar con Omniget',
            category: 'Servicios de foobar2000',
            description: 'Ejecuta el servicio Download with Omniget.',
            defaultIcon: 'download',
            isAvailable: nativeAvailability,
            execute: () => runContextCommand(getSdk(), 'Run service/Download with Omniget')
        },
        {
            id: 'legacy.youtube.searcher',
            label: 'YouTube Searcher',
            category: 'Servicios de foobar2000',
            description: 'Abre YouTube Source / Search on Site.',
            defaultIcon: 'youtube-play',
            isAvailable: nativeAvailability,
            execute: () => runMainMenuCommand(getSdk(), 'View/Youtube Source/Search on Site')
        },
        {
            id: 'legacy.launchFrameEtude',
            label: 'Abrir FrameEtude',
            category: 'Herramientas externas',
            description: 'Inicia el script configurado de FrameEtude.',
            defaultIcon: 'film',
            isAvailable: nativeAvailability,
            execute: (context) => spawnConfiguredPythonTool(context, getSdk(), 'frameEtudeScript')
        },
        {
            id: 'legacy.launchCatchEtude',
            label: 'Abrir CatchEtude',
            category: 'Herramientas externas',
            description: 'Inicia el script configurado de CatchEtude.',
            defaultIcon: 'download',
            isAvailable: nativeAvailability,
            execute: (context) => spawnConfiguredPythonTool(context, getSdk(), 'catchEtudeScript')
        },
        {
            id: 'legacy.launchAnuarySignature',
            label: 'Abrir AnuarySignature',
            category: 'Herramientas externas',
            description: 'Inicia el script configurado de AnuarySignature.',
            defaultIcon: 'pencil-square-o',
            isAvailable: nativeAvailability,
            execute: (context) => spawnConfiguredPythonTool(context, getSdk(), 'anuarySignatureScript')
        },
        {
            id: 'legacy.launchNumHand',
            label: 'Abrir NumHand para el archivo seleccionado',
            category: 'Herramientas externas',
            description: 'Inicia NumHand pasando la ruta local del primer archivo seleccionado.',
            defaultIcon: 'sort-numeric-asc',
            isAvailable: selectionAvailability,
            execute: async (context) => {
                const sdk = getSdk();
                const trackPath = await getFirstSelectedTrackPath(context, sdk);
                return spawnConfiguredPythonTool(context, sdk, 'numHandScript', [trackPath]);
            }
        },
        {
            id: 'legacy.connectYearToSmb',
            label: 'Conectar año a SMB',
            category: 'Herramientas externas',
            description: 'Abre el diálogo SMB pasando la ruta local del archivo seleccionado.',
            defaultIcon: 'folder-open',
            isAvailable: selectionAvailability,
            execute: async (context) => {
                const sdk = getSdk();
                const trackPath = await getFirstSelectedTrackPath(context, sdk);
                return spawnConfiguredPythonTool(context, sdk, 'smbYearScript', [trackPath]);
            }
        },
        {
            id: 'legacy.yearbookExplorer',
            label: 'Yearbook Explorer',
            category: 'Archivos y selección',
            description: 'Navega por los años y subcarpetas de la raíz configurable y abre carpetas en Explorer o GalleryAnuary.',
            defaultIcon: 'calendar',
            isAvailable: nativeAvailability,
            execute: (context) => showYearbookExplorer(context, getSdk())
        },
        {
            id: 'legacy.googleSearcherSongs',
            label: 'Google Song Searcher',
            category: 'Búsqueda web',
            description: 'Abre un menú para buscar la pista seleccionada por nombre, título, artista, lyrics o fecha.',
            defaultIcon: 'google',
            isAvailable: selectionAvailability,
            execute: (context) => openGoogleSearcher(context, getSdk())
        },
        {
            id: 'legacy.newgrounds.openPage',
            label: 'Abrir página de Newgrounds',
            category: 'Búsqueda web',
            description: 'Abre Newgrounds cuando el archivo termina en (η) y el título contiene un ID válido.',
            defaultIcon: 'external-link',
            isAvailable: selectionAvailability,
            execute: (context) => openNewgroundsPage(context, getSdk())
        },
        {
            id: 'legacy.numhand.extrasMenu',
            label: 'NumHand: herramientas de selección',
            category: 'Archivos y selección',
            description: 'Menú de copiar nombres/rutas, explorar la carpeta de la pista y abrir la carpeta de reciclaje.',
            defaultIcon: 'files-o',
            isAvailable: nativeAvailability,
            execute: (context) => showNumHandExtrasMenu(context, getSdk())
        }
    ];
}

export function registerLegacyActivityActions(registry, options) {
    const unregister = createLegacyActivityActions(options)
        .map((definition) => registry.register(definition));
    return () => unregister.reverse().forEach((remove) => remove());
}
