import FacetColumn from './FacetColumn.jsx';
import { useLibraryFacets } from '../../hooks/useLibraryFacets.js';

function formatProgress(progress) {
    if (!progress || !progress.total) {
        return progress?.fetched
            ? progress.fetched.toLocaleString('es-MX') + ' pistas'
            : 'Preparando…';
    }
    return progress.fetched.toLocaleString('es-MX')
        + ' / '
        + progress.total.toLocaleString('es-MX');
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
        selectYear,
        selectSubfolder,
        clearYears,
        clearSubfolders,
        refresh
    } = useLibraryFacets(visible);

    const isLoading = status === 'loading';
    const showProgress = isLoading && progress && progress.total > 0;
    const progressValue = showProgress
        ? Math.min(100, (progress.fetched / progress.total) * 100)
        : 0;

    return (
        <div className="refacets-panel">
            <header className="refacets-heading">
                <div className="refacets-title">
                    <strong>ReFacets</strong>
                    <span className={'refacets-status is-' + status} title={message}>
                        {status === 'ready' ? 'Conectado'
                            : status === 'loading' ? 'Indexando'
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
                    title="Actualizar Media Library"
                    aria-label="Actualizar Media Library"
                    disabled={isLoading || status === 'unavailable' || status === 'waiting'}
                    onClick={refresh}
                >
                    ↻
                </button>
            </header>

            {isLoading && (
                <div className="refacets-progress" aria-live="polite">
                    <span>{formatProgress(progress)}</span>
                    {showProgress && (
                        <div
                            className="refacets-progress-track"
                            role="progressbar"
                            aria-label="Indexación de Media Library"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(progressValue)}
                        >
                            <span style={{ width: progressValue + '%' }} />
                        </div>
                    )}
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
                    emptyMessage={status === 'loading' ? 'Cargando años…' : 'No hay años.'}
                />
                <FacetColumn
                    title="Subfolders"
                    items={subfolders}
                    selectedValues={selectedSubfolders}
                    onSelect={selectSubfolder}
                    onClear={clearSubfolders}
                    emptyMessage={status === 'loading' ? 'Cargando carpetas…' : 'No hay subcarpetas.'}
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
                <span className="facet-selection-hint">Ctrl + clic: múltiple</span>
            </footer>
        </div>
    );
}
