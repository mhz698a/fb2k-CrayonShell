import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ACTIVITY_BAR_CONFIG_VERSION,
    createDefaultActivityBarConfig
} from '../src/features/activitybar/config/defaults.js';
import {
    normalizeActivityBarConfig,
    parseActivityBarConfig
} from '../src/features/activitybar/config/schema.js';
import { FA4_ICON_NAMES, isFa4IconName } from '../src/features/activitybar/icons/fa4Catalog.js';

test('La configuración predeterminada incluye el botón para mostrar el panel izquierdo', () => {
    const config = createDefaultActivityBarConfig();

    assert.equal(config.version, ACTIVITY_BAR_CONFIG_VERSION);
    assert.equal(config.buttons.length, 1);
    assert.deepEqual(config.buttons[0], {
        id: 'ui.toggleSidebar',
        actionId: 'ui.toggleSidebar',
        label: 'Panel izquierdo',
        icon: 'columns'
    });
});

test('El esquema rechaza formatos y versiones incompatibles', () => {
    assert.throws(
        () => normalizeActivityBarConfig(null),
        /debe ser un objeto/
    );
    assert.throws(
        () => normalizeActivityBarConfig({ version: 99, buttons: [] }),
        /Versión de configuración no compatible/
    );
    assert.throws(
        () => normalizeActivityBarConfig({ version: ACTIVITY_BAR_CONFIG_VERSION, buttons: {} }),
        /lista de botones válida/
    );
});

test('La normalización elimina botones duplicados y nombres inválidos', () => {
    const config = normalizeActivityBarConfig({
        version: ACTIVITY_BAR_CONFIG_VERSION,
        buttons: [
            { id: 'one', actionId: 'playlist.refresh', label: 'Actualizar', icon: 'refresh' },
            { id: 'two', actionId: 'playlist.refresh', label: 'Duplicado', icon: 'trash' },
            { id: 'one', actionId: 'diagnostics.open', label: 'Diagnóstico', icon: 'bug' },
            { id: 'three', actionId: 'playlist.refresh', label: 'Duplicado', icon: 'not-a-real-icon' }
        ]
    });

    assert.equal(config.buttons.length, 1);
    assert.equal(config.buttons[0].actionId, 'playlist.refresh');
    assert.equal(config.buttons[0].icon, 'refresh');
});

test('La importación valida JSON y configura iconos de Font Awesome 4', () => {
    const imported = parseActivityBarConfig(JSON.stringify({
        version: ACTIVITY_BAR_CONFIG_VERSION,
        buttons: [
            { id: 'video', actionId: 'ui.toggleContentView', label: 'Visor', icon: 'video-camera' }
        ]
    }));

    assert.equal(imported.buttons[0].icon, 'video-camera');
    assert.throws(
        () => parseActivityBarConfig('{ json incompleto'),
        /JSON válido/
    );
});

test('El selector utiliza el catálogo completo de nombres de Font Awesome 4.7.0', () => {
    assert.ok(FA4_ICON_NAMES.length >= 675);
    for (const name of ['columns', 'cogs', 'folder-open', 'video-camera', 'music', 'refresh']) {
        assert.equal(isFa4IconName(name), true);
    }
    assert.equal(isFa4IconName('solid-user'), false);
});
