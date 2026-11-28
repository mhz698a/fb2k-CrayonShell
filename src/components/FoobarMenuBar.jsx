import { useCallback, useEffect, useRef, useState } from 'react';
import { getFooSdk } from '../services/fooSdk.js';
import {
    buildMainMenuTree,
    getMenuNodeLabel,
    isMenuCommandExecutable
} from '../utils/foobarMenu.js';

const FaIcon = ({ name }) => <i className={'fa ' + name} aria-hidden="true" />;

function MenuEntries({
    nodes = [],
    pathPrefix,
    openSubmenus,
    onOpenSubmenu,
    onToggleSubmenu,
    onRunCommand,
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

        if (node.type === 'submenu' && children.length > 0) {
            const expanded = openSubmenus.includes(path);
            return (
                <div key={path}
                    className={'foobar-menubar-submenu' + (expanded ? ' is-open' : '')}
                    onMouseEnter={() => onOpenSubmenu(path)}>
                    <button type="button" className="foobar-menubar-item"
                        role="menuitem" aria-haspopup="menu" aria-expanded={expanded}
                        onClick={() => onToggleSubmenu(path)}>
                        <span>{label}</span>
                        <FaIcon name="fa-angle-right" />
                    </button>
                    {expanded && (
                        <div className="foobar-menubar-flyout" role="menu">
                            <MenuEntries
                                nodes={children}
                                pathPrefix={path}
                                openSubmenus={openSubmenus}
                                onOpenSubmenu={onOpenSubmenu}
                                onToggleSubmenu={onToggleSubmenu}
                                onRunCommand={onRunCommand}
                                executing={executing}
                            />
                        </div>
                    )}
                </div>
            );
        }

        const executable = isMenuCommandExecutable(node);
        return (
            <button key={path} type="button" role="menuitem"
                className={'foobar-menubar-item'
                    + (node.checked === true || node.radioChecked === true ? ' is-checked' : '')}
                disabled={!executable || executing}
                title={!executable ? (node.unaddressableReason || 'Comando no disponible') : label}
                onClick={() => onRunCommand(node)}>
                <span className="foobar-menubar-check">
                    {node.checked === true || node.radioChecked === true
                        ? <FaIcon name="fa-check" />
                        : null}
                </span>
                <span>{label}</span>
            </button>
        );
    });
}

export default function FoobarMenuBar({ isDemoMode = false }) {
    const menuBarRef = useRef(null);
    const sdkRef = useRef(null);
    const loadRevisionRef = useRef(0);
    const [items, setItems] = useState([]);
    const [activeRoot, setActiveRoot] = useState('');
    const [openSubmenus, setOpenSubmenus] = useState([]);
    const [loading, setLoading] = useState(!isDemoMode);
    const [executing, setExecuting] = useState(false);
    const [error, setError] = useState('');

    const closeMenus = useCallback(() => {
        setActiveRoot('');
        setOpenSubmenus([]);
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
        const handlePointerDown = (event) => {
            if (!menuBarRef.current?.contains(event.target)) closeMenus();
        };
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') closeMenus();
        };
        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [closeMenus]);

    const openSubmenu = useCallback((path) => {
        setOpenSubmenus((current) => [
            ...current.filter((candidate) => path.startsWith(candidate + '/')),
            path
        ]);
    }, []);

    const toggleSubmenu = useCallback((path) => {
        setOpenSubmenus((current) => current.includes(path)
            ? current.filter((candidate) => candidate !== path && !candidate.startsWith(path + '/'))
            : [...current.filter((candidate) => path.startsWith(candidate + '/')), path]);
    }, []);

    const runCommand = useCallback(async (node) => {
        if (executing) return;
        const address = node.guid || node.path;
        if (!address) return;

        setExecuting(true);
        setError('');
        try {
            const sdk = sdkRef.current || getFooSdk();
            if (typeof sdk.menu?.runMainMenuCommand !== 'function') {
                throw new Error('El SDK no expone fb.menu.runMainMenuCommand().');
            }
            const options = node.subGuid ? { subGuid: node.subGuid } : undefined;
            const response = await sdk.menu.runMainMenuCommand(address, options);
            if (response?.success === false) {
                throw new Error(response.error || response.message || response.code || 'El comando de foobar2000 no se ejecutó.');
            }
            closeMenus();
            await loadMainMenu();
        } catch (cause) {
            setError(cause?.message || 'No se pudo ejecutar el comando de foobar2000.');
        } finally {
            setExecuting(false);
        }
    }, [closeMenus, executing, loadMainMenu]);

    return (
        <nav ref={menuBarRef} className="foobar-menubar" aria-label="Menú principal de foobar2000">
            {isDemoMode ? (
                <span className="foobar-menubar-note">Menú principal nativo disponible en foobar2000</span>
            ) : (
                <>
                    <div className="foobar-menubar-items">
                        {items.map((node, index) => {
                            if (!node || node.hidden === true || node.type === 'separator') return null;
                            const rootId = 'root-' + index;
                            const label = getMenuNodeLabel(node);
                            const children = Array.isArray(node.children) ? node.children : [];
                            const hasSubmenu = node.type === 'submenu' && children.length > 0;
                            const opened = activeRoot === rootId;

                            if (!hasSubmenu) {
                                const executable = isMenuCommandExecutable(node);
                                return (
                                    <button key={rootId} type="button"
                                        className="foobar-menubar-root-button"
                                        disabled={!executable || executing}
                                        onClick={() => runCommand(node)}>
                                        {label}
                                    </button>
                                );
                            }

                            return (
                                <div key={rootId} className="foobar-menubar-root"
                                    onMouseEnter={() => {
                                        if (activeRoot) {
                                            setActiveRoot(rootId);
                                            setOpenSubmenus([]);
                                        }
                                    }}>
                                    <button type="button"
                                        className={'foobar-menubar-root-button' + (opened ? ' is-open' : '')}
                                        aria-haspopup="menu" aria-expanded={opened}
                                        onClick={() => {
                                            setActiveRoot(opened ? '' : rootId);
                                            setOpenSubmenus([]);
                                        }}>
                                        {label}
                                    </button>
                                    {opened && (
                                        <div className="foobar-menubar-dropdown" role="menu">
                                            <MenuEntries
                                                nodes={children}
                                                pathPrefix={rootId}
                                                openSubmenus={openSubmenus}
                                                onOpenSubmenu={openSubmenu}
                                                onToggleSubmenu={toggleSubmenu}
                                                onRunCommand={runCommand}
                                                executing={executing}
                                            />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <div className="foobar-menubar-feedback" aria-live="polite">
                        {loading ? 'Cargando menús…' : error ? 'Menú no disponible' : ''}
                    </div>
                    {error && <span className="sr-only" role="status">{error}</span>}
                </>
            )}
        </nav>
    );
}
