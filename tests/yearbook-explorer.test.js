import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getYearDirectories,
    isAlbumContainer,
    joinWindowsPath,
    listYearbookDirectories,
    openYearbookDirectory
} from '../src/features/yearbook/yearbookService.js';

test('Combina rutas Windows y elimina separadores duplicados entre segmentos', () => {
    assert.equal(joinWindowsPath('E:\\_Internal\\', '\\2026\\', 'Folder'), 'E:\\_Internal\\2026\\Folder');
});

test('Normaliza y ordena carpetas devueltas por file.list', async () => {
    const sdk = {
        file: {
            list: async () => ({
                success: true,
                directories: ['2025', { name: '2024' }, { path: 'E:\\_Internal\\2026' }]
            })
        }
    };

    assert.deepEqual(await listYearbookDirectories(sdk, 'E:\\_Internal'), ['2024', '2025', '2026']);
});

test('Filtra años entre 1999 y el año actual y conserva orden numérico', () => {
    assert.deepEqual(
        getYearDirectories(['2026', '1998', '2000', 'misc', '2030', '1999'], 2026),
        ['1999', '2000', '2026']
    );
});

test('Detecta carpetas contenedoras .album sin distinguir mayúsculas', () => {
    assert.equal(isAlbumContainer('01. album'), true);
    assert.equal(isAlbumContainer('01. ALBUM'), true);
    assert.equal(isAlbumContainer('Albums'), false);
});

test('Abre carpetas normales en Windows Explorer', async () => {
    const calls = [];
    const sdk = {
        shell: {
            showInExplorer: async (path) => {
                calls.push(['showInExplorer', path]);
                return { success: true };
            }
        }
    };

    await openYearbookDirectory(sdk, {}, 'E:\\_Internal\\2026\\Folder');
    assert.deepEqual(calls, [['showInExplorer', 'E:\\_Internal\\2026\\Folder']]);
});

test('Abre las subcarpetas de un contenedor .album mediante GalleryAnuary', async () => {
    const calls = [];
    const sdk = {
        shell: {
            spawn: async (executable, options) => {
                calls.push(['spawn', executable, options]);
                return { success: true, processId: 4321 };
            }
        }
    };

    await openYearbookDirectory(sdk, {
        pythonExecutable: 'pythonw.exe',
        galleryAnuaryScript: 'C:\\Tools\\GalleryAnuary\\app.py'
    }, 'E:\\_Internal\\2026\\01. album\\My Album', { gallery: true });

    assert.deepEqual(calls, [[
        'spawn',
        'pythonw.exe',
        {
            args: [
                'C:\\Tools\\GalleryAnuary\\app.py',
                'E:\\_Internal\\2026\\01. album\\My Album'
            ],
            hidden: false
        }
    ]]);
});

test('Expone errores nativos y exige configurar GalleryAnuary', async () => {
    await assert.rejects(
        () => listYearbookDirectories({
            file: { list: async () => ({ success: false, error: 'Ruta no encontrada', code: 'NOT_FOUND' }) }
        }, 'E:\\Missing'),
        (error) => error.code === 'NOT_FOUND' && /Ruta no encontrada/.test(error.message)
    );

    await assert.rejects(
        () => openYearbookDirectory({ shell: {} }, {}, 'E:\\Album\\Item', { gallery: true }),
        /Configura la ruta de GalleryAnuary/
    );
});
