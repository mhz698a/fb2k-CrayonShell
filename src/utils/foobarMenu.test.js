import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildMainMenuTree,
    getMenuCommandInvocation,
    getMenuNodeLabel,
    isMenuCommandExecutable
} from './foobarMenu.js';

test('builds a hierarchy from the flat native main-menu fallback', () => {
    const tree = buildMainMenuTree([
        { type: 'command', path: 'File/Open', guid: '{open}', enabled: true },
        { type: 'command', path: 'File/Exit', guid: '{exit}', enabled: true },
        { type: 'command', path: 'Playback/Play', guid: '{play}', enabled: true }
    ], true);

    assert.deepEqual(tree.map((node) => node.displayLabel), ['File', 'Playback']);
    assert.deepEqual(tree[0].children.map((node) => node.displayLabel), ['Open', 'Exit']);
    assert.equal(tree[0].children[0].guid, '{open}');
    assert.equal(tree[1].children[0].guid, '{play}');
});

test('keeps non-flat SDK menu trees unchanged', () => {
    const items = [
        { type: 'submenu', label: 'File', children: [{ type: 'command', label: 'Exit', guid: '{exit}' }] }
    ];
    assert.deepEqual(buildMainMenuTree(items, false), items);
});

test('uses translated labels and disables commands without a usable address', () => {
    assert.equal(getMenuNodeLabel({ label: 'File/Open', displayLabel: 'Abrir' }), 'Abrir');
    assert.equal(isMenuCommandExecutable({ type: 'command', guid: '{open}', enabled: true }), true);
    assert.equal(isMenuCommandExecutable({ type: 'command', guid: '{open}', enabled: false }), false);
    assert.equal(isMenuCommandExecutable({ type: 'command', enabled: true }), false);
    assert.equal(isMenuCommandExecutable({ type: 'command', path: 'File/Open', executable: false }), false);
});

test('dynamic main-menu commands require both GUID and subGuid', () => {
    assert.equal(isMenuCommandExecutable({
        type: 'command',
        source: 'mainmenu_dynamic',
        guid: '{parent}',
        enabled: true
    }), false);
    assert.equal(isMenuCommandExecutable({
        type: 'command',
        source: 'mainmenu_dynamic',
        guid: '{parent}',
        subGuid: '{child}',
        enabled: true
    }), true);
});

test('builds exact SDK invocations for static and dynamic menu commands', () => {
    assert.deepEqual(
        getMenuCommandInvocation({
            type: 'command',
            path: 'File/Open',
            enabled: true
        }),
        {
            address: 'File/Open',
            options: undefined
        }
    );

    assert.deepEqual(
        getMenuCommandInvocation({
            type: 'command',
            source: 'mainmenu_dynamic',
            guid: '{parent-guid}',
            subGuid: '{dynamic-guid}',
            enabled: true
        }),
        {
            address: '{parent-guid}',
            options: { subGuid: '{dynamic-guid}' }
        }
    );

    assert.equal(getMenuCommandInvocation({
        type: 'command',
        source: 'mainmenu_dynamic',
        guid: '{parent-guid}',
        enabled: true
    }), null);
});
