import test from 'node:test';
import assert from 'node:assert/strict';
import { createActionRegistry } from '../src/features/activitybar/actions/actionRegistry.js';
import { createActionDispatcher } from '../src/features/activitybar/actions/actionDispatcher.js';
import { registerCoreActivityBarActions } from '../src/features/activitybar/actions/coreActions.js';

test('Action Registry registra, consulta y elimina acciones', () => {
    const registry = createActionRegistry();
    const remove = registry.register({
        id: 'test.example',
        label: 'Acción de prueba',
        category: 'Pruebas',
        defaultIcon: 'check',
        execute: () => true
    });

    assert.equal(registry.has('test.example'), true);
    assert.equal(registry.get('test.example').label, 'Acción de prueba');
    assert.equal(registry.getState('test.example').available, true);
    assert.equal(remove(), true);
    assert.equal(registry.has('test.example'), false);
});

test('Action Registry notifica altas y bajas para actualizar catálogos en ejecución', () => {
    const registry = createActionRegistry();
    let notifications = 0;
    const unsubscribe = registry.subscribe(() => { notifications += 1; });

    const remove = registry.register({
        id: 'test.observable',
        execute: () => undefined
    });
    assert.equal(registry.getRevision(), 1);
    assert.equal(notifications, 1);

    remove();
    assert.equal(registry.getRevision(), 2);
    assert.equal(notifications, 2);

    unsubscribe();
    registry.register({ id: 'test.after-unsubscribe', execute: () => undefined });
    assert.equal(notifications, 2);
});

test('Action Registry registra módulos atómicamente y expone sus metadatos', () => {
    const registry = createActionRegistry();
    let notifications = 0;
    registry.subscribe(() => { notifications += 1; });

    const removeModule = registry.registerModule({
        id: 'media',
        label: 'Media tools',
        description: 'Acciones del módulo multimedia.',
        register(scopedRegistry) {
            scopedRegistry.register({
                id: 'media.open',
                label: 'Open media',
                category: 'Media',
                execute: () => 'opened'
            });
            scopedRegistry.register({
                id: 'media.search',
                label: 'Search media',
                category: 'Media',
                execute: () => 'searched'
            });
        }
    });

    assert.equal(notifications, 1);
    assert.deepEqual(registry.getModules(), [{
        id: 'media',
        label: 'Media tools',
        description: 'Acciones del módulo multimedia.',
        actionIds: ['media.open', 'media.search'],
        actionCount: 2
    }]);
    assert.equal(registry.getState('media.open').moduleId, 'media');
    assert.equal(registry.getState('media.open').moduleLabel, 'Media tools');
    assert.equal(registry.getCatalog()[0].moduleDescription, 'Acciones del módulo multimedia.');
    assert.equal(removeModule(), true);
    assert.equal(registry.has('media.open'), false);
    assert.equal(registry.has('media.search'), false);
    assert.deepEqual(registry.getModules(), []);
    assert.equal(notifications, 2);
    assert.equal(removeModule(), false);
});

test('Action Registry revierte el módulo completo si una acción entra en conflicto', () => {
    const registry = createActionRegistry();
    registry.register({
        id: 'shared.existing',
        execute: () => undefined
    });
    const revisionBefore = registry.getRevision();

    assert.throws(() => registry.registerModule({
        id: 'broken-module',
        label: 'Broken',
        register(scopedRegistry) {
            scopedRegistry.register({
                id: 'broken.first',
                execute: () => undefined
            });
            scopedRegistry.register({
                id: 'shared.existing',
                execute: () => undefined
            });
        }
    }), /identificador de acción duplicado/);

    assert.equal(registry.has('broken.first'), false);
    assert.equal(registry.has('shared.existing'), true);
    assert.equal(registry.getRevision(), revisionBefore);
    assert.deepEqual(registry.getModules(), []);
});

test('Action Registry permite descargar un módulo por ID y retirar acciones individuales', () => {
    const registry = createActionRegistry();
    let cleanupCalls = 0;

    registry.registerModule({
        id: 'tools',
        register(scopedRegistry) {
            scopedRegistry.register({
                id: 'tools.one',
                execute: () => undefined
            });
            scopedRegistry.register({
                id: 'tools.two',
                execute: () => undefined
            });
            return () => { cleanupCalls += 1; };
        }
    });

    assert.equal(registry.unregister('tools.one'), true);
    assert.deepEqual(registry.getModules()[0].actionIds, ['tools.two']);
    assert.equal(registry.getModules()[0].actionCount, 1);

    assert.equal(registry.unregisterModule('tools'), true);
    assert.equal(registry.unregisterModule('tools'), false);
    assert.equal(registry.has('tools.two'), false);
    assert.equal(cleanupCalls, 1);
});

test('Action Registry rechaza módulos duplicados y requiere una función register', () => {
    const registry = createActionRegistry();
    registry.registerModule({
        id: 'duplicate-module',
        register(scopedRegistry) {
            scopedRegistry.register({ id: 'module.action', execute: () => undefined });
        }
    });

    assert.throws(() => registry.registerModule({
        id: 'duplicate-module',
        register: () => undefined
    }), /módulo de ActivityBar registrado/);

    assert.throws(() => registry.registerModule({
        id: 'invalid-module'
    }), /debe proporcionar register/);
});

test('Action Registry rechaza identificadores duplicados y acciones sin ejecutor', () => {
    const registry = createActionRegistry();
    registry.register({ id: 'test.duplicate', execute: () => undefined });

    assert.throws(
        () => registry.register({ id: 'test.duplicate', execute: () => undefined }),
        /Ya existe una acción/
    );
    assert.throws(
        () => registry.register({ id: 'test.invalid' }),
        /debe proporcionar execute/
    );
});

test('Action Registry valida la política de ejecución de cada acción', () => {
    const registry = createActionRegistry();

    assert.throws(() => registry.register({
        id: 'test.bad-policy',
        executionPolicy: 'queue',
        execute: () => undefined
    }), /executionPolicy no válida/);

    registry.register({
        id: 'test.default-policy',
        execute: () => undefined
    });
    assert.equal(registry.get('test.default-policy').executionPolicy, 'parallel');
});

test('Action Registry expone disponibilidad, motivo y estado activo', () => {
    const registry = createActionRegistry();
    registry.register({
        id: 'test.contextual',
        execute: () => undefined,
        isAvailable: () => ({ available: false, reason: 'Requiere el host.' }),
        isActive: () => true
    });

    assert.deepEqual(
        {
            available: registry.getState('test.contextual').available,
            unavailableReason: registry.getState('test.contextual').unavailableReason,
            active: registry.getState('test.contextual').active
        },
        {
            available: false,
            unavailableReason: 'Requiere el host.',
            active: true
        }
    );
});

test('Action Dispatcher ejecuta acciones disponibles y entrega contexto', async () => {
    const registry = createActionRegistry();
    registry.register({
        id: 'test.sum',
        execute: (context, payload) => context.base + payload.value
    });
    const dispatcher = createActionDispatcher(registry);

    const result = await dispatcher.execute('test.sum', { base: 10 }, { value: 5 });
    assert.deepEqual(result, {
        ok: true,
        status: 'success',
        actionId: 'test.sum',
        result: 15
    });
});

test('Action Dispatcher no ejecuta acciones no disponibles', async () => {
    const registry = createActionRegistry();
    let executed = false;
    registry.register({
        id: 'test.unavailable',
        isAvailable: () => ({ available: false, reason: 'No hay puente nativo.' }),
        execute: () => { executed = true; }
    });
    const dispatcher = createActionDispatcher(registry);

    const result = await dispatcher.execute('test.unavailable');
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'No hay puente nativo.');
    assert.equal(executed, false);
});

test('Action Dispatcher reporta errores al consultar disponibilidad', async () => {
    const registry = createActionRegistry();
    const reported = [];
    registry.register({
        id: 'test.availability-failure',
        isAvailable: () => { throw new Error('Falló la consulta de disponibilidad'); },
        execute: () => undefined
    });
    const dispatcher = createActionDispatcher(registry, {
        onError: (failure) => reported.push(failure)
    });

    const result = await dispatcher.execute('test.availability-failure');
    assert.equal(result.status, 'error');
    assert.equal(result.error.message, 'Falló la consulta de disponibilidad');
    assert.equal(reported.length, 1);
});

test('Action Dispatcher aplica single-execution y publica estado running', async () => {
    const registry = createActionRegistry();
    let finishExecution;
    registry.register({
        id: 'test.single',
        executionPolicy: 'single',
        execute: () => new Promise((resolve) => {
            finishExecution = resolve;
        })
    });

    const dispatcher = createActionDispatcher(registry);
    let notifications = 0;
    dispatcher.subscribe(() => { notifications += 1; });

    const firstRun = dispatcher.execute('test.single');
    assert.equal(dispatcher.getState('test.single').running, true);

    const secondRun = await dispatcher.execute('test.single');
    assert.equal(secondRun.status, 'busy');
    assert.equal(dispatcher.getCatalog().find((action) => action.id === 'test.single').running, true);

    finishExecution('finished');
    const firstResult = await firstRun;

    assert.equal(firstResult.status, 'success');
    assert.equal(dispatcher.getState('test.single').running, false);
    assert.equal(notifications, 2);
});

test('Action Dispatcher conserva ejecución paralela cuando se solicita explícitamente', async () => {
    const registry = createActionRegistry();
    let executions = 0;
    registry.register({
        id: 'test.parallel',
        executionPolicy: 'parallel',
        execute: async () => {
            executions += 1;
            return executions;
        }
    });
    const dispatcher = createActionDispatcher(registry);

    const results = await Promise.all([
        dispatcher.execute('test.parallel'),
        dispatcher.execute('test.parallel')
    ]);

    assert.equal(executions, 2);
    assert.equal(results.every((result) => result.status === 'success'), true);
});

test('Action Dispatcher captura y reporta errores de ejecución', async () => {
    const registry = createActionRegistry();
    const reported = [];
    registry.register({
        id: 'test.failure',
        execute: () => { throw new Error('Fallo controlado'); }
    });
    const dispatcher = createActionDispatcher(registry, {
        onError: (failure) => reported.push(failure)
    });

    const result = await dispatcher.execute('test.failure');
    assert.equal(result.status, 'error');
    assert.equal(result.error.message, 'Fallo controlado');
    assert.equal(reported.length, 1);
});

test('El catálogo principal registra las acciones de interfaz y herramientas', () => {
    const registry = createActionRegistry();
    registerCoreActivityBarActions(registry);

    const catalog = registry.getCatalog({
        toggleSidebar: () => undefined,
        toggleContentView: () => undefined,
        refreshPlaylist: () => undefined,
        openDiagnostics: () => undefined,
        openActivityBarManager: () => undefined,
        activityBarManagerOpen: false,
        sidebarCollapsed: false,
        contentView: 'video'
    });

    assert.deepEqual(catalog.map((action) => action.id), [
        'ui.toggleSidebar',
        'ui.toggleContentView',
        'playlist.refresh',
        'diagnostics.open',
        'externalTools.configure',
        'activitybar.manage'
    ]);
    assert.equal(catalog.find((action) => action.id === 'ui.toggleSidebar').active, true);
    assert.equal(catalog.find((action) => action.id === 'activitybar.manage').available, true);
});
