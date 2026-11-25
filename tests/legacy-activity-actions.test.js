import test from 'node:test';
import assert from 'node:assert/strict';
import { createLegacyActivityActions } from '../src/features/activitybar/actions/legacyActions.js';

function createSdk(overrides = {}) {
    const calls = [];
    const sdk = {
        playlist: {
            getSelectedTracks: async (playlistGuid) => {
                calls.push(['getSelectedTracks', playlistGuid]);
                return {
                    success: true,
                    tracks: [
                        {
                            path: 'file:///C:/Music/Track%20Name%20(%CE%B7).mp3',
                            absolutePath: 'C:\\Music\\Track Name (η).mp3',
                            title: 'Track Title (ID: 12345)',
                            artist: 'Artist Name'
                        }
                    ]
                };
            }
        },
        clipboard: {
            write: async (text) => {
                calls.push(['clipboard.write', text]);
                return { success: true };
            }
        },
        menu: {
            runContextCommand: async (command) => {
                calls.push(['runContextCommand', command]);
                return { success: true };
            },
            runMainMenuCommand: async (command) => {
                calls.push(['runMainMenuCommand', command]);
                return { success: true };
            },
            popup: async (items) => {
                calls.push(['popup', items]);
                return 'title-artist-lyrics';
            }
        },
        shell: {
            openExternal: async (url) => {
                calls.push(['openExternal', url]);
                return { success: true };
            },
            showInExplorer: async (path) => {
                calls.push(['showInExplorer', path]);
                return { success: true };
            },
            spawn: async (executable, options) => {
                calls.push(['spawn', executable, options]);
                return { success: true, processId: 1234 };
            }
        },
        file: {
            list: async (path) => {
                calls.push(['file.list', path]);
                return { success: true, directories: [] };
            }
        }
    };

    for (const [namespace, methods] of Object.entries(overrides)) {
        sdk[namespace] = { ...sdk[namespace], ...methods };
    }

    return { sdk, calls };
}

function findAction(actions, id) {
    const action = actions.find((item) => item.id === id);
    assert.ok(action, 'No se registró ' + id);
    return action;
}

const context = {
    activePlaylistGuid: '{11111111-1111-1111-1111-111111111111}',
    isDemoMode: false,
    externalTools: {
        pythonExecutable: 'pythonw.exe',
        frameEtudeScript: 'C:\\Tools\\FrameEtude\\frame_etude.pyw',
        catchEtudeScript: 'C:\\Tools\\CatchEtude\\catchetude.pyw',
        anuarySignatureScript: 'C:\\Tools\\AnuarySignature\\app.py',
        numHandScript: 'C:\\Tools\\NumHand\\main.py',
        smbYearScript: 'C:\\Tools\\smb_year_dialog.pyw',
        galleryAnuaryScript: 'C:\\Tools\\GalleryAnuary\\app.py',
        internalBasePath: 'E:\\_Internal',
        recycleBinPath: 'E:\\_Exclude\\l_reallydeleted'
    }
};

test('Registra acciones nativas heredadas para menús, DSP y servicios', () => {
    const actions = createLegacyActivityActions({
        getSdk: () => ({}),
        isNativeAvailable: () => true
    });
    const ids = actions.map((action) => action.id);

    for (const id of [
        'legacy.shazam',
        'legacy.mp3tag.editFolder',
        'legacy.exploreDirectory',
        'legacy.effects.playbackRate',
        'legacy.effects.tempo',
        'legacy.effects.iirFilter',
        'legacy.youtube.omniget',
        'legacy.youtube.searcher',
        'legacy.googleSearcherSongs',
        'legacy.newgrounds.openPage',
        'legacy.numhand.extrasMenu',
        'legacy.yearbookExplorer',
        'legacy.launchFrameEtude',
        'legacy.launchCatchEtude',
        'legacy.launchAnuarySignature',
        'legacy.launchNumHand',
        'legacy.connectYearToSmb'
    ]) {
        assert.ok(ids.includes(id), 'Falta la acción ' + id);
    }
});

test('Deshabilita acciones nativas fuera de foobar2000/WebView2', () => {
    const actions = createLegacyActivityActions({
        getSdk: () => ({}),
        isNativeAvailable: () => false
    });
    const shazam = findAction(actions, 'legacy.shazam');
    const google = findAction(actions, 'legacy.googleSearcherSongs');

    assert.equal(shazam.isAvailable(context).available, false);
    assert.equal(google.isAvailable(context).available, false);
});

test('Adapta los servicios nativos de Shazam y DSP al SDK tipado', async () => {
    const { sdk, calls } = createSdk();
    const actions = createLegacyActivityActions({
        getSdk: () => sdk,
        isNativeAvailable: () => true
    });

    await findAction(actions, 'legacy.shazam').execute(context);
    await findAction(actions, 'legacy.effects.tempo').execute(context);

    assert.deepEqual(calls, [
        ['runContextCommand', 'Run service/Search with Shazam'],
        ['runMainMenuCommand', 'View/DSP/Tempo']
    ]);
});

test('Copia los nombres y rutas de la selección real de foobar2000', async () => {
    const { sdk, calls } = createSdk({
        menu: {
            popup: async (items) => {
                calls.push(['popup', items]);
                return 'copy-names';
            }
        }
    });
    const actions = createLegacyActivityActions({
        getSdk: () => sdk,
        isNativeAvailable: () => true
    });

    await findAction(actions, 'legacy.numhand.extrasMenu').execute(context);

    assert.deepEqual(calls, [
        ['popup', [
            { id: 'copy-names', label: 'Copy Names' },
            { id: 'copy-paths', label: 'Copy Paths' },
            { id: 'numhand', label: 'Open NumHand For This Folder' },
            { id: 'smb-year', label: 'Connect current year to SMB' },
            { id: 'explore-directory', label: 'Explore folder of current song' },
            { type: 'separator' },
            { id: 'recycle-bin', label: 'Open Recycle Bin' }
        ]],
        ['getSelectedTracks', context.activePlaylistGuid],
        ['clipboard.write', 'Track Name (η).mp3']
    ]);
});

test('Google Song Searcher construye la consulta y abre el navegador predeterminado', async () => {
    const { sdk, calls } = createSdk({
        menu: {
            popup: async (items) => {
                calls.push(['popup', items]);
                return 'title-artist-lyrics';
            }
        }
    });
    const actions = createLegacyActivityActions({
        getSdk: () => sdk,
        isNativeAvailable: () => true
    });

    await findAction(actions, 'legacy.googleSearcherSongs').execute(context);

    assert.equal(calls[0][0], 'getSelectedTracks');
    assert.equal(calls[1][0], 'popup');
    assert.equal(calls[2][0], 'openExternal');
    assert.equal(
        calls[2][1],
        'https://www.google.com/search?q=Track%20Title%20Artist%20Name%20lyrics'
    );
});

test('Newgrounds abre la página solo cuando el nombre y el título cumplen el formato heredado', async () => {
    const { sdk, calls } = createSdk();
    const actions = createLegacyActivityActions({
        getSdk: () => sdk,
        isNativeAvailable: () => true
    });

    const result = await findAction(actions, 'legacy.newgrounds.openPage').execute(context);

    assert.equal(result.url, 'https://www.newgrounds.com/audio/listen/12345');
    assert.deepEqual(calls.at(-1), [
        'openExternal',
        'https://www.newgrounds.com/audio/listen/12345'
    ]);
});

test('Propaga los errores devueltos por el host al ejecutar acciones heredadas', async () => {
    const { sdk } = createSdk({
        menu: {
            runContextCommand: async () => ({
                success: false,
                code: 'MENU_COMMAND_NOT_FOUND',
                error: 'No se encontró el servicio'
            })
        }
    });
    const actions = createLegacyActivityActions({
        getSdk: () => sdk,
        isNativeAvailable: () => true
    });

    await assert.rejects(
        () => findAction(actions, 'legacy.shazam').execute(context),
        (error) => error.code === 'MENU_COMMAND_NOT_FOUND'
            && /No se encontró el servicio/.test(error.message)
    );
});

test('Yearbook Explorer navega por carpetas mediante file.list y abre la carpeta final', async () => {
    const currentYear = new Date().getFullYear();
    const calls = [];
    const { sdk } = createSdk({
        menu: {
            popup: async (items) => {
                calls.push(['popup', items]);
                if (items[0]?.id?.startsWith('year:')) return 'year:' + currentYear;
                if (items.some((item) => item.id === 'folder:0')) return 'folder:0';
                return 'child:0';
            }
        },
        file: {
            list: async (path) => {
                calls.push(['file.list', path]);
                if (path === 'E:\\_Internal\\' + currentYear) {
                    return { success: true, directories: ['Album folder'] };
                }
                if (path === 'E:\\_Internal\\' + currentYear + '\\Album folder') {
                    return { success: true, directories: ['Subfolder'] };
                }
                return { success: true, directories: [] };
            }
        },
        shell: {
            showInExplorer: async (path) => {
                calls.push(['showInExplorer', path]);
                return { success: true };
            }
        }
    });
    const actions = createLegacyActivityActions({
        getSdk: () => sdk,
        isNativeAvailable: () => true
    });

    await findAction(actions, 'legacy.yearbookExplorer').execute(context);

    assert.deepEqual(calls.filter((call) => call[0] === 'file.list'), [
        ['file.list', 'E:\\_Internal\\' + currentYear],
        ['file.list', 'E:\\_Internal\\' + currentYear + '\\Album folder']
    ]);
    assert.deepEqual(calls.at(-1), [
        'showInExplorer',
        'E:\\_Internal\\' + currentYear + '\\Album folder\\Subfolder'
    ]);
});

test('Inicia las herramientas Python con argumentos separados y ventana oculta', async () => {
    const { sdk, calls } = createSdk();
    const actions = createLegacyActivityActions({
        getSdk: () => sdk,
        isNativeAvailable: () => true
    });

    await findAction(actions, 'legacy.launchFrameEtude').execute(context);
    await findAction(actions, 'legacy.launchNumHand').execute(context);

    assert.deepEqual(calls.filter((call) => call[0] === 'spawn'), [
        [
            'spawn',
            'pythonw.exe',
            {
                args: [
                    'C:\\Tools\\FrameEtude\\frame_etude.pyw'
                ],
                hidden: true
            }
        ],
        [
            'spawn',
            'pythonw.exe',
            {
                args: [
                    'C:\\Tools\\NumHand\\main.py',
                    'C:\\Music\\Track Name (η).mp3'
                ],
                hidden: true
            }
        ]
    ]);
});

test('Yearbook Explorer abre una carpeta .album con GalleryAnuary', async () => {
    const currentYear = new Date().getFullYear();
    const calls = [];
    const { sdk } = createSdk({
        menu: {
            popup: async (items) => {
                calls.push(['popup', items]);
                return items[0]?.id?.startsWith('year:')
                    ? 'year:' + currentYear
                    : 'folder:0';
            }
        },
        file: {
            list: async (path) => {
                calls.push(['file.list', path]);
                return { success: true, directories: ['My Album.album'] };
            }
        }
    });
    const actions = createLegacyActivityActions({
        getSdk: () => sdk,
        isNativeAvailable: () => true
    });

    await findAction(actions, 'legacy.yearbookExplorer').execute(context);

    assert.deepEqual(calls.filter((call) => call[0] === 'spawn'), [
        [
            'spawn',
            'pythonw.exe',
            {
                args: [
                    'C:\\Tools\\GalleryAnuary\\app.py',
                    'E:\\_Internal\\' + currentYear + '\\My Album.album'
                ],
                hidden: true
            }
        ]
    ]);
});
