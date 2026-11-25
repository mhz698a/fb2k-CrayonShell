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

test('El catálogo principal contiene las cinco acciones iniciales', () => {
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
        'activitybar.manage'
    ]);
    assert.equal(catalog.find((action) => action.id === 'ui.toggleSidebar').active, true);
    assert.equal(catalog.find((action) => action.id === 'activitybar.manage').available, true);
});
