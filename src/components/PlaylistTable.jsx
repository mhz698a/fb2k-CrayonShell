import { useEffect, useRef } from 'react';
import { formatItemLine } from '../utils/playlistDisplay.js';

export default function PlaylistTable({
    items,
    totalItems,
    focusedItem,
    playingItemIndex,
    playbackState,
    playlistGuid,
    onSelect,
    onPlay,
    onContextMenu
}) {
    const clickTimerRef = useRef(null);
    const tableWrapRef = useRef(null);
    const previousNavigationRef = useRef({
        focusedItem,
        playingItemIndex,
        playlistGuid
    });

    useEffect(() => {
        return () => {
            window.clearTimeout(clickTimerRef.current);
        };
    }, []);

    // Keep the active playback item or the keyboard-focused item visible in the list.
    useEffect(() => {
        const previous = previousNavigationRef.current;
        const playingChanged = previous.playingItemIndex !== playingItemIndex
            || previous.playlistGuid !== playlistGuid;
        const focusedChanged = previous.focusedItem !== focusedItem;

        previousNavigationRef.current = {
            focusedItem,
            playingItemIndex,
            playlistGuid
        };

        const targetIndex = playingChanged && playingItemIndex >= 0
            ? playingItemIndex
            : focusedChanged && focusedItem >= 0
                ? focusedItem
                : playingItemIndex >= 0
                    ? playingItemIndex
                    : focusedItem;

        if (!Number.isInteger(targetIndex) || targetIndex < 0) return;

        const viewport = tableWrapRef.current;
        if (!viewport) return;

        const row = Array.from(viewport.querySelectorAll('tr[data-index]'))
            .find((element) => Number(element.dataset.index) === targetIndex);
        if (!row) return;

        const viewportBounds = viewport.getBoundingClientRect();
        const rowBounds = row.getBoundingClientRect();

        if (rowBounds.top < viewportBounds.top) {
            viewport.scrollTop -= viewportBounds.top - rowBounds.top;
        } else if (rowBounds.bottom > viewportBounds.bottom) {
            viewport.scrollTop += rowBounds.bottom - viewportBounds.bottom;
        }
    }, [focusedItem, playingItemIndex, playlistGuid]);

    function focusPlaylist() {
        tableWrapRef.current?.focus({ preventScroll: true });
    }

    function handleClick(index) {
        focusPlaylist();
        window.clearTimeout(clickTimerRef.current);

        // The short delay lets a double-click cancel the single-click action.
        clickTimerRef.current = window.setTimeout(() => {
            clickTimerRef.current = null;
            onSelect(index);
        }, 220);
    }

    function handleDoubleClick(index) {
        focusPlaylist();
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
        onPlay(index);
    }

    function handleKeyDown(event) {
        if (event.altKey || event.ctrlKey || event.metaKey) return;

        if (event.key === 'Enter') {
            const selected = items.find((item) => item.index === focusedItem);
            if (!selected) return;

            event.preventDefault();
            event.stopPropagation();
            window.clearTimeout(clickTimerRef.current);
            clickTimerRef.current = null;
            onPlay(selected.index);
            return;
        }

        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        if (items.length === 0) return;

        event.preventDefault();
        event.stopPropagation();
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;

        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const currentPosition = items.findIndex((item) => item.index === focusedItem);
        const nextPosition = currentPosition < 0
            ? (direction > 0 ? 0 : items.length - 1)
            : Math.max(0, Math.min(items.length - 1, currentPosition + direction));

        const nextItem = items[nextPosition];
        if (nextItem && nextItem.index !== focusedItem) {
            onSelect(nextItem.index);
        }
    }

    function handleContextMenu(event, index) {
        event.preventDefault();
        event.stopPropagation();
        focusPlaylist();
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
        onContextMenu(index);
    }

    const emptyMessage = totalItems === 0
        ? 'No hay pistas en la playlist activa.'
        : 'No hay coincidencias para el filtro.';

    return (
        <div
            ref={tableWrapRef}
            className="playlist-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Pistas de la playlist. Usa las flechas para seleccionar y Enter para reproducir."
            aria-keyshortcuts="ArrowUp ArrowDown Enter"
            onKeyDown={handleKeyDown}
        >
            <table id="PlaylistTable" aria-label="Pistas de la playlist">
                <tbody id="PlaylistRows">
                    {items.map((item) => {
                        const isFocused = item.index === focusedItem;
                        const isPlaying = item.index === playingItemIndex;
                        const line = formatItemLine(item, playingItemIndex, playbackState);

                        return (
                            <tr
                                key={playlistGuid + ':' + item.index}
                                data-index={item.index}
                                className={(isFocused ? 'focused ' : '') + (isPlaying ? 'playing' : '')}
                                aria-selected={isFocused}
                                onClick={() => handleClick(item.index)}
                                onDoubleClick={() => handleDoubleClick(item.index)}
                                onContextMenu={(event) => handleContextMenu(event, item.index)}
                            >
                                <td className="playlist-line" title={line}>{line}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            {items.length === 0 && (
                <div id="PlaylistEmpty" className="visible">{emptyMessage}</div>
            )}
        </div>
    );
}

