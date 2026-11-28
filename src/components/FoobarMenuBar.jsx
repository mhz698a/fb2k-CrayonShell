import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getFooSdk } from '../services/fooSdk.js';
import {
    buildMainMenuTree,
    getMenuCommandInvocation,
    getMenuNodeLabel,
    isMenuCommandExecutable
} from '../utils/foobarMenu.js';

const ROOT_MENU_WIDTH = 252;
const SUBMENU_WIDTH = 248;

function getRootMenuPosition(button) {
    const rect = button.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;

    return {
        left: Math.max(8, Math.min(rect.left, viewportWidth - ROOT_MENU_WIDTH - 8)),
        top: rect.bottom
    };
}

function getSubmenuPosition(button) {
    const rect = button.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const menuWidth = Math.min(SUBMENU_WIDTH, viewportWidth - 16);
    const opensRight = rect.right + menuWidth <= viewportWidth - 8;

    return {
        left: Math.max(8, opensRight ? rect.right - 3 : rect.left - menuWidth + 3),
        top: Math.max(8, Math.min(rect.top, viewportHeight - 90))
    };
}

function MenuEntries({
    nodes = [],
    pathPrefix,
    openSubmenus,
    submenuPositions,
    onOpenSubmenu,
    onRunCommand,
    onMenuKeyDown,
    executing
}) {
    return nodes.map((node, index) => {
        if (!node || node.hidden === true) return null;
        const path = pathPrefix + '/' + index;

        if (node.type === 'separator') {
            return <div key={path} className="foobar-menubar-separator" role="separator" />;
        }

        const label = getMenuNodeLabel(node);
        const children = Array.isArray(node.children)
            ? node.children.filter((child) => child && child.hidden !== true)
            : [];
        const hasSubmenu = node.type === 'submenu' && children.length > 0;

        if (hasSubmenu) {
            const expanded = openSubmenus.includes(path);
            const position = submenuPositions[path];

            return (
                <div key={path} className="foobar-menubar-entry">
                    <button type="button"
                        className={'foobar-menubar-item foobar-menubar-submenu-button'
                            + (expanded ? ' is-submenu-open' : '')}
                        role="menuitem" aria-haspopup="menu" aria-expanded={expanded}
                        disabled={executing || node.enabled === false || node.available === false}
                        onMouseEnter={(event) => onOpenSubmenu(path, event.currentTarget)}
                        onClick={(event) => onOpenSubmenu(path, event.currentTarget)}>
                        <span className="foobar-menubar-check" />
                        <span className="foobar-menubar-label">{label}</span>
                        <i className="fa fa-angle-right foobar-menubar-submenu-arrow" aria-hidden="true" />
                    </button>
                    {expanded && position && createPortal(
                        <div className="foobar-menubar-flyout"
                            role="menu"
                            aria-label={label}
                            data-foobar-menu-popup="true"
                            style={{ left: position.left, top: position.top }}
                            onKeyDown={onMenuKeyDown}>
                            <MenuEntries
                                nodes={children}
                                pathPrefix={path}
                                openSubmenus={openSubmenus}
                                submenuPositions={submenuPositions}
                                onOpenSubmenu={onOpenSubmenu}
                                onRunCommand={onRunCommand}
                                executing={executing}
                            />
                        </div>,
                        document.body
                    )}
                </div>
            );
        }

        const executable = isMenuCommandExecutable(node);
        const checked = node.checked === true || node.radioChecked === true;
        return (
            <button key={path} type="button"
                role="menuitem"
                className="foobar-menubar-item"
                disabled={!executable || executing}
                title={!executable ? (node.unaddressableReason || 'Comando no disponible') : label}
                onClick={() => onRunCommand(node)}>
                <span className="foobar-menubar-check">
                    {checked && <i className="fa fa-check" aria-hidden="true" />}
                </span>
                <span className="foobar-menubar-label">{label}</span>
                <span className="foobar-menubar-submenu-arrow" />
            </button>
        );
    });
}

export default function FoobarMenuBar({ isDemoMode = false }) {
    const menuBarRef = useRef(null);
    const rootMenuRef = useRef(null);
    const sdkRef = useRef(null);
    const loadRevisionRef = useRef(0);
    const executingRef = useRef(false);
    const [items, setItems] = useState([]);
    const [activeRoot, setActiveRoot] = useState(null);
    const [rootMenuPosition, setRootMenuPosition] = useState(null);
    const [openSubmenus, setOpenSubmenus] = useState([]);
    const [submenuPositions, setSubmenuPositions] = useState({});
    const [loading, setLoading] = useState(!isDemoMode);
    const [executing, setExecuting] = useState(false);
    const [error, setError] = useState('');

    const closeMenus = useCallback(() => {
        setActiveRoot(null);
        setRootMenuPosition(null);
        setOpenSubmenus([]);
        setSubmenuPositions({});
    }, []);

    const loadMainMenu = useCallback(async () => {
        if (isDemoMode) {
            setLoading(false);
            return;
        }

        const revision = ++loadRevisionRef.current;
        setLoading(true);
        try {
            const sdk = getFooSdk();
            if (typeof sdk.menu?.getMainMenu !== 'function') {
                throw new Error('El SDK no expone fb.menu.getMainMenu().');
            }

            sdkRef.current = sdk;
            const response = await sdk.menu.getMainMenu(undefined, { withAvailability: true });
            if (response?.success === false) {
                throw new Error(response.error || response.message || 'No se pudo leer el menú principal.');
            }

            if (revision !== loadRevisionRef.current) return;
            setItems(buildMainMenuTree(response?.items, response?.fallback === 'flat-mainmenu-commands'));
            setError('');
        } catch (cause) {
            if (revision !== loadRevisionRef.current) return;
            setError(cause?.message || 'No se pudo cargar el menú principal de foobar2000.');
            setItems([]);
        } finally {
            if (revision === loadRevisionRef.current) setLoading(false);
        }
    }, [isDemoMode]);

    useEffect(() => {
        void loadMainMenu();
        return () => {
            loadRevisionRef.current += 1;
        };
    }, [loadMainMenu]);

    useEffect(() => {
        if (activeRoot !== null) {
            rootMenuRef.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
        }
    }, [activeRoot]);

    useEffect(() => {
        const handlePointerDown = (event) => {
            if (menuBarRef.current?.contains(event.target)) return;
            if (event.target?.closest?.('[data-foobar-menu-popup="true"]')) return;
            closeMenus();
        };
        const handleKeyDown = (event) => {
            if (event.key === 'Escape' && activeRoot !== null) {
                event.preventDefault();
                closeMenus();
            }
        };

        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [activeRoot, closeMenus]);

    const openSubmenu = useCallback((path, button) => {
        if (!button) return;
        const position = getSubmenuPosition(button);
        setOpenSubmenus((current) => [
            ...current.filter((candidate) => path.startsWith(candidate + '/')),
            path
        ]);
        setSubmenuPositions((current) => {
            const next = {};
            Object.entries(current).forEach(([candidate, value]) => {
                if (path.startsWith(candidate + '/')) next[candidate] = value;
            });
            next[path] = position;
            return next;
        });
    }, []);

    const handleMenuKeyDown = useCallback((event) => {
        const menu = event.currentTarget;
        const enabledItems = Array.from(menu.querySelectorAll('[role="menuitem"]:not(:disabled)'));
        const currentIndex = enabledItems.indexOf(document.activeElement);

        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (enabledItems.length === 0) return;
            event.preventDefault();
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            const nextIndex = currentIndex < 0
                ? (direction > 0 ? 0 : enabledItems.length - 1)
                : (currentIndex + direction + enabledItems.length) % enabledItems.length;
            enabledItems[nextIndex].focus();
        } else if (event.key === 'Home' || event.key === 'End') {
            if (enabledItems.length === 0) return;
            event.preventDefault();
            enabledItems[event.key === 'Home' ? 0 : enabledItems.length - 1].focus();
        } else if (event.key === 'ArrowLeft') {
            if (openSubmenus.length > 0) {
                event.preventDefault();
                const closingPath = openSubmenus[openSubmenus.length - 1];
                setOpenSubmenus((current) => current.filter((path) => path !== closingPath));
                setSubmenuPositions((current) => {
                    const next = { ...current };
                    delete next[closingPath];
                    return next;
                });
            } else {
                closeMenus();
            }
        }
    }, [closeMenus, openSubmenus]);

    const runCommand = useCallback(async (node) => {
        if (executingRef.current) return;
        const invocation = getMenuCommandInvocation(node);
        if (!invocation) return;

        executingRef.current = true;
        setExecuting(true);
        setError('');
        closeMenus();

        try {
            const sdk = sdkRef.current || getFooSdk();
            if (typeof sdk.menu?.runMainMenuCommand !== 'function') {
                throw new Error('El SDK no expone fb.menu.runMainMenuCommand().');
            }

            const response = await sdk.menu.runMainMenuCommand(
                invocation.address,
                invocation.options
            );
            if (response?.success === false) {
                throw new Error(
                    response.error
                    || response.message
                    || response.code
                    || 'El comando de foobar2000 no se ejecutó.'
                );
            }
            await loadMainMenu();
        } catch (cause) {
            setError(cause?.message || 'No se pudo ejecutar el comando de foobar2000.');
        } finally {
            executingRef.current = false;
            setExecuting(false);
        }
    }, [closeMenus, loadMainMenu]);

    const handleRootMouseEnter = useCallback((rootId, node, button) => {
        const children = Array.isArray(node.children) ? node.children : [];
        if (activeRoot === null || activeRoot === rootId || node.type !== 'submenu' || children.length === 0) {
            return;
        }
        setActiveRoot(rootId);
        setRootMenuPosition(getRootMenuPosition(button));
        setOpenSubmenus([]);
        setSubmenuPositions({});
    }, [activeRoot]);

    const handleRootClick = useCallback((node, rootId, button) => {
        if (executingRef.current) return;
        const children = Array.isArray(node.children) ? node.children : [];
        const hasSubmenu = node.type === 'submenu' && children.length > 0;

        if (!hasSubmenu) {
            void runCommand(node);
            return;
        }

        if (activeRoot === rootId) {
            closeMenus();
            return;
        }

        setActiveRoot(rootId);
        setRootMenuPosition(getRootMenuPosition(button));
        setOpenSubmenus([]);
        setSubmenuPositions({});
    }, [activeRoot, closeMenus, runCommand]);

    const activeNode = activeRoot === null ? null : items[Number(activeRoot)];
    const activeChildren = Array.isArray(activeNode?.children) ? activeNode.children : [];

    return (
        <nav ref={menuBarRef} className="foobar-menubar" aria-label="Menú principal de foobar2000">
            {isDemoMode ? (
                <span className="foobar-menubar-note">Menú principal disponible en foobar2000</span>
            ) : (
                <>
                    <div className="foobar-menubar-items">
                        {items.map((node, index) => {
                            if (!node || node.hidden === true || node.type === 'separator') return null;
                            const rootId = String(index);
                            const hasSubmenu = node.type === 'submenu'
                                && Array.isArray(node.children)
                                && node.children.some((child) => child && child.hidden !== true);
                            const executable = isMenuCommandExecutable(node);
                            const label = getMenuNodeLabel(node);
                            const opened = activeRoot === rootId;
                            const disabled = executing || (hasSubmenu
                                ? node.enabled === false || node.available === false
                                : !executable);

                            return (
                                <button key={rootId} type="button"
                                    className={'foobar-menubar-root-button' + (opened ? ' is-open' : '')}
                                    aria-haspopup={hasSubmenu ? 'menu' : undefined}
                                    aria-expanded={hasSubmenu ? opened : undefined}
                                    disabled={disabled}
                                    title={hasSubmenu ? 'Abrir menú ' + label : label}
                                    onMouseEnter={(event) => handleRootMouseEnter(rootId, node, event.currentTarget)}
                                    onClick={(event) => handleRootClick(node, rootId, event.currentTarget)}>
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                    <div className="foobar-menubar-feedback" aria-live="polite">
                        {loading ? 'Cargando menús…' : error ? 'Menú no disponible' : ''}
                    </div>
                    {error && <span className="sr-only" role="status">{error}</span>}
                    {activeNode && rootMenuPosition && createPortal(
                        <div ref={rootMenuRef}
                            className="foobar-menubar-dropdown"
                            role="menu"
                            aria-label={getMenuNodeLabel(activeNode)}
                            data-foobar-menu-popup="true"
                            style={{ left: rootMenuPosition.left, top: rootMenuPosition.top }}
                            onKeyDown={handleMenuKeyDown}>
                            <MenuEntries
                                nodes={activeChildren}
                                pathPrefix={'root-' + activeRoot}
                                openSubmenus={openSubmenus}
                                submenuPositions={submenuPositions}
                                onOpenSubmenu={openSubmenu}
                                onRunCommand={runCommand}
                                onMenuKeyDown={handleMenuKeyDown}
                                executing={executing}
                            />
                        </div>,
                        document.body
                    )}
                </>
            )}
        </nav>
    );
}
