import { useRef, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import PlaylistToolbar from './components/PlaylistToolbar.jsx';
import PlaylistTable from './components/PlaylistTable.jsx';
import PlaylistStatus from './components/PlaylistStatus.jsx';
import MediaPlaybackProbe from './components/MediaPlaybackProbe.jsx';
import { usePlaylist } from './hooks/usePlaylist.js';
import { formatItemLine } from './utils/playlistDisplay.js';

const MIN_SIDEBAR_WIDTH = 140;
const MAX_SIDEBAR_WIDTH = 520;
const DEFAULT_SIDEBAR_WIDTH = 250;

function clampSidebarWidth(width, containerWidth) {
    const availableMaximum = Math.max(
        MIN_SIDEBAR_WIDTH,
        Math.min(MAX_SIDEBAR_WIDTH, containerWidth * 0.55)
    );

    return Math.round(
        Math.min(availableMaximum, Math.max(MIN_SIDEBAR_WIDTH, width))
    );
}

export default function App() {
    const containerRef = useRef(null);
    const draggingRef = useRef(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
    const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
    const [filter, setFilter] = useState('');
    const [contentView, setContentView] = useState('playlist');
    const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

    const {
        playlists,
        activePlaylistGuid,
        items,
        focusedItem,
        playingItemIndex,
        playbackState,
        status,
        scrollRequest,
        isDemoMode,
        refreshPlaylist,
        changePlaylist,
        selectItem,
        playItem,
        openNativeContextMenu
    } = usePlaylist();

    const activePlaylist = playlists.find(
        (playlist) => playlist.guid === activePlaylistGuid
    );

    const normalizedFilter = filter.trim().toLocaleLowerCase();
    const visibleItems = items.filter((item) => {
        const line = formatItemLine(item, playingItemIndex, playbackState);
        return !normalizedFilter
            || line.toLocaleLowerCase().includes(normalizedFilter)
            || String(item.path || '').toLocaleLowerCase().includes(normalizedFilter);
    });

    const summary = !activePlaylist
        ? 'Sin playlist activa'
        : visibleItems.length === items.length
            ? items.length + ' pistas'
            : visibleItems.length + ' / ' + items.length + ' pistas';

    function handlePointerDown(event) {
        if (sidebarCollapsed || event.button !== 0) return;

        draggingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        containerRef.current?.classList.add('resizing');
        event.preventDefault();
    }

    function handlePointerMove(event) {
        if (!draggingRef.current || !containerRef.current) return;

        const bounds = containerRef.current.getBoundingClientRect();
        setSidebarWidth(
            clampSidebarWidth(event.clientX - bounds.left, bounds.width)
        );
    }

    function stopDragging(event) {
        if (!draggingRef.current) return;
        if (event && event.pointerId !== undefined
            && event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }

        draggingRef.current = false;
        containerRef.current?.classList.remove('resizing');
    }

    function handleResizerKeyDown(event) {
        const step = event.shiftKey ? 40 : 10;
        let nextWidth = sidebarWidth;

        if (event.key === 'ArrowLeft') nextWidth -= step;
        else if (event.key === 'ArrowRight') nextWidth += step;
        else if (event.key === 'Home') nextWidth = MIN_SIDEBAR_WIDTH;
        else if (event.key === 'End') nextWidth = MAX_SIDEBAR_WIDTH;
        else return;

        event.preventDefault();
        const width = containerRef.current?.clientWidth || window.innerWidth;
        setSidebarWidth(clampSidebarWidth(nextWidth, width));
    }

    function handleResizerDoubleClick() {
        const width = containerRef.current?.clientWidth || window.innerWidth;
        setSidebarWidth(clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH, width));
    }

    return (
        <div
            ref={containerRef}
            className={'cui-container' + (sidebarCollapsed ? ' sidebar-collapsed' : '')}
            style={{ '--sidebar-width': sidebarWidth + 'px' }}
        >
            <Sidebar />

            <div
                className="sidebar-resizer"
                role="separator"
                aria-label="Cambiar ancho del panel lateral"
                aria-orientation="vertical"
                aria-valuemin={MIN_SIDEBAR_WIDTH}
                aria-valuemax={MAX_SIDEBAR_WIDTH}
                aria-valuenow={sidebarWidth}
                tabIndex={sidebarCollapsed ? -1 : 0}
                title="Arrastrar para cambiar el ancho"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={stopDragging}
                onPointerCancel={stopDragging}
                onLostPointerCapture={() => {
                    draggingRef.current = false;
                    containerRef.current?.classList.remove('resizing');
                }}
                onKeyDown={handleResizerKeyDown}
                onDoubleClick={handleResizerDoubleClick}
            />

            <main className="main-playlist">
                <section id="PlaylistPanel" aria-label="Playlist">
                    <PlaylistToolbar
                        playlists={playlists}
                        activePlaylistGuid={activePlaylistGuid}
                        filter={filter}
                        summary={summary}
                        onFilterChange={setFilter}
                        onPlaylistChange={changePlaylist}
                        onRefresh={refreshPlaylist}
                        sidebarCollapsed={sidebarCollapsed}
                        onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
                        contentView={contentView}
                        onToggleContentView={() => setContentView((value) => (
                            value === 'playlist' ? 'video' : 'playlist'
                        ))}
                        onOpenDiagnostics={() => setDiagnosticsOpen(true)}
                    />

                    {isDemoMode && (
                        <div className="demo-notice">
                            Modo de demostración: los datos no proceden de foobar2000.
                        </div>
                    )}

                    <div className="playlist-content">
                        <div
                            className={'playlist-list-view' + (contentView === 'playlist' ? '' : ' is-hidden')}
                            aria-hidden={contentView !== 'playlist'}
                        >
                            <PlaylistTable
                                items={visibleItems}
                                totalItems={items.length}
                                focusedItem={focusedItem}
                                playingItemIndex={playingItemIndex}
                                playbackState={playbackState}
                                playlistGuid={activePlaylistGuid}
                                scrollRequest={scrollRequest}
                                onSelect={selectItem}
                                onPlay={playItem}
                                onContextMenu={openNativeContextMenu}
                            />
                        </div>
                        <MediaPlaybackProbe
                            viewMode={contentView}
                            diagnosticsOpen={diagnosticsOpen}
                            onCloseDiagnostics={() => setDiagnosticsOpen(false)}
                        />
                    </div>

                    <PlaylistStatus message={status} />
                </section>
            </main>
        </div>
    );
}

