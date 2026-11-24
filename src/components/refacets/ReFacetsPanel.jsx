import FacetColumn from './FacetColumn.jsx';
import { useLibraryFacets } from '../../hooks/useLibraryFacets.js';

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
        years,
        subfolders,
        selectedYears,
        selectedSubfolders,
        filteredCount,
        playlistSyncStatus,
        playlistSyncMessage,
        selectYear,
        selectSubfolder,
        clearYears,
        clearSubfolders,
        refresh
    } = useLibraryFacets(visible);

    const isLoading = status === 'loading';

    return (
        <div className="refacets-panel">
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

            <div className="refacets-columns">
                <FacetColumn
                    title="Years"
                    items={years}
                    selectedValues={selectedYears}
                    onSelect={selectYear}
                    onClear={clearYears}
                    emptyMessage={isLoading ? 'Consultando años…' : 'No hay años.'}
                />
                <FacetColumn
                    title="Subfolders"
                    items={subfolders}
                    selectedValues={selectedSubfolders}
                    onSelect={selectSubfolder}
                    onClear={clearSubfolders}
                    emptyMessage={isLoading ? 'Consultando carpetas…' : 'No hay subcarpetas.'}
                />
            </div>

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
        </div>
    );
}
