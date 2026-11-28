import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildMainMenuPopupItems,
    buildMainMenuTree,
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

test('converts the main menu tree to popup items and retains command identities', () => {
    const tree = [{
        type: 'submenu',
        label: 'File',
        children: [
            { type: 'command', label: 'Open', guid: '{open}', enabled: true },
            { type: 'separator' },
            {
                type: 'submenu',
                label: 'Recent',
                children: [{
                    type: 'command',
                    label: 'Recent file',
                    guid: '{recent}',
                    subGuid: '{file-1}',
                    source: 'mainmenu_dynamic',
                    checked: true,
                    enabled: true
                }]
            },
            { type: 'command', label: 'Unavailable', guid: '{disabled}', enabled: false }
        ]
    }];

    const converted = buildMainMenuPopupItems(tree);
    const root = converted.items[0];
    assert.equal(root.label, 'File');
    assert.deepEqual(root.submenu.map((item) => item.type || item.label), [
        'Open',
        'separator',
        'Recent',
        'Unavailable'
    ]);
    const recent = root.submenu[2].submenu[0];
    assert.equal(recent.checked, true);
    assert.equal(recent.enabled, true);
    assert.deepEqual(converted.commandById.get(recent.id), tree[0].children[2].children[0]);
    assert.equal(converted.commandById.get(root.submenu[0].id).guid, '{open}');
    assert.equal(root.submenu[3].enabled, false);
});

test('omits hidden entries and empty submenus from the native popup model', () => {
    const converted = buildMainMenuPopupItems([
        { type: 'command', label: 'Hidden', guid: '{hidden}', hidden: true },
        { type: 'submenu', label: 'Empty', children: [] },
        { type: 'separator' }
    ]);
    assert.deepEqual(converted.items, [{ type: 'separator' }]);
});
