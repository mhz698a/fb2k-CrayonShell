import { useEffect, useRef, useState } from 'react';
import FacetColumn from './FacetColumn.jsx';
import { useLibraryFacets } from '../../hooks/useLibraryFacets.js';

const PREFS_KEY = 'crayonshell.refacets.presentation.v1';
const COLUMN_SPLIT_STORAGE_KEY = 'crayonshell.refacets.columnSplit.v1';
const DEFAULT_YEARS_WIDTH = 50;
const MIN_YEARS_WIDTH = 25;
const MAX_YEARS_WIDTH = 75;
const DEFAULT_PREFS = {
    showHeader: true,
    showFooter: true,
    yearsCount: true,
    subfoldersCount: true
};

function readColumnSplit() {
    try {
        const value = Number(window.localStorage.getItem(COLUMN_SPLIT_STORAGE_KEY));
        return Number.isFinite(value)
            ? Math.max(MIN_YEARS_WIDTH, Math.min(MAX_YEARS_WIDTH, value))
            : DEFAULT_YEARS_WIDTH;
    } catch {
        return DEFAULT_YEARS_WIDTH;
    }
}

function readPrefs() {
    try {
        const stored = JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}');
        return { ...DEFAULT_PREFS, ...stored };
    } catch {
        return { ...DEFAULT_PREFS };
    }
}

function formatProgress(progress) {
    if (!progress) return 'Preparando consulta…';
    return (Number(progress.fetched) || 0).toLocaleString('es-MX') + ' carpetas consultadas';
}

export default function ReFacetsPanel({ visible = true }) {
    const {
        status,
        message,
        progress,
        totalTracks,
        directoryCount,
        years,
        subfolders,
        selectedYears,
        selectedSubfolders,
        filteredCount,
        playlistSyncStatus,
        playlistSyncMessage,
        diagnostics,
        addDiagnostic,
        openFacetFolder,
        selectYear,
        selectSubfolder,
        clearYears,
        clearSubfolders,
        refresh
    } = useLibraryFacets(visible);

    const [prefs, setPrefs] = useState(readPrefs);
    const [menu, setMenu] = useState(null);
    const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
    const menuRef = useRef(null);
    const columnsRef = useRef(null);
    const columnDraggingRef = useRef(false);
    const [yearsWidth, setYearsWidth] = useState(readColumnSplit);
    const [isColumnResizing, setIsColumnResizing] = useState(false);
    const isLoading = status === 'loading';

    useEffect(() => {
        try {
            window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
        } catch {
            // Las preferencias permanecen activas durante esta sesión.
        }
    }, [prefs]);

    useEffect(() => {
        try {
            window.localStorage.setItem(COLUMN_SPLIT_STORAGE_KEY, String(yearsWidth));
        } catch {
            // Keep the current column proportions for this session.
        }
    }, [yearsWidth]);

    function handleColumnSplitterPointerDown(event) {
        if (event.button !== 0) return;
        columnDraggingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        setIsColumnResizing(true);
        event.preventDefault();
    }

    function handleColumnSplitterPointerMove(event) {
        if (!columnDraggingRef.current || !columnsRef.current) return;
        const bounds = columnsRef.current.getBoundingClientRect();
        if (bounds.width <= 0) return;
        const nextWidth = ((event.clientX - bounds.left) / bounds.width) * 100;
        setYearsWidth(Math.round(Math.max(
            MIN_YEARS_WIDTH,
            Math.min(MAX_YEARS_WIDTH, nextWidth)
        )));
    }

    function stopColumnSplitterDrag(event) {
        if (!columnDraggingRef.current) return;
        if (event?.pointerId !== undefined
            && event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        columnDraggingRef.current = false;
        setIsColumnResizing(false);
    }

    function handleColumnSplitterKeyDown(event) {
        const step = event.shiftKey ? 10 : 2;
        let nextWidth = yearsWidth;
        if (event.key === 'ArrowLeft') nextWidth -= step;
        else if (event.key === 'ArrowRight') nextWidth += step;
        else if (event.key === 'Home') nextWidth = MIN_YEARS_WIDTH;
        else if (event.key === 'End') nextWidth = MAX_YEARS_WIDTH;
        else return;
        event.preventDefault();
        setYearsWidth(Math.max(MIN_YEARS_WIDTH, Math.min(MAX_YEARS_WIDTH, nextWidth)));
    }

    useEffect(() => {
        if (!menu) return undefined;
        function dismiss(event) {
            if (!menuRef.current?.contains(event.target)) setMenu(null);
        }
        function escape(event) {
            if (event.key === 'Escape') setMenu(null);
        }
        document.addEventListener('pointerdown', dismiss);
        document.addEventListener('keydown', escape);
        return () => {
            document.removeEventListener('pointerdown', dismiss);
            document.removeEventListener('keydown', escape);
        };
    }, [menu]);

    function openColumnMenu(event, column, value) {
        event.preventDefault();
        const width = 245;
        const height = 330;
        setMenu({
            column,
            value,
            left: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
            top: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8))
        });
    }

    function updatePref(key, value) {
        setPrefs((current) => ({ ...current, [key]: value }));
    }

    async function revealFolder() {
        if (!menu?.value) return;
        try {
            await openFacetFolder(menu.column, menu.value);
        } catch (error) {
            addDiagnostic('error', 'No se pudo abrir la carpeta en Explorer', error.message || String(error));
        }
        setMenu(null);
    }

    function clearColumnSelection() {
        if (menu?.column === 'year') clearYears();
        else clearSubfolders();
        setMenu(null);
    }

    function toggleCount() {
        const key = menu?.column === 'year' ? 'yearsCount' : 'subfoldersCount';
        updatePref(key, !prefs[key]);
        setMenu(null);
    }

    return (
        <div className="refacets-panel">
            {prefs.showHeader && (
                <header className="refacets-heading">
                    <div className="refacets-title">
                        <strong>ReFacets</strong>
                        <span className={'refacets-status is-' + status} title={message}>
                            {status === 'ready' ? 'Conectado'
                                : status === 'loading' ? 'Consultando'
                                    : status === 'waiting' ? 'Esperando'
                                        : status === 'disabled' ? 'Deshabilitada'
                                            : status === 'unavailable' ? 'Sin conexión'
                                                : status === 'error' ? 'Error'
                                                    : 'Sin iniciar'}
                        </span>
                    </div>
                    <button
                        type="button"
                        className="refacets-refresh"
                        title="Actualizar estructura de Media Library"
                        aria-label="Actualizar estructura de Media Library"
                        disabled={isLoading || status === 'unavailable' || status === 'waiting'}
                        onClick={refresh}
                    >
                        ↻
                    </button>
                </header>
            )}

            {isLoading && (
                <div className="refacets-progress" aria-live="polite">
                    <span>{formatProgress(progress)}</span>
                </div>
            )}

            {(status === 'waiting' || status === 'disabled'
                || status === 'unavailable' || status === 'error') && (
                <div className={'refacets-message is-' + status} title={message}>
                    {message}
                </div>
            )}

            <div
                ref={columnsRef}
                className={'refacets-columns' + (isColumnResizing ? ' is-resizing' : '')}
                style={{ '--refacets-years-width': yearsWidth + '%' }}
            >
                <FacetColumn
                    title="Years"
                    items={years}
                    selectedValues={selectedYears}
                    onSelect={selectYear}
                    onClear={clearYears}
                    onContextMenu={openColumnMenu}
                    showCount={prefs.yearsCount}
                    showHeader={prefs.showHeader}
                    emptyMessage={isLoading ? 'Consultando años…' : 'No hay años.'}
                />
                <div
                    className="refacets-column-splitter"
                    role="separator"
                    aria-label="Cambiar el ancho entre Years y Subfolders"
                    aria-orientation="vertical"
                    aria-valuemin={MIN_YEARS_WIDTH}
                    aria-valuemax={MAX_YEARS_WIDTH}
                    aria-valuenow={yearsWidth}
                    tabIndex={visible ? 0 : -1}
                    title="Arrastrar para cambiar el ancho de las columnas"
                    onPointerDown={handleColumnSplitterPointerDown}
                    onPointerMove={handleColumnSplitterPointerMove}
                    onPointerUp={stopColumnSplitterDrag}
                    onPointerCancel={stopColumnSplitterDrag}
                    onLostPointerCapture={() => {
                        columnDraggingRef.current = false;
                        setIsColumnResizing(false);
                    }}
                    onKeyDown={handleColumnSplitterKeyDown}
                    onDoubleClick={() => setYearsWidth(DEFAULT_YEARS_WIDTH)}
                />
                <FacetColumn
                    title="Subfolders"
                    items={subfolders}
                    selectedValues={selectedSubfolders}
                    onSelect={selectSubfolder}
                    onClear={clearSubfolders}
                    onContextMenu={openColumnMenu}
                    showCount={prefs.subfoldersCount}
                    showHeader={prefs.showHeader}
                    emptyMessage={isLoading ? 'Consultando carpetas…' : 'No hay subcarpetas.'}
                />
            </div>

            {prefs.showFooter && (
                <footer className="refacets-footer">
                    <span title={filteredCount + ' pistas coincidentes'}>
                        {filteredCount.toLocaleString('es-MX')} pistas
                    </span>
                    <span>
                        {selectedYears.length + selectedSubfolders.length > 0
                            ? selectedYears.length + selectedSubfolders.length + ' filtros'
                            : totalTracks.toLocaleString('es-MX') + ' en biblioteca'}
                    </span>
                    {playlistSyncMessage && (
                        <span
                            className={'facet-playlist-status is-' + playlistSyncStatus}
                            title={playlistSyncMessage}
                        >
                            {playlistSyncMessage}
                        </span>
                    )}
                    <span className="facet-selection-hint">Ctrl + clic: múltiple</span>
                </footer>
            )}

            {menu && (
                <div
                    ref={menuRef}
                    className="refacets-context-menu"
                    role="menu"
                    style={{ left: menu.left + 'px', top: menu.top + 'px' }}
                    onContextMenu={(event) => event.preventDefault()}
                >
                    <button type="button" role="menuitem" disabled={!menu.value} onClick={revealFolder}>
                        Open Folder in Explorer
                    </button>
                    <button type="button" role="menuitem" onClick={clearColumnSelection}>
                        Limpiar selección de {menu.column === 'year' ? 'Years' : 'Subfolders'}
                    </button>
                    <div className="refacets-menu-separator" />
                    <button type="button" role="menuitem" disabled={isLoading} onClick={() => {
                        refresh();
                        setMenu(null);
                    }}>
                        Actualizar estructura mediante Media Library
                    </button>
                    <button type="button" role="menuitem" onClick={toggleCount}>
                        {prefs[menu.column === 'year' ? 'yearsCount' : 'subfoldersCount']
                            ? 'Ocultar' : 'Mostrar'} conteo de archivos en esta columna
                    </button>
                    <button type="button" role="menuitem" onClick={() => {
                        updatePref('showHeader', !prefs.showHeader);
                        setMenu(null);
                    }}>
                        {prefs.showHeader ? 'Ocultar' : 'Mostrar'} encabezado
                    </button>
                    <button type="button" role="menuitem" onClick={() => {
                        updatePref('showFooter', !prefs.showFooter);
                        setMenu(null);
                    }}>
                        {prefs.showFooter ? 'Ocultar' : 'Mostrar'} pie
                    </button>
                    <div className="refacets-menu-separator" />
                    <button type="button" role="menuitem" onClick={() => {
                        setDiagnosticsOpen(true);
                        setMenu(null);
                    }}>
                        Diagnóstico…
                    </button>
                </div>
            )}

            {diagnosticsOpen && (
                <div className="refacets-diagnostics-backdrop" onMouseDown={(event) => {
                    if (event.target === event.currentTarget) setDiagnosticsOpen(false);
                }}>
                    <section className="refacets-diagnostics" role="dialog" aria-modal="true" aria-labelledby="ReFacetsDiagnosticsTitle">
                        <header>
                            <strong id="ReFacetsDiagnosticsTitle">Diagnóstico de ReFacets</strong>
                            <button type="button" aria-label="Cerrar diagnóstico" onClick={() => setDiagnosticsOpen(false)}>×</button>
                        </header>
                        <div className="refacets-diagnostics-summary">
                            <div><span>Estado</span><strong>{status}</strong></div>
                            <div><span>Carpetas</span><strong>{directoryCount.toLocaleString('es-MX')}</strong></div>
                            <div><span>Pistas coincidentes</span><strong>{filteredCount.toLocaleString('es-MX')}</strong></div>
                            <div><span>Playlist</span><strong>{playlistSyncStatus}</strong></div>
                        </div>
                        <p className="refacets-diagnostics-current">{message}</p>
                        <div className="refacets-diagnostics-log">
                            {diagnostics.length === 0 ? (
                                <div className="facet-empty">Todavía no hay eventos registrados.</div>
                            ) : diagnostics.slice().reverse().map((entry) => (
                                <article key={entry.id} className={'refacets-diagnostic-entry is-' + entry.level}>
                                    <time>{entry.time}</time>
                                    <div><strong>{entry.message}</strong>{entry.details && <span>{entry.details}</span>}</div>
                                </article>
                            ))}
                        </div>
                        <footer>
                            <button type="button" className="spectrum-primary-button" onClick={() => setDiagnosticsOpen(false)}>Cerrar</button>
                        </footer>
                    </section>
                </div>
            )}
        </div>
    );
}
