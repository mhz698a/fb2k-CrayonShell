import {
    loadActivityBarConfig,
    saveActivityBarConfig
} from '../../activitybar/config/storage.js';
import { normalizeActivityBarConfig } from '../../activitybar/config/schema.js';
import {
    loadExternalToolsConfig,
    normalizeExternalToolsConfig,
    saveExternalToolsConfig
} from '../../activitybar/config/externalTools.js';
import {
    normalizeCoreUiSettings,
    readCoreUiSettings,
    writeCoreUiSettings
} from './coreUiSettings.js';
import {
    normalizeRefacetsColumnSplit,
    normalizeRefacetsPresentation,
    normalizeRefacetsSelection,
    readRefacetsColumnSplit,
    readRefacetsPresentation,
    readRefacetsSelection,
    writeRefacetsSettings
} from '../../refacets/refacetsSettings.js';
import {
    normalizeSpectrumSettings,
    readSpectrumSettings,
    writeSpectrumSettings
} from '../../spectrum/spectrumSettings.js';
import {
    normalizeYearbookExplorerSettings,
    readYearbookExplorerSettings,
    writeYearbookExplorerSettings
} from '../../yearbook/yearbookExplorerSettings.js';

function getStorage(storage) {
    if (storage) return storage;
    if (typeof window === 'undefined' || !window.localStorage) {
        throw new Error('El almacenamiento local de CrayonShell no está disponible.');
    }
    return window.localStorage;
}

export function createCoreSettingsProviders(storageOverride) {
    const storage = getStorage(storageOverride);

    return [
        {
            id: 'core.ui',
            label: 'Interfaz general',
            description: 'Estado persistente del Sidebar y proporción de ReFacets.',
            version: 1,
            order: 10,
            readSettings: () => readCoreUiSettings(storage),
            validateSettings: normalizeCoreUiSettings,
            applySettings: (value) => writeCoreUiSettings(value, storage)
        },
        {
            id: 'activitybar',
            label: 'ActivityBar',
            description: 'Accesos configurables, orden, etiquetas e iconos.',
            version: 1,
            order: 20,
            readSettings: () => loadActivityBarConfig(storage),
            validateSettings: normalizeActivityBarConfig,
            applySettings: (value) => saveActivityBarConfig(value, storage)
        },
        {
            id: 'external-tools',
            label: 'Herramientas externas',
            description: 'Ejecutables, scripts y directorios configurados para herramientas externas.',
            version: 1,
            order: 30,
            readSettings: () => loadExternalToolsConfig(storage),
            validateSettings: normalizeExternalToolsConfig,
            applySettings: (value) => saveExternalToolsConfig(value, storage)
        },
        {
            id: 'yearbook.explorer',
            label: 'Yearbook Explorer',
            description: 'Carpetas expandidas, expresadas como rutas relativas a la raíz.',
            version: 1,
            order: 40,
            readSettings: () => readYearbookExplorerSettings(
                loadExternalToolsConfig(storage).internalBasePath,
                storage
            ),
            validateSettings: normalizeYearbookExplorerSettings,
            applySettings: (value, context = {}) => {
                const externalTools = context.getSettings?.('external-tools')
                    || loadExternalToolsConfig(storage);
                return writeYearbookExplorerSettings(
                    value,
                    externalTools.internalBasePath,
                    storage
                );
            }
        },
        {
            id: 'refacets',
            label: 'ReFacets',
            description: 'Preferencias de presentación, divisor de columnas y selección de filtros.',
            version: 1,
            order: 50,
            readSettings: () => ({
                presentation: readRefacetsPresentation(storage),
                columnSplit: readRefacetsColumnSplit(storage),
                selection: readRefacetsSelection(storage)
            }),
            validateSettings: (value = {}) => {
                const source = value && typeof value === 'object' && !Array.isArray(value)
                    ? value
                    : {};
                return {
                    presentation: normalizeRefacetsPresentation(source.presentation),
                    columnSplit: normalizeRefacetsColumnSplit(source.columnSplit),
                    selection: normalizeRefacetsSelection(source.selection)
                };
            },
            applySettings: (value) => writeRefacetsSettings(value, storage)
        },
        {
            id: 'spectrum',
            label: 'Spectrum',
            description: 'Parámetros FFT, presentación, sensibilidad y colores del visualizador.',
            version: 1,
            order: 60,
            readSettings: () => readSpectrumSettings(storage),
            validateSettings: normalizeSpectrumSettings,
            applySettings: (value) => writeSpectrumSettings(value, storage)
        }
    ];
}

export function registerCoreSettingsProviders(registry, storageOverride) {
    if (!registry || typeof registry.registerMany !== 'function'
        || typeof registry.has !== 'function') {
        throw new TypeError('Se requiere un SettingsRegistry válido.');
    }

    const providers = createCoreSettingsProviders(storageOverride);
    const existing = providers.filter((provider) => registry.has(provider.id));
    if (existing.length === providers.length) {
        return () => false;
    }
    if (existing.length > 0) {
        throw new Error(
            'El registro de ajustes contiene solo parte de los proveedores integrados: '
            + existing.map((provider) => provider.id).join(', ')
        );
    }

    return registry.registerMany(providers);
}
