import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ActivityBar from './components/activitybar/ActivityBar.jsx';
import ActivityBarManagerDialog from './components/activitybar/ActivityBarManagerDialog.jsx';
import { useActivityBarConfig } from './features/activitybar/hooks/useActivityBarConfig.js';
import { useActivityBarActions } from './features/activitybar/hooks/useActivityBarActions.js';
import Sidebar from './components/Sidebar.jsx';
import PlaylistToolbar from './components/PlaylistToolbar.jsx';
import PlaylistTable from './components/PlaylistTable.jsx';
import PlaylistStatus from './components/PlaylistStatus.jsx';
import MediaPlaybackProbe from './components/MediaPlaybackProbe.jsx';
import { usePlaylist } from './hooks/usePlaylist.js';
import { formatItemLine, formatItemSubtitle } from './utils/playlistDisplay.js';

const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 520;
const DEFAULT_SIDEBAR_WIDTH = 320;
const SIDEBAR_WIDTH_STORAGE_KEY = 'crayonshell.sidebar.width.v1';
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'crayonshell.sidebar.collapsed.v1';

function readSidebarCollapsed() {
    try {
        const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
        return stored === null ? true : stored === 'true';
    } catch {
        return true;
    }
}

function readSidebarWidth() {
    try {
        const stored = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
        return Number.isFinite(stored) && stored >= MIN_SIDEBAR_WIDTH && stored <= MAX_SIDEBAR_WIDTH
            ? stored
            : DEFAULT_SIDEBAR_WIDTH;
    } catch {
        return DEFAULT_SIDEBAR_WIDTH;
    }
}

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
    const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
    const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
    const [filter, setFilter] = useState('');
    const [contentView, setContentView] = useState('playlist');
    const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
    const [activityActionError, setActivityActionError] = useState('');
    const [activityBarManagerOpen, setActivityBarManagerOpen] = useState(false);
    const {
        config: activityBarConfig,
        addButton: addActivityBarButton,
        removeButton: removeActivityBarButton,
        updateButton: updateActivityBarButton,
        moveButton: moveActivityBarButton,
        restoreDefaults: restoreActivityBarDefaults,
        replaceConfig: replaceActivityBarConfig
    } = useActivityBarConfig();

    const toggleSidebar = useCallback(() => {
        setSidebarCollapsed((value) => !value);
    }, []);

    const toggleContentView = useCallback(() => {
        setContentView((value) => value === 'playlist' ? 'video' : 'playlist');
    }, []);

    const openDiagnostics = useCallback(() => {
        setDiagnosticsOpen(true);
    }, []);

    const openActivityBarManager = useCallback(() => {
        setActivityBarManagerOpen(true);
    }, []);

    const closeActivityBarManager = useCallback(() => {
        setActivityBarManagerOpen(false);
    }, []);

    const reportActivityActionError = useCallback((failure) => {
        const message = failure.error?.message || 'Error desconocido al ejecutar la acción.';
        console.error('[ActivityBar] ' + failure.actionId + ': ' + message, failure.error?.cause);
        setActivityActionError(failure.actionId + ': ' + message);
    }, []);

    useEffect(() => {
        try {
            window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(sidebarCollapsed));
        } catch {
            // Keep the selected visibility for this session when storage is unavailable.
        }
    }, [sidebarCollapsed]);

    useEffect(() => {
        try {
            window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
        } catch {
            // Keep the current width for this session when storage is unavailable.
        }
    }, [sidebarWidth]);

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
        const subtitle = formatItemSubtitle(item);
        const searchableText = line + ' ' + subtitle;
        return !normalizedFilter
            || searchableText.toLocaleLowerCase().includes(normalizedFilter)
            || String(item.path || '').toLocaleLowerCase().includes(normalizedFilter);
    });

    const summary = !activePlaylist
        ? 'Sin playlist activa'
        : visibleItems.length === items.length
            ? items.length + ' pistas'
            : visibleItems.length + ' / ' + items.length + ' pistas';

    const activityBarContext = useMemo(() => ({
        sidebarCollapsed,
        contentView,
        toggleSidebar,
        toggleContentView,
        refreshPlaylist,
        openDiagnostics,
        openActivityBarManager,
        activityBarManagerOpen
    }), [
        sidebarCollapsed,
        contentView,
        toggleSidebar,
        toggleContentView,
        refreshPlaylist,
        openDiagnostics,
        openActivityBarManager,
        activityBarManagerOpen
    ]);

    const {
        dispatch: dispatchActivityBarAction,
        getActionState,
        getCatalog
    } = useActivityBarActions(activityBarContext, reportActivityActionError);

    const activityBarActionCatalog = getCatalog();

    const executeActivityBarAction = useCallback((actionId, payload) => {
        setActivityActionError('');
        return dispatchActivityBarAction(actionId, payload);
    }, [dispatchActivityBarAction]);

    function handlePointerDown(event) {
        if (sidebarCollapsed || event.button !== 0) return;

        draggingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        containerRef.current?.classList.add('resizing');
        event.preventDefault();
    }

    function handlePointerMove(event) {
        if (!draggingRef.current || !containerRef.current) return;

        const containerBounds = containerRef.current.getBoundingClientRect();
        const sidebar = containerRef.current.querySelector('.sidebar');
        if (!sidebar) return;

        const sidebarBounds = sidebar.getBoundingClientRect();
        setSidebarWidth(
            clampSidebarWidth(
                event.clientX - sidebarBounds.left,
                containerBounds.width
            )
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
            <ActivityBar
                buttons={activityBarConfig.buttons}
                actionCatalog={activityBarActionCatalog}
                onExecuteAction={executeActivityBarAction}
            />

            <ActivityBarManagerDialog
                open={activityBarManagerOpen}
                buttons={activityBarConfig.buttons}
                actionCatalog={activityBarActionCatalog}
                onClose={closeActivityBarManager}
                onAddButton={addActivityBarButton}
                onRemoveButton={removeActivityBarButton}
                onUpdateButton={updateActivityBarButton}
                onMoveButton={moveActivityBarButton}
                onRestoreDefaults={restoreActivityBarDefaults}
                onExportConfig={() => JSON.stringify(activityBarConfig, null, 2)}
                onImportConfig={(json) => {
                    replaceActivityBarConfig(json);
                    setActivityActionError('');
                }}
            />

            <Sidebar visible={!sidebarCollapsed} />

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

            {activityActionError && (
                <div className="activitybar-action-error" role="alert">
                    <span>{activityActionError}</span>
                    <button
                        type="button"
                        aria-label="Cerrar aviso de error"
                        onClick={() => setActivityActionError('')}
                    >
                        ×
                    </button>
                </div>
            )}

            <main className="main-playlist">
                <section id="PlaylistPanel" aria-label="Playlist">
                    <PlaylistToolbar
                        playlists={playlists}
                        activePlaylistGuid={activePlaylistGuid}
                        filter={filter}
                        summary={summary}
                        onFilterChange={setFilter}
                        onPlaylistChange={changePlaylist}
                        contentView={contentView}
                        onExecuteAction={executeActivityBarAction}
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

