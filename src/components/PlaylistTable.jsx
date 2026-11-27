import { useEffect, useRef } from 'react';
import { formatItemLine, formatItemSubtitle } from '../utils/playlistDisplay.js';

export default function PlaylistTable({
    items,
    totalItems,
    focusedItem,
    playingItemIndex,
    playbackState,
    playlistGuid,
    scrollRequest = { version: 0, target: 'playing' },
    onSelect,
    onPlay,
    onContextMenu
}) {
    const clickTimerRef = useRef(null);
    const tableWrapRef = useRef(null);
    const keyboardFocusRef = useRef(focusedItem);
    const previousNavigationRef = useRef({
        focusedItem,
        playingItemIndex,
        playlistGuid,
        scrollRequestVersion: scrollRequest.version
    });

    useEffect(() => {
        return () => {
            window.clearTimeout(clickTimerRef.current);
        };
    }, []);

    useEffect(() => {
        keyboardFocusRef.current = focusedItem;
    }, [focusedItem, playlistGuid]);

    // Keep the playing/focused row visible after playback, focus and playlist events.
    useEffect(() => {
        const previous = previousNavigationRef.current;
        const playingChanged = previous.playingItemIndex !== playingItemIndex;
        const focusedChanged = previous.focusedItem !== focusedItem;
        const playlistChanged = previous.playlistGuid !== playlistGuid;
        const requestChanged = previous.scrollRequestVersion !== scrollRequest.version;

        previousNavigationRef.current = {
            focusedItem,
            playingItemIndex,
            playlistGuid,
            scrollRequestVersion: scrollRequest.version
        };

        let targetIndex = -1;
        if (requestChanged) {
            targetIndex = scrollRequest.target === 'focused'
                ? focusedItem
                : playingItemIndex;
        } else if (playingChanged) {
            targetIndex = playingItemIndex;
        } else if (focusedChanged) {
            targetIndex = focusedItem;
        } else if (playlistChanged) {
            targetIndex = playingItemIndex >= 0 ? playingItemIndex : focusedItem;
        }

        if (!Number.isInteger(targetIndex) || targetIndex < 0) return;

        const viewport = tableWrapRef.current;
        if (!viewport) return;

        const row = Array.from(viewport.querySelectorAll('tr[data-index]'))
            .find((element) => Number(element.dataset.index) === targetIndex);
        if (!row) return;

        const viewportBounds = viewport.getBoundingClientRect();
        const rowBounds = row.getBoundingClientRect();
        const centerPlayingRow = playingChanged
            || (requestChanged && scrollRequest.target === 'playing')
            || (playlistChanged && playingItemIndex >= 0);

        if (centerPlayingRow) {
            const rowCenter = rowBounds.top + rowBounds.height / 2;
            const viewportCenter = viewportBounds.top + viewport.clientHeight / 2;
            const desiredScrollTop = viewport.scrollTop + rowCenter - viewportCenter;
            const maximumScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
            viewport.scrollTop = Math.max(0, Math.min(maximumScrollTop, desiredScrollTop));
        } else if (rowBounds.top < viewportBounds.top) {
            viewport.scrollTop -= viewportBounds.top - rowBounds.top;
        } else if (rowBounds.bottom > viewportBounds.bottom) {
            viewport.scrollTop += rowBounds.bottom - viewportBounds.bottom;
        }
    }, [focusedItem, playingItemIndex, playlistGuid, scrollRequest.version, scrollRequest.target]);

    function focusPlaylist() {
        tableWrapRef.current?.focus({ preventScroll: true });
    }

    function handleClick(index) {
        focusPlaylist();
        keyboardFocusRef.current = index;
        window.clearTimeout(clickTimerRef.current);

        // The short delay lets a double-click cancel the single-click action.
        clickTimerRef.current = window.setTimeout(() => {
            clickTimerRef.current = null;
            onSelect(index);
        }, 220);
    }

    function handleDoubleClick(index) {
        focusPlaylist();
        keyboardFocusRef.current = index;
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
        onPlay(index);
    }

    function handleKeyDown(event) {
        if (event.altKey || event.ctrlKey || event.metaKey) return;

        if (event.key === 'Enter') {
            const selected = items.find((item) => item.index === keyboardFocusRef.current);
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
        const currentPosition = items.findIndex((item) => item.index === keyboardFocusRef.current);
        const nextPosition = currentPosition < 0
            ? (direction > 0 ? 0 : items.length - 1)
            : Math.max(0, Math.min(items.length - 1, currentPosition + direction));

        const nextItem = items[nextPosition];
        if (nextItem && nextItem.index !== keyboardFocusRef.current) {
            keyboardFocusRef.current = nextItem.index;
            onSelect(nextItem.index);
        }
    }

    function handleContextMenu(event, index) {
        event.preventDefault();
        event.stopPropagation();
        focusPlaylist();
        keyboardFocusRef.current = index;
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
                        const subtitle = formatItemSubtitle(item);

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
                                <td className="playlist-line" title={line + '\n' + subtitle}>
                                    <div className="playlist-primary-line">{line}</div>
                                    <div className="playlist-secondary-line">{subtitle}</div>
                                </td>
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

