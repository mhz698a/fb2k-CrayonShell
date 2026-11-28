import { useEffect, useMemo, useRef, useState } from 'react';
import { formatItemLine, formatItemSubtitle } from '../utils/playlistDisplay.js';
import { rankPlaylistItems } from '../features/playlistManager/spotlightSearch.js';

export default function SpotlightDialog({
    open = false,
    items = [],
    playingItemIndex = -1,
    playbackState = 'stopped',
    onPlay,
    onClose
}) {
    const dialogRef = useRef(null);
    const inputRef = useRef(null);
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const results = useMemo(() => rankPlaylistItems(items, query), [items, query]);
    const visibleResults = results.slice(0, 80);

    useEffect(() => {
        if (!open) {
            if (dialogRef.current?.open) dialogRef.current.close();
            setQuery('');
            setActiveIndex(0);
            return;
        }

        const dialog = dialogRef.current;
        if (dialog && !dialog.open) dialog.showModal();
        inputRef.current?.focus();
    }, [open]);

    useEffect(() => {
        setActiveIndex(0);
    }, [query]);

    useEffect(() => {
        const row = dialogRef.current?.querySelector('[data-spotlight-index="' + activeIndex + '"]');
        row?.scrollIntoView?.({ block: 'nearest' });
    }, [activeIndex]);

    function close() {
        if (dialogRef.current?.open) dialogRef.current.close();
        onClose?.();
    }

    function play(item) {
        if (!item) return;
        close();
        void onPlay?.(item.index);
    }

    function handleKeyDown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
            return;
        }

        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (visibleResults.length === 0) return;
            event.preventDefault();
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            setActiveIndex((current) => Math.max(
                0,
                Math.min(visibleResults.length - 1, current + direction)
            ));
            return;
        }

        if (event.key === 'Enter' && visibleResults.length > 0) {
            event.preventDefault();
            play(visibleResults[Math.max(0, Math.min(visibleResults.length - 1, activeIndex))]);
        }
    }

    return (
        <dialog ref={dialogRef} className="spotlight-dialog"
            aria-label="Buscar pistas en la playlist actual"
            onCancel={(event) => {
                event.preventDefault();
                close();
            }}
            onClick={(event) => {
                if (event.target === dialogRef.current) close();
            }}>
            <div className="spotlight-panel">
                <div className="spotlight-search-field">
                    <i className="fa fa-search" aria-hidden="true" />
                    <input ref={inputRef} type="search"
                        className="spotlight-search-input"
                        placeholder="Buscar en la playlist actual…"
                        aria-label="Buscar pistas"
                        aria-controls="SpotlightResults"
                        aria-keyshortcuts="ArrowUp ArrowDown Enter Escape"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={handleKeyDown} />
                    <button type="button" className="spotlight-clear"
                        aria-label="Limpiar búsqueda" title="Limpiar búsqueda"
                        disabled={!query}
                        onClick={() => {
                            setQuery('');
                            setActiveIndex(0);
                            inputRef.current?.focus();
                        }}>
                        <i className="fa fa-times" aria-hidden="true" />
                    </button>
                </div>

                <div id="SpotlightResults" className="spotlight-results" role="listbox"
                    aria-label="Resultados de búsqueda">
                    {!query.trim() ? (
                        <div className="spotlight-empty">
                            Escribe para buscar una canción de la playlist activa.
                        </div>
                    ) : visibleResults.length === 0 ? (
                        <div className="spotlight-empty">No se encontraron coincidencias.</div>
                    ) : (
                        visibleResults.map((item, index) => (
                            <button key={item.index} type="button" role="option"
                                aria-selected={index === activeIndex}
                                data-spotlight-index={index}
                                className={'spotlight-result' + (index === activeIndex ? ' is-active' : '')}
                                onMouseEnter={() => setActiveIndex(index)}
                                onClick={() => play(item)}>
                                <span className="spotlight-result-primary">
                                    {formatItemLine(item, playingItemIndex, playbackState)}
                                </span>
                                <span className="spotlight-result-secondary">
                                    {formatItemSubtitle(item)}
                                </span>
                            </button>
                        ))
                    )}
                </div>

                <footer className="spotlight-footer">
                    <span>{query.trim() ? results.length + ' coincidencias' : 'Playlist actual'}</span>
                    <span><kbd>↑</kbd><kbd>↓</kbd> navegar <kbd>Enter</kbd> reproducir <kbd>Esc</kbd> cerrar</span>
                </footer>
            </div>
        </dialog>
    );
}
