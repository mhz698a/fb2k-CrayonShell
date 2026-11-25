import {
    SETTINGS_BACKUP_FORMAT,
    SETTINGS_BACKUP_FORMAT_VERSION
} from './settingsBackupService.js';

const MAX_BACKUP_CHARACTERS = 5 * 1024 * 1024;
const UNSAFE_JSON_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MACHINE_DEPENDENT_FIELDS = Object.freeze({
    'external-tools': Object.freeze([
        'pythonExecutable',
        'frameEtudeScript',
        'catchEtudeScript',
        'anuarySignatureScript',
        'numHandScript',
        'smbYearScript',
        'galleryAnuaryScript',
        'internalBasePath',
        'recycleBinPath'
    ])
});

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function cloneJsonValue(value, path = '$', ancestors = new WeakSet()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError('El archivo contiene un número no finito en "' + path + '".');
        }
        return value;
    }

    if (typeof value !== 'object') {
        throw new TypeError('El archivo contiene un valor no serializable en "' + path + '".');
    }

    if (ancestors.has(value)) {
        throw new TypeError('El archivo contiene una referencia circular en "' + path + '".');
    }

    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('El archivo contiene un objeto no JSON en "' + path + '".');
    }

    if (Reflect.ownKeys(value).some((key) => typeof key === 'symbol')) {
        throw new TypeError('El archivo contiene propiedades Symbol en "' + path + '".');
    }

    ancestors.add(value);
    let cloned;

    if (Array.isArray(value)) {
        cloned = value.map((entry, index) => cloneJsonValue(
            entry,
            path + '[' + index + ']',
            ancestors
        ));
        for (let index = 0; index < value.length; index += 1) {
            if (!Object.prototype.hasOwnProperty.call(value, index)) {
                throw new TypeError('El archivo contiene una posición vacía en "' + path + '".');
            }
        }
    } else {
        cloned = {};
        for (const [key, entry] of Object.entries(value)) {
            if (UNSAFE_JSON_KEYS.has(key)) {
                throw new TypeError(
                    'El archivo contiene una propiedad no permitida en "' + path + '": ' + key
                );
            }
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
                throw new TypeError('El archivo contiene una propiedad calculada en "' + path + '".');
            }
            cloned[key] = cloneJsonValue(entry, path + '.' + key, ancestors);
        }
    }

    ancestors.delete(value);
    return cloned;
}

function parseBackupInput(input) {
    let source = input;

    if (typeof input === 'string') {
        if (input.length > MAX_BACKUP_CHARACTERS) {
            throw new RangeError('El archivo de ajustes excede el límite de 5 MB.');
        }

        try {
            source = JSON.parse(input);
        } catch (error) {
            throw new SyntaxError(
                'El archivo de ajustes no contiene JSON válido: ' + (error.message || String(error))
            );
        }
    }

    const backup = cloneJsonValue(source);
    if (!isPlainObject(backup)) {
        throw new TypeError('La raíz del respaldo debe ser un objeto JSON.');
    }
    if (backup.format !== SETTINGS_BACKUP_FORMAT) {
        throw new Error('El archivo no es un respaldo de configuración de CrayonShell.');
    }

    const formatVersion = Number(backup.formatVersion);
    if (!Number.isSafeInteger(formatVersion) || formatVersion < 1) {
        throw new Error('El archivo no declara una versión de formato válida.');
    }
    if (formatVersion > SETTINGS_BACKUP_FORMAT_VERSION) {
        throw new Error(
            'El respaldo usa una versión de formato más reciente (' + formatVersion
            + ') que esta aplicación (' + SETTINGS_BACKUP_FORMAT_VERSION + ').'
        );
    }
    if (formatVersion < SETTINGS_BACKUP_FORMAT_VERSION) {
        throw new Error(
            'El respaldo usa una versión de formato anterior (' + formatVersion
            + ') para la que no existe una migración disponible.'
        );
    }
    if (!isPlainObject(backup.providers)) {
        throw new TypeError('El respaldo no contiene un objeto "providers" válido.');
    }

    return backup;
}

function getRegistry(registry) {
    if (!registry || typeof registry.getProviders !== 'function'
        || typeof registry.getProvider !== 'function') {
        throw new TypeError('Se requiere un SettingsRegistry válido para importar ajustes.');
    }
    return registry.getProviders();
}

function getEligible(row) {
    return row.status === 'ready' || row.status === 'migrated';
}

function normalizeProviderRecord(provider, id, record) {
    if (!isPlainObject(record)) {
        throw new TypeError('La entrada del proveedor "' + id + '" debe ser un objeto.');
    }

    const sourceVersion = Number(record.version);
    if (!Number.isSafeInteger(sourceVersion) || sourceVersion < 1) {
        throw new TypeError('El proveedor "' + id + '" no declara una versión válida.');
    }
    if (!Object.prototype.hasOwnProperty.call(record, 'settings')) {
        throw new TypeError('El respaldo no contiene los ajustes del proveedor "' + id + '".');
    }

    const sourceSettings = cloneJsonValue(record.settings, '$.providers.' + id + '.settings');
    if (sourceVersion > provider.version) {
        return {
            status: 'newer-version',
            sourceVersion,
            settings: null,
            error: 'El respaldo es de una versión más reciente del proveedor.'
        };
    }

    let candidate = sourceSettings;
    let status = 'ready';

    if (sourceVersion < provider.version) {
        if (typeof provider.migrateSettings !== 'function') {
            return {
                status: 'migration-required',
                sourceVersion,
                settings: null,
                error: 'No existe una migración desde la versión '
                    + sourceVersion + ' a la versión ' + provider.version + '.'
            };
        }

        candidate = provider.migrateSettings(sourceSettings, sourceVersion, {
            providerId: id,
            fromVersion: sourceVersion,
            targetVersion: provider.version
        });
        status = 'migrated';
    }

    const normalized = provider.validateSettings(candidate);
    return {
        status,
        sourceVersion,
        settings: cloneJsonValue(normalized, '$.providers.' + id + '.normalizedSettings'),
        error: null
    };
}

function makeProviderWarning(id, status) {
    if (id === 'external-tools' && getEligible({ status })) {
        return 'Incluye ejecutables y rutas del equipo de origen. Revisa estos valores antes de reemplazar la configuración local.';
    }
    if (id === 'yearbook.explorer' && getEligible({ status })) {
        return 'Las carpetas expandidas se reconstruirán bajo la ruta internalBasePath que quede activa al importar.';
    }
    return null;
}

/**
 * Parses a backup and returns a read-only preview. No persistent setting is
 * changed by this operation.
 */
export function inspectSettingsBackup(registry, input) {
    const metadata = getRegistry(registry);
    const backup = parseBackupInput(input);
    const sourceProviderIds = new Set(Object.keys(backup.providers));
    const rows = [];
    const normalizedById = new Map();

    for (const providerMetadata of metadata) {
        const id = providerMetadata.id;
        const provider = registry.getProvider(id);

        if (!sourceProviderIds.has(id)) {
            rows.push({
                id,
                label: providerMetadata.label,
                description: providerMetadata.description,
                sourceVersion: null,
                targetVersion: providerMetadata.version,
                status: 'not-in-backup',
                settings: null,
                machineDependent: false,
                machineDependentFields: [],
                warnings: [],
                error: null
            });
            continue;
        }

        try {
            const result = normalizeProviderRecord(provider, id, backup.providers[id]);
            if (getEligible(result)) normalizedById.set(id, result.settings);
            const machineDependentFields = MACHINE_DEPENDENT_FIELDS[id]
                ? [...MACHINE_DEPENDENT_FIELDS[id]]
                : [];
            const warning = makeProviderWarning(id, result.status);

            rows.push({
                id,
                label: providerMetadata.label,
                description: providerMetadata.description,
                sourceVersion: result.sourceVersion,
                targetVersion: providerMetadata.version,
                status: result.status,
                settings: result.settings,
                machineDependent: machineDependentFields.length > 0,
                machineDependentFields,
                warnings: warning ? [warning] : [],
                error: result.error
            });
        } catch (error) {
            rows.push({
                id,
                label: providerMetadata.label,
                description: providerMetadata.description,
                sourceVersion: Number(backup.providers[id]?.version) || null,
                targetVersion: providerMetadata.version,
                status: 'invalid',
                settings: null,
                machineDependent: Boolean(MACHINE_DEPENDENT_FIELDS[id]),
                machineDependentFields: MACHINE_DEPENDENT_FIELDS[id]
                    ? [...MACHINE_DEPENDENT_FIELDS[id]]
                    : [],
                warnings: [],
                error: error.message || String(error)
            });
        }
    }

    const unknownProviders = Object.keys(backup.providers)
        .filter((id) => !registry.getProvider(id))
        .map((id) => ({
            id,
            sourceVersion: Number(backup.providers[id]?.version) || null
        }));

    for (const unknown of unknownProviders) {
        rows.push({
            id: unknown.id,
            label: unknown.id,
            description: 'Este proveedor no está instalado en esta versión de CrayonShell.',
            sourceVersion: unknown.sourceVersion,
            targetVersion: null,
            status: 'unknown',
            settings: null,
            machineDependent: false,
            machineDependentFields: [],
            warnings: ['Se omitirá este proveedor; no se ejecutará ni aplicará contenido desconocido.'],
            error: null
        });
    }

    const yearbookRow = rows.find((row) => row.id === 'yearbook.explorer');
    if (yearbookRow && getEligible(yearbookRow)) {
        let rootPath = normalizedById.get('external-tools')?.internalBasePath || '';
        if (!rootPath) {
            try {
                rootPath = registry.getProvider('external-tools')
                    ?.validateSettings(registry.getProvider('external-tools').readSettings())
                    ?.internalBasePath || '';
            } catch {
                rootPath = '';
            }
        }
        yearbookRow.destinationRoot = rootPath || null;
    }

    const importableCount = rows.filter(getEligible).length;
    const warningCount = rows.reduce((count, row) => count + row.warnings.length, 0)
        + unknownProviders.length;

    return Object.freeze({
        format: backup.format,
        formatVersion: backup.formatVersion,
        exportedAt: typeof backup.exportedAt === 'string' ? backup.exportedAt : null,
        application: isPlainObject(backup.application) ? backup.application : null,
        providers: Object.freeze(rows.map((row) => Object.freeze(row))),
        unknownProviders: Object.freeze(unknownProviders.map((row) => Object.freeze(row))),
        summary: Object.freeze({
            importable: importableCount,
            invalid: rows.filter((row) => row.status === 'invalid').length,
            migrations: rows.filter((row) => row.status === 'migrated').length,
            newerVersions: rows.filter((row) => row.status === 'newer-version').length,
            migrationRequired: rows.filter((row) => row.status === 'migration-required').length,
            missing: rows.filter((row) => row.status === 'not-in-backup').length,
            unknown: unknownProviders.length,
            warnings: warningCount
        }),
        canApply: importableCount > 0
    });
}

export class SettingsImportRollbackError extends Error {
    constructor(cause, rollbackErrors) {
        super(
            'Falló la restauración de ajustes y también falló al menos una operación de reversión. '
            + 'El almacenamiento puede requerir revisión manual.'
        );
        this.name = 'SettingsImportRollbackError';
        this.cause = cause;
        this.rollbackErrors = rollbackErrors;
    }
}

function createApplyContext(settingsById) {
    return {
        source: 'settings-backup-import',
        getSettings(id) {
            return settingsById.has(id) ? settingsById.get(id) : null;
        }
    };
}

/**
 * Applies a validated backup. Machine-dependent External Tools values are
 * excluded by default and require explicit confirmation to overwrite local paths.
 */
export async function applySettingsBackup(registry, input, options = {}) {
    const plan = inspectSettingsBackup(registry, input);
    const requestedIds = options.providerIds === undefined
        ? null
        : new Set(options.providerIds);

    if (requestedIds && (!Array.isArray(options.providerIds)
        || requestedIds.size !== options.providerIds.length)) {
        throw new TypeError('providerIds debe ser una lista de IDs de proveedor sin duplicados.');
    }

    const eligibleRows = plan.providers.filter(getEligible);
    const selectedRows = eligibleRows.filter((row) => {
        if (requestedIds && !requestedIds.has(row.id)) return false;
        if (row.machineDependent && options.confirmMachineDependent !== true) return false;
        return true;
    });

    if (requestedIds) {
        const eligibleIds = new Set(eligibleRows.map((row) => row.id));
        for (const id of requestedIds) {
            if (!eligibleIds.has(id)) {
                throw new Error('El proveedor "' + id + '" no está disponible para importar.');
            }
        }
        if (requestedIds.has('external-tools') && options.confirmMachineDependent !== true) {
            throw new Error(
                'La importación de External Tools requiere confirmación explícita de sus rutas dependientes del equipo.'
            );
        }
    }

    if (!selectedRows.length) {
        throw new Error('No hay proveedores compatibles seleccionados para restaurar.');
    }

    const metadata = getRegistry(registry);
    const previousSettings = new Map();
    const targetSettings = new Map();

    // Capture and validate the complete current state before the first write.
    for (const providerMetadata of metadata) {
        const provider = registry.getProvider(providerMetadata.id);
        const current = provider.validateSettings(provider.readSettings());
        const safeCurrent = cloneJsonValue(
            current,
            '$.currentProviders.' + providerMetadata.id
        );
        previousSettings.set(providerMetadata.id, safeCurrent);
        targetSettings.set(providerMetadata.id, safeCurrent);
    }

    for (const row of selectedRows) {
        targetSettings.set(row.id, row.settings);
    }

    const attempted = [];
    try {
        for (const row of selectedRows) {
            const provider = registry.getProvider(row.id);
            attempted.push({ id: row.id, provider });
            await provider.applySettings(row.settings, createApplyContext(targetSettings));
        }
    } catch (error) {
        const rollbackErrors = [];
        const rollbackContext = createApplyContext(previousSettings);

        for (const attemptedProvider of attempted.reverse()) {
            try {
                await attemptedProvider.provider.applySettings(
                    previousSettings.get(attemptedProvider.id),
                    rollbackContext
                );
            } catch (rollbackError) {
                rollbackErrors.push({
                    providerId: attemptedProvider.id,
                    error: rollbackError
                });
            }
        }

        if (rollbackErrors.length) {
            throw new SettingsImportRollbackError(error, rollbackErrors);
        }
        throw error;
    }

    const importedProviderIds = selectedRows.map((row) => row.id);
    const importedSet = new Set(importedProviderIds);
    return {
        success: true,
        importedProviderIds,
        skippedProviderIds: plan.providers
            .filter((row) => !importedSet.has(row.id))
            .map((row) => row.id),
        requiresReload: true,
        plan
    };
}
