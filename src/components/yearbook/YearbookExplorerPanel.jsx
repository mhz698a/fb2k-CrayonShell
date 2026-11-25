import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getFooSdk } from '../../services/fooSdk.js';
import {
    getYearDirectories,
    isAlbumContainer,
    joinWindowsPath,
    listYearbookDirectories,
    openYearbookDirectory
} from '../../features/yearbook/yearbookService.js';
import {
    YEARBOOK_EXPLORER_YEARBOOK_EXPLORER_EXPANDED_STORAGE_KEY,
    readYearbookExpandedPaths
} from '../../features/yearbook/yearbookExplorerSettings.js';

export default function YearbookExplorerPanel({
    visible = false,
    externalTools = {},
    onOpenSettings
}) {
    const rootPath = String(externalTools?.internalBasePath || '').trim();
    const [directoriesByPath, setDirectoriesByPath] = useState({});
    const [expandedPaths, setExpandedPaths] = useState(() => readYearbookExpandedPaths(rootPath));
    const [selectedNode, setSelectedNode] = useState(null);
    const [loadingPaths, setLoadingPaths] = useState(() => new Set());
    const [error, setError] = useState('');
    const [opening, setOpening] = useState(false);
    const directoryCacheRef = useRef({});
    const pendingLoadsRef = useRef(new Map());
    const generationRef = useRef(0);
    const previousRootPathRef = useRef(rootPath);

    const loadDirectories = useCallback(async (path, force = false) => {
        if (!path) return [];
        if (!force && Object.prototype.hasOwnProperty.call(directoryCacheRef.current, path)) {
            return directoryCacheRef.current[path];
        }
        if (pendingLoadsRef.current.has(path)) {
            return pendingLoadsRef.current.get(path);
        }

        const generation = generationRef.current;
        setLoadingPaths((current) => new Set([...current, path]));
        const pending = (async () => {
            try {
                const directories = await listYearbookDirectories(getFooSdk(), path);
                if (generation !== generationRef.current) return [];
                directoryCacheRef.current = {
                    ...directoryCacheRef.current,
                    [path]: directories
                };
                setDirectoriesByPath(directoryCacheRef.current);
                setError('');
                return directories;
            } catch (loadError) {
                if (generation === generationRef.current) {
                    setError(loadError?.message || String(loadError));
                }
                return [];
            } finally {
                if (pendingLoadsRef.current.get(path) === pending) {
                    pendingLoadsRef.current.delete(path);
                }
                if (generation === generationRef.current) {
                    setLoadingPaths((current) => {
                        const next = new Set(current);
                        next.delete(path);
                        return next;
                    });
                }
            }
        })();

        pendingLoadsRef.current.set(path, pending);
        return pending;
    }, []);

    useEffect(() => {
        if (previousRootPathRef.current !== rootPath) {
            previousRootPathRef.current = rootPath;
            generationRef.current += 1;
            directoryCacheRef.current = {};
            pendingLoadsRef.current.clear();
            setDirectoriesByPath({});
            setLoadingPaths(new Set());
            setExpandedPaths(readYearbookExpandedPaths(rootPath));
            setSelectedNode(null);
            setError('');
        }

        if (!visible || !rootPath) return;
        if (!Object.prototype.hasOwnProperty.call(directoryCacheRef.current, rootPath)) {
            loadDirectories(rootPath);
        }
    }, [visible, rootPath, loadDirectories]);

    useEffect(() => {
        if (!visible || !rootPath) return;
        for (const path of expandedPaths) {
            if (path.toLocaleLowerCase().startsWith(rootPath.toLocaleLowerCase())
                && !Object.prototype.hasOwnProperty.call(directoryCacheRef.current, path)) {
                loadDirectories(path);
            }
        }
    }, [visible, rootPath, expandedPaths, loadDirectories]);

    useEffect(() => {
        try {
            window.localStorage.setItem(YEARBOOK_EXPLORER_EXPANDED_STORAGE_KEY, JSON.stringify({
                rootPath,
                paths: [...expandedPaths].slice(0, 500)
            }));
        } catch {
            // The explorer remains usable without persistence for this session.
        }
    }, [rootPath, expandedPaths]);

    const years = useMemo(
        () => getYearDirectories(directoriesByPath[rootPath] || []),
        [directoriesByPath, rootPath]
    );
    const isLoading = loadingPaths.size > 0;
    const selectedIsAlbumChild = Boolean(selectedNode && isAlbumContainer(selectedNode.parentName));
    const openLabel = selectedIsAlbumChild ? 'Abrir en GalleryAnuary' : 'Abrir en Explorer';

    function toggleNode(node) {
        setSelectedNode(node);
        const willExpand = !expandedPaths.has(node.path);
        setExpandedPaths((current) => {
            const next = new Set(current);
            if (next.has(node.path)) next.delete(node.path);
            else next.add(node.path);
            return next;
        });
        if (willExpand && !Object.prototype.hasOwnProperty.call(directoryCacheRef.current, node.path)) {
            loadDirectories(node.path);
        }
    }

    async function openPath(path, gallery = false) {
        if (!path || opening) return;
        setOpening(true);
        setError('');
        try {
            await openYearbookDirectory(getFooSdk(), externalTools, path, { gallery });
        } catch (openError) {
            setError(openError?.message || String(openError));
        } finally {
            setOpening(false);
        }
    }

    function refreshRoot() {
        if (!rootPath || isLoading) return;
        generationRef.current += 1;
        directoryCacheRef.current = {};
        pendingLoadsRef.current.clear();
        setDirectoriesByPath({});
        setLoadingPaths(new Set());
        setExpandedPaths(new Set());
        setSelectedNode(null);
        setError('');
        loadDirectories(rootPath, true);
    }

    function renderNodes(names, parentPath, parentName, depth) {
        return names.map((name) => {
            const path = joinWindowsPath(parentPath, name);
            const node = { name, path, parentName, depth };
            const isExpanded = expandedPaths.has(path);
            const isSelected = selectedNode?.path === path;
            const children = directoriesByPath[path] || [];
            const isNodeLoading = loadingPaths.has(path);
            const hasCachedChildren = Object.prototype.hasOwnProperty.call(directoriesByPath, path);
            const canExpand = !hasCachedChildren || children.length > 0 || isNodeLoading;

            return (
                <Fragment key={path}>
                    <div
                        className={'yearbook-tree-row' + (isSelected ? ' is-selected' : '')}
                        style={{ '--tree-depth': depth }}
                    >
                        <button
                            type="button"
                            className="yearbook-tree-toggle"
                            aria-label={(isExpanded ? 'Contraer ' : 'Expandir ') + name}
                            aria-expanded={isExpanded}
                            disabled={!canExpand}
                            onClick={() => toggleNode(node)}
                        >
                            {isNodeLoading
                                ? <i className="fa fa-circle-o-notch fa-spin" aria-hidden="true" />
                                : <i className={'fa ' + (isExpanded ? 'fa-chevron-down' : 'fa-chevron-right')} aria-hidden="true" />}
                        </button>
                        <button
                            type="button"
                            className="yearbook-tree-label"
                            aria-current={isSelected ? 'true' : undefined}
                            title={path}
                            onClick={() => setSelectedNode(node)}
                            onDoubleClick={() => openPath(path, isAlbumContainer(parentName))}
                        >
                            <i className={'fa ' + (isExpanded ? 'fa-folder-open' : 'fa-folder')} aria-hidden="true" />
                            <span>{name}</span>
                        </button>
                    </div>
                    {isExpanded && (
                        <div className="yearbook-tree-children" role="group">
                            {isNodeLoading && children.length === 0
                                ? <div className="yearbook-tree-message">Cargando carpetas…</div>
                                : children.length
                                    ? renderNodes(children, path, name, depth + 1)
                                    : <div className="yearbook-tree-message">Sin subcarpetas</div>}
                        </div>
                    )}
                </Fragment>
            );
        });
    }

    return (
        <section className="yearbook-explorer-panel" aria-label="Yearbook Explorer">
            <header className="yearbook-explorer-heading">
                <div className="yearbook-explorer-title">
                    <strong>YEARBOOK EXPLORER</strong>
                    <span className={isLoading ? 'is-loading' : error ? 'is-error' : 'is-ready'}>
                        {isLoading ? 'Consultando' : error ? 'Error' : rootPath ? 'Explorador' : 'Sin configurar'}
                    </span>
                </div>
                <div className="yearbook-explorer-actions">
                    <button
                        type="button"
                        title="Actualizar Yearbook Explorer"
                        aria-label="Actualizar Yearbook Explorer"
                        disabled={!rootPath || isLoading}
                        onClick={refreshRoot}
                    >
                        <i className="fa fa-refresh" aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        title="Abrir raíz en Explorer"
                        aria-label="Abrir raíz en Explorer"
                        disabled={!rootPath || opening}
                        onClick={() => openPath(rootPath)}
                    >
                        <i className="fa fa-folder-open" aria-hidden="true" />
                    </button>
                </div>
            </header>

            <div className="yearbook-explorer-root" title={rootPath}>
                <i className="fa fa-hdd-o" aria-hidden="true" />
                <span>{rootPath || 'Raíz de Yearbook no configurada'}</span>
            </div>

            {error && <div className="yearbook-explorer-error" role="alert">{error}</div>}

            {!rootPath ? (
                <div className="yearbook-explorer-empty">
                    <i className="fa fa-folder-open-o" aria-hidden="true" />
                    <span>Configura la raíz que contiene las carpetas por año.</span>
                    <button type="button" onClick={onOpenSettings}>Configurar herramientas externas</button>
                </div>
            ) : (
                <div className="yearbook-tree" role="tree" aria-label="Años y carpetas">
                    {years.length
                        ? renderNodes(years, rootPath, '', 0)
                        : isLoading
                            ? <div className="yearbook-tree-message">Cargando años…</div>
                            : <div className="yearbook-tree-message">No se encontraron carpetas de año entre 1999 y el año actual.</div>}
                </div>
            )}

            <footer className="yearbook-explorer-footer">
                <span>{years.length.toLocaleString('es-MX')} años</span>
                <span className="yearbook-selected-path" title={selectedNode?.path || ''}>
                    {selectedNode?.path || 'Sin selección'}
                </span>
                <button
                    type="button"
                    disabled={!selectedNode || opening}
                    onClick={() => openPath(selectedNode.path, selectedIsAlbumChild)}
                >
                    <i className="fa fa-external-link" aria-hidden="true" />
                    <span>{opening ? 'Abriendo…' : openLabel}</span>
                </button>
            </footer>
        </section>
    );
}
