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

    useEffect(() => {
        return () => {
            window.clearTimeout(clickTimerRef.current);
        };
    }, []);

    function handleClick(index) {
        window.clearTimeout(clickTimerRef.current);

        // The short delay lets a double-click cancel the single-click action.
        clickTimerRef.current = window.setTimeout(() => {
            clickTimerRef.current = null;
            onSelect(index);
        }, 220);
    }

    function handleDoubleClick(index) {
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
        onPlay(index);
    }

    function handleContextMenu(event, index) {
        event.preventDefault();
        event.stopPropagation();
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
        onContextMenu(index);
    }

    const emptyMessage = totalItems === 0
        ? 'No hay pistas en la playlist activa.'
        : 'No hay coincidencias para el filtro.';

    return (
        <div className="playlist-table-wrap">
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

