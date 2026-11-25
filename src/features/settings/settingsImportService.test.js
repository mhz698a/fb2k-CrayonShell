import assert from 'node:assert/strict';
import test from 'node:test';
import { createSettingsRegistry } from './settingsRegistry.js';
import {
    applySettingsBackup,
    inspectSettingsBackup,
    SettingsImportRollbackError
} from './settingsImportService.js';
import { createSettingsBackup } from './settingsBackupService.js';
import { registerCoreSettingsProviders } from './providers/coreSettingsProviders.js';

function createMemoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        },
        removeItem(key) {
            values.delete(key);
        },
        values
    };
}

function createContainer(providers, overrides = {}) {
    return {
        format: 'crayonshell-settings',
        formatVersion: 1,
        exportedAt: '2026-11-24T12:00:00.000Z',
        application: {
            name: 'CrayonShell',
            version: '0.2.0',
            runtime: 'browser'
        },
        providers,
        ...overrides
    };
}

function createSimpleProvider(id, version = 1, initialValue = 'local', overrides = {}) {
    let value = initialValue;
    const provider = {
        id,
        label: id,
        version,
        readSettings: () => ({ value }),
        validateSettings: (settings) => {
            if (!settings || typeof settings.value !== 'string') {
                throw new TypeError('El campo value debe ser texto.');
            }
            return { value: settings.value };
        },
        applySettings: (settings) => {
            value = settings.value;
        },
        getValue: () => value,
        ...overrides
    };
    return provider;
}

test('inspects a backup without writing and exposes provider versions and machine-specific warnings', () => {
    const storage = createMemoryStorage({
        'crayonshell.externalTools.v1': JSON.stringify({
            internalBasePath: 'E:\\SourceInternal',
            recycleBinPath: 'E:\\SourceRecycle'
        }),
        'crayonshell.yearbookExplorer.expanded.v1': JSON.stringify({
            rootPath: 'E:\\SourceInternal',
            paths: ['E:\\SourceInternal\\2024']
        })
    });
    const registry = createSettingsRegistry();
    registerCoreSettingsProviders(registry, storage);

    const backup = createSettingsBackup(registry);
    const plan = inspectSettingsBackup(registry, JSON.stringify(backup));

    assert.equal(plan.canApply, true);
    assert.equal(plan.providers.find((row) => row.id === 'external-tools').status, 'ready');
    assert.equal(plan.providers.find((row) => row.id === 'external-tools').machineDependent, true);
    assert.ok(plan.providers.find((row) => row.id === 'external-tools').warnings.length > 0);
    assert.equal(
        plan.providers.find((row) => row.id === 'yearbook.explorer').destinationRoot,
        'E:\\SourceInternal'
    );
    assert.equal(storage.getItem('crayonshell.externalTools.v1'), JSON.stringify({
        internalBasePath: 'E:\\SourceInternal',
        recycleBinPath: 'E:\\SourceRecycle'
    }));
});

test('restores portable providers and rebuilds Yearbook paths under the local root by default', async () => {
    const sourceStorage = createMemoryStorage({
        'crayonshell.externalTools.v1': JSON.stringify({
            internalBasePath: 'E:\\SourceInternal',
            recycleBinPath: 'E:\\SourceRecycle',
            pythonExecutable: 'pythonw.exe'
        }),
        'crayonshell.yearbookExplorer.expanded.v1': JSON.stringify({
            rootPath: 'E:\\SourceInternal',
            paths: ['E:\\SourceInternal\\2024', 'E:\\SourceInternal\\2024\\Graduación']
        }),
        'crayonshell.sidebar.width.v1': '440'
    });
    const sourceRegistry = createSettingsRegistry();
    registerCoreSettingsProviders(sourceRegistry, sourceStorage);
    const backup = createSettingsBackup(sourceRegistry);

    const destinationStorage = createMemoryStorage({
        'crayonshell.externalTools.v1': JSON.stringify({
            internalBasePath: 'F:\\LocalInternal',
            recycleBinPath: 'F:\\LocalRecycle'
        })
    });
    const destinationRegistry = createSettingsRegistry();
    registerCoreSettingsProviders(destinationRegistry, destinationStorage);

    const result = await applySettingsBackup(destinationRegistry, backup);
    assert.equal(result.success, true);
    assert.equal(result.requiresReload, true);
    assert.equal(result.importedProviderIds.includes('external-tools'), false);
    assert.equal(result.importedProviderIds.includes('yearbook.explorer'), true);
    assert.equal(
        JSON.parse(destinationStorage.getItem('crayonshell.externalTools.v1')).internalBasePath,
        'F:\\LocalInternal'
    );

    const yearbook = JSON.parse(
        destinationStorage.getItem('crayonshell.yearbookExplorer.expanded.v1')
    );
    assert.equal(yearbook.rootPath, 'F:\\LocalInternal');
    assert.deepEqual(yearbook.paths, [
        'F:\\LocalInternal\\2024',
        'F:\\LocalInternal\\2024\\Graduación'
    ]);
    assert.equal(destinationStorage.getItem('crayonshell.sidebar.width.v1'), '440');
});

test('requires explicit confirmation before importing machine-dependent External Tools values', async () => {
    const sourceStorage = createMemoryStorage({
        'crayonshell.externalTools.v1': JSON.stringify({
            internalBasePath: 'E:\\SourceInternal',
            recycleBinPath: 'E:\\SourceRecycle'
        })
    });
    const sourceRegistry = createSettingsRegistry();
    registerCoreSettingsProviders(sourceRegistry, sourceStorage);
    const backup = createSettingsBackup(sourceRegistry);

    const destinationStorage = createMemoryStorage({
        'crayonshell.externalTools.v1': JSON.stringify({
            internalBasePath: 'F:\\LocalInternal',
            recycleBinPath: 'F:\\LocalRecycle'
        })
    });
    const destinationRegistry = createSettingsRegistry();
    registerCoreSettingsProviders(destinationRegistry, destinationStorage);

    await assert.rejects(
        applySettingsBackup(destinationRegistry, backup, {
            providerIds: ['external-tools']
        }),
        /requiere confirmación explícita/
    );

    await applySettingsBackup(destinationRegistry, backup, {
        providerIds: ['external-tools'],
        confirmMachineDependent: true
    });
    const imported = JSON.parse(destinationStorage.getItem('crayonshell.externalTools.v1'));
    assert.equal(imported.internalBasePath, 'E:\\SourceInternal');
    assert.equal(imported.recycleBinPath, 'E:\\SourceRecycle');
});

test('migrates older provider data through its registered migration function', () => {
    const registry = createSettingsRegistry();
    registry.register({
        id: 'example',
        label: 'Ejemplo',
        version: 2,
        readSettings: () => ({ count: 0 }),
        validateSettings: (value) => ({ count: Number(value.count) }),
        migrateSettings: (value, fromVersion) => ({
            count: Number(value.oldCount) + fromVersion
        }),
        applySettings: () => {}
    });

    const plan = inspectSettingsBackup(registry, createContainer({
        example: { version: 1, settings: { oldCount: 4 } }
    }));
    const row = plan.providers.find((entry) => entry.id === 'example');

    assert.equal(row.status, 'migrated');
    assert.equal(row.sourceVersion, 1);
    assert.equal(row.targetVersion, 2);
    assert.deepEqual(row.settings, { count: 5 });
    assert.equal(plan.summary.migrations, 1);
});

test('reports newer, missing and unknown provider versions without applying them', () => {
    const registry = createSettingsRegistry();
    registry.register(createSimpleProvider('known', 1));

    const plan = inspectSettingsBackup(registry, createContainer({
        known: { version: 2, settings: { value: 'newer' } },
        removed: { version: 1, settings: { value: 'unknown' } }
    }));

    assert.equal(plan.providers.find((row) => row.id === 'known').status, 'newer-version');
    assert.equal(plan.providers.find((row) => row.id === 'removed').status, 'unknown');
    assert.equal(plan.summary.newerVersions, 1);
    assert.equal(plan.summary.unknown, 1);
    assert.equal(plan.providers.find((row) => row.id === 'known').settings, null);
});

test('marks invalid provider data in the preview and refuses to apply it', async () => {
    const provider = createSimpleProvider('broken', 1, 'local', {
        validateSettings: () => {
            throw new Error('Contenido inválido');
        }
    });
    const registry = createSettingsRegistry();
    registry.register(provider);
    const backup = createContainer({
        broken: { version: 1, settings: { value: 'incoming' } }
    });

    const plan = inspectSettingsBackup(registry, backup);
    assert.equal(plan.providers[0].status, 'invalid');
    assert.match(plan.providers[0].error, /Contenido inválido/);
    await assert.rejects(
        applySettingsBackup(registry, backup),
        /No hay proveedores compatibles seleccionados/
    );
    assert.equal(provider.getValue(), 'local');
});

test('rejects invalid JSON, unsupported container versions and unsafe object keys', () => {
    const registry = createSettingsRegistry();
    registry.register(createSimpleProvider('example'));

    assert.throws(
        () => inspectSettingsBackup(registry, '{invalid'),
        /JSON válido/
    );
    assert.throws(
        () => inspectSettingsBackup(registry, createContainer({}, { formatVersion: 99 })),
        /versión de formato más reciente/
    );
    assert.throws(
        () => inspectSettingsBackup(
            registry,
            '{"format":"crayonshell-settings","formatVersion":1,"providers":{"__proto__":{"version":1,"settings":{}}}}'
        ),
        /propiedad no permitida/
    );
});

test('rolls back every attempted provider when one provider fails during application', async () => {
    const registry = createSettingsRegistry();
    const first = createSimpleProvider('first', 1, 'old-first');
    let failIncomingValue = true;
    const second = createSimpleProvider('second', 1, 'old-second', {
        applySettings(settings) {
            this.value = settings.value;
            if (settings.value === 'new-second' && failIncomingValue) {
                failIncomingValue = false;
                throw new Error('Fallo de escritura simulado');
            }
        },
        readSettings() {
            return { value: this.value };
        },
        getValue() {
            return this.value;
        }
    });
    first.value = 'old-first';
    second.value = 'old-second';
    registry.registerMany([first, second]);

    const backup = createContainer({
        first: { version: 1, settings: { value: 'new-first' } },
        second: { version: 1, settings: { value: 'new-second' } }
    });

    await assert.rejects(
        applySettingsBackup(registry, backup),
        /Fallo de escritura simulado/
    );
    assert.equal(first.getValue(), 'old-first');
    assert.equal(second.getValue(), 'old-second');
});

test('reports a rollback failure separately from the original apply failure', async () => {
    const registry = createSettingsRegistry();
    let value = 'local';
    const provider = {
        id: 'unstable',
        label: 'Inestable',
        version: 1,
        readSettings: () => ({ value }),
        validateSettings: (settings) => ({ value: settings.value }),
        applySettings: (settings) => {
            if (settings.value === 'incoming') {
                value = 'partially-written';
                throw new Error('Apply failed');
            }
            if (settings.value === 'local') {
                throw new Error('Rollback failed');
            }
            value = settings.value;
        }
    };
    registry.register(provider);
    const backup = createContainer({
        unstable: { version: 1, settings: { value: 'incoming' } }
    });

    await assert.rejects(
        applySettingsBackup(registry, backup),
        (error) => {
            assert.ok(error instanceof SettingsImportRollbackError);
            assert.match(error.cause.message, /Apply failed/);
            assert.equal(error.rollbackErrors.length, 1);
            return true;
        }
    );
});


test('reports ActivityBar action IDs that are unavailable in the current installation', () => {
    const storage = createMemoryStorage({
        'crayonshell.activitybar.config.v1': JSON.stringify({
            version: 1,
            buttons: [{
                id: 'plugin.futureAction',
                actionId: 'plugin.futureAction',
                label: 'Acción externa',
                icon: 'music'
            }]
        })
    });
    const registry = createSettingsRegistry();
    registerCoreSettingsProviders(registry, storage);

    const backup = createSettingsBackup(registry);
    const plan = inspectSettingsBackup(registry, backup);
    const row = plan.providers.find((entry) => entry.id === 'activitybar');

    assert.ok(row.warnings.some((warning) => warning.includes('plugin.futureAction')));
    assert.ok(row.warnings.some((warning) => warning.includes('no se ejecutará código desconocido')));
});
