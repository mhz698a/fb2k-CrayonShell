import { useCallback, useEffect, useRef, useState } from 'react';
import { getFooSdk } from '../services/fooSdk.js';
import {
    buildMainMenuNativeItems,
    buildMainMenuTree,
    getMenuNodeLabel,
    isMenuCommandExecutable
} from '../utils/foobarMenu.js';

export default function FoobarMenuBar({ isDemoMode = false }) {
    const sdkRef = useRef(null);
    const loadRevisionRef = useRef(0);
    const executingRef = useRef(false);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(!isDemoMode);
    const [executing, setExecuting] = useState(false);
    const [error, setError] = useState('');

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

    const runCommand = useCallback(async (node, sdk) => {
        const address = node.guid || node.path;
        if (!address || !isMenuCommandExecutable(node)) return;

        if (typeof sdk.menu?.runMainMenuCommand !== 'function') {
            throw new Error('El SDK no expone fb.menu.runMainMenuCommand().');
        }

        const response = await sdk.menu.runMainMenuCommand(
            address,
            node.subGuid ? { subGuid: node.subGuid } : undefined
        );
        if (response?.success === false) {
            throw new Error(
                response.error
                || response.message
                || response.code
                || 'El comando de foobar2000 no se ejecutó.'
            );
        }
    }, []);

    const handleRootClick = useCallback(async (node) => {
        if (executingRef.current) return;
        executingRef.current = true;
        setExecuting(true);
        setError('');

        try {
            const sdk = sdkRef.current || getFooSdk();
            const children = Array.isArray(node.children) ? node.children : [];

            if (node.type === 'submenu' && children.length > 0) {
                if (typeof sdk.notification?.showCustomMenu !== 'function') {
                    throw new Error('El SDK no expone fb.notification.showCustomMenu().');
                }

                const { items: nativeItems, commandById } = buildMainMenuNativeItems(children);
                if (nativeItems.length === 0) return;

                // This is a host-owned Win32 popup menu, not a WebView overlay
                // or a frameless CrayonShell child window.
                const response = await sdk.notification.showCustomMenu({
                    items: nativeItems
                });
                if (response?.success === false) {
                    throw new Error(
                        response.error
                        || response.message
                        || response.code
                        || 'No se pudo abrir el menú nativo de foobar2000.'
                    );
                }

                const selectedId = response?.selectedId;
                if (!selectedId) return;
                const command = commandById.get(selectedId);
                if (!command) return;

                await runCommand(command, sdk);
            } else {
                await runCommand(node, sdk);
            }

            await loadMainMenu();
        } catch (cause) {
            setError(cause?.message || 'No se pudo ejecutar el comando de foobar2000.');
        } finally {
            executingRef.current = false;
            setExecuting(false);
        }
    }, [loadMainMenu, runCommand]);

    return (
        <nav className="foobar-menubar" aria-label="Menú principal de foobar2000">
            {isDemoMode ? (
                <span className="foobar-menubar-note">Menú principal nativo disponible en foobar2000</span>
            ) : (
                <>
                    <div className="foobar-menubar-items">
                        {items.map((node, index) => {
                            if (!node || node.hidden === true || node.type === 'separator') return null;
                            const hasSubmenu = node.type === 'submenu'
                                && Array.isArray(node.children)
                                && node.children.length > 0;
                            const executable = isMenuCommandExecutable(node);
                            const label = getMenuNodeLabel(node);

                            return (
                                <button key={index} type="button"
                                    className="foobar-menubar-root-button"
                                    aria-haspopup={hasSubmenu ? 'menu' : undefined}
                                    disabled={executing || (hasSubmenu ? false : !executable)}
                                    title={hasSubmenu ? 'Abrir menú ' + label : label}
                                    onClick={() => handleRootClick(node)}>
                                    {label}
                                </button>
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
