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
    if (!(/^[a-z]:[\\/]/i.test(path) || /^\\\\/.test(path))) {
        throw new Error('La pista seleccionada no tiene una ruta local de Windows utilizable.');
    }
    return path;
}

async function getExactlyOneSelectedTrackPath(context, sdk) {
    const tracks = await getSelectedTracks(context, sdk);
    if (tracks.length !== 1) {
        throw new Error('Esta operación solo acepta UN archivo seleccionado.');
    }

    const trackPath = getNativeTrackPath(tracks[0]);
    const result = requireSuccessfulResult(
        await sdk.file.exists(trackPath),
        'file.exists'
    );
    if (!result.exists || !result.isFile) {
        throw new Error('El archivo seleccionado no existe o no es válido: ' + trackPath);
    }
    return trackPath;
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
        hidden: false // works in false
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
            const trackPath = await getExactlyOneSelectedTrackPath(context, sdk);
            return spawnConfiguredPythonTool(context, sdk, 'numHandScript', [trackPath]);
        }
        case 'smb-year': {
            const trackPath = await getExactlyOneSelectedTrackPath(context, sdk);
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
            executionPolicy: 'single',
            isAvailable: nativeAvailability,
            execute: (context) => spawnConfiguredPythonTool(context, getSdk(), 'frameEtudeScript')
        },
        {
            id: 'legacy.launchCatchEtude',
            label: 'Abrir CatchEtude',
            category: 'Herramientas externas',
            description: 'Inicia el script configurado de CatchEtude.',
            defaultIcon: 'download',
            executionPolicy: 'single',
            isAvailable: nativeAvailability,
            execute: (context) => spawnConfiguredPythonTool(context, getSdk(), 'catchEtudeScript')
        },
        {
            id: 'legacy.launchAnuarySignature',
            label: 'Abrir AnuarySignature',
            category: 'Herramientas externas',
            description: 'Inicia el script configurado de AnuarySignature.',
            defaultIcon: 'pencil-square-o',
            executionPolicy: 'single',
            isAvailable: nativeAvailability,
            execute: (context) => spawnConfiguredPythonTool(context, getSdk(), 'anuarySignatureScript')
        },
        {
            id: 'legacy.launchNumHand',
            label: 'Abrir NumHand para el archivo seleccionado',
            category: 'Herramientas externas',
            description: 'Inicia NumHand pasando la ruta local del único archivo seleccionado.',
            defaultIcon: 'sort-numeric-asc',
            executionPolicy: 'single',
            isAvailable: selectionAvailability,
            execute: async (context) => {
                const sdk = getSdk();
                const trackPath = await getExactlyOneSelectedTrackPath(context, sdk);
                return spawnConfiguredPythonTool(context, sdk, 'numHandScript', [trackPath]);
            }
        },
        {
            id: 'legacy.connectYearToSmb',
            label: 'Conectar año a SMB',
            category: 'Herramientas externas',
            description: 'Abre el diálogo SMB pasando la ruta local del único archivo seleccionado.',
            defaultIcon: 'folder-open',
            executionPolicy: 'single',
            isAvailable: selectionAvailability,
            execute: async (context) => {
                const sdk = getSdk();
                const trackPath = await getExactlyOneSelectedTrackPath(context, sdk);
                return spawnConfiguredPythonTool(context, sdk, 'smbYearScript', [trackPath]);
            }
        },
        {
            id: 'legacy.yearbookExplorer',
            label: 'Yearbook Explorer',
            category: 'Archivos y selección',
            description: 'Abre el panel explorador Yearbook para recorrer años y carpetas de la raíz configurable.',
            defaultIcon: 'calendar',
            isAvailable: nativeAvailability,
            isActive: (context) => context.sidebarCollapsed === false && context.sidebarView === 'yearbook',
            execute: (context) => context.selectSidebarView('yearbook')
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
            description: 'Menú para copiar nombres/rutas, iniciar NumHand o SMB con un archivo, explorar la carpeta y abrir el reciclaje.',
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
