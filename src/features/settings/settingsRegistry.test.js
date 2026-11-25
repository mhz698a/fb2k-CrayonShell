import assert from 'node:assert/strict';
import test from 'node:test';
import { createSettingsRegistry } from './settingsRegistry.js';

function createProvider(id, overrides = {}) {
    return {
        id,
        label: 'Proveedor ' + id,
        description: 'Preferencias de prueba.',
        version: 1,
        readSettings: () => ({ enabled: true }),
        validateSettings: (value) => value,
        applySettings: () => {},
        ...overrides
    };
}

test('registers providers and exposes metadata without exposing implementation functions', () => {
    const registry = createSettingsRegistry();
    const dispose = registry.register(createProvider('core.ui', { order: 10 }));

    assert.equal(registry.has('core.ui'), true);
    assert.deepEqual(registry.getProvider('core.ui').readSettings(), { enabled: true });
    assert.deepEqual(registry.getProviders(), [{
        id: 'core.ui',
        label: 'Proveedor core.ui',
        description: 'Preferencias de prueba.',
        version: 1,
        order: 10
    }]);

    assert.equal(typeof dispose, 'function');
});

test('rejects duplicate provider IDs without changing the registry', () => {
    const registry = createSettingsRegistry();
    registry.register(createProvider('core.ui'));
    const revision = registry.getRevision();

    assert.throws(
        () => registry.register(createProvider('core.ui')),
        /Ya existe un proveedor/
    );
    assert.equal(registry.getRevision(), revision);
    assert.equal(registry.getProviders().length, 1);
});

test('validates a complete batch before publishing any provider', () => {
    const registry = createSettingsRegistry();

    assert.throws(
        () => registry.registerMany([
            createProvider('activitybar'),
            createProvider('invalid provider')
        ]),
        /ID estable/
    );

    assert.equal(registry.getProviders().length, 0);
    assert.equal(registry.getRevision(), 0);
});

test('rejects duplicate IDs inside a batch atomically', () => {
    const registry = createSettingsRegistry();

    assert.throws(
        () => registry.registerMany([
            createProvider('core.ui'),
            createProvider('core.ui')
        ]),
        /Ya existe un proveedor/
    );

    assert.equal(registry.getProviders().length, 0);
    assert.equal(registry.getRevision(), 0);
});

test('requires the complete provider contract', () => {
    const registry = createSettingsRegistry();

    assert.throws(
        () => registry.register({
            id: 'activitybar',
            label: 'ActivityBar',
            version: 1,
            readSettings: () => ({})
        }),
        /validateSettings/
    );
});

test('notifies subscribers once per successful registry mutation', () => {
    const registry = createSettingsRegistry();
    let notifications = 0;
    const unsubscribe = registry.subscribe(() => {
        notifications += 1;
    });

    const dispose = registry.registerMany([
        createProvider('activitybar', { order: 20 }),
        createProvider('core.ui', { order: 10 })
    ]);

    assert.equal(notifications, 1);
    assert.equal(registry.getRevision(), 1);
    assert.deepEqual(
        registry.getProviders().map((provider) => provider.id),
        ['core.ui', 'activitybar']
    );

    dispose();
    assert.equal(notifications, 2);
    assert.equal(registry.getRevision(), 2);
    assert.equal(registry.getProviders().length, 0);

    unsubscribe();
    registry.register(createProvider('spectrum'));
    assert.equal(notifications, 2);
});

test('disposers are idempotent', () => {
    const registry = createSettingsRegistry();
    const dispose = registry.register(createProvider('yearbook.explorer'));

    assert.equal(dispose(), true);
    assert.equal(dispose(), false);
    assert.equal(registry.has('yearbook.explorer'), false);
});
