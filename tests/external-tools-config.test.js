import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_EXTERNAL_TOOLS_CONFIG,
    EXTERNAL_TOOLS_STORAGE_KEY,
    loadExternalToolsConfig,
    normalizeExternalToolsConfig,
    saveExternalToolsConfig
} from '../src/features/activitybar/config/externalTools.js';

function createMemoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem: (key) => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, value)
    };
}

test('Los valores predeterminados conservan Python y las rutas heredadas editables', () => {
    assert.equal(DEFAULT_EXTERNAL_TOOLS_CONFIG.pythonExecutable, 'pythonw.exe');
    assert.equal(DEFAULT_EXTERNAL_TOOLS_CONFIG.internalBasePath, 'E:\\_Internal');
    assert.equal(DEFAULT_EXTERNAL_TOOLS_CONFIG.recycleBinPath, 'E:\\_Exclude\\l_reallydeleted');
    assert.equal(DEFAULT_EXTERNAL_TOOLS_CONFIG.frameEtudeScript, '');
});

test('La normalización recorta espacios y conserva valores predeterminados omitidos', () => {
    const config = normalizeExternalToolsConfig({
        pythonExecutable: '  python.exe  ',
        frameEtudeScript: ' C:\\Tools\\FrameEtude\\frame_etude.pyw '
    });

    assert.equal(config.pythonExecutable, 'python.exe');
    assert.equal(config.frameEtudeScript, 'C:\\Tools\\FrameEtude\\frame_etude.pyw');
    assert.equal(config.internalBasePath, DEFAULT_EXTERNAL_TOOLS_CONFIG.internalBasePath);
    assert.equal(config.recycleBinPath, DEFAULT_EXTERNAL_TOOLS_CONFIG.recycleBinPath);
});

test('Guarda y carga la configuración externa bajo una clave versionada', () => {
    const storage = createMemoryStorage();
    const saved = saveExternalToolsConfig({
        ...DEFAULT_EXTERNAL_TOOLS_CONFIG,
        catchEtudeScript: 'C:\\Tools\\CatchEtude\\catchetude.pyw'
    }, storage);
    const loaded = loadExternalToolsConfig(storage);

    assert.equal(storage.getItem(EXTERNAL_TOOLS_STORAGE_KEY) !== null, true);
    assert.deepEqual(loaded, saved);
    assert.equal(loaded.catchEtudeScript, 'C:\\Tools\\CatchEtude\\catchetude.pyw');
});

test('Ignora JSON inválido y vuelve a los valores predeterminados', () => {
    const storage = createMemoryStorage({
        [EXTERNAL_TOOLS_STORAGE_KEY]: '{ invalid'
    });
    assert.deepEqual(loadExternalToolsConfig(storage), { ...DEFAULT_EXTERNAL_TOOLS_CONFIG });
});
