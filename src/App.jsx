import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ActivityBar from './components/activitybar/ActivityBar.jsx';
import ActivityBarManagerDialog from './components/activitybar/ActivityBarManagerDialog.jsx';
import ExternalToolsDialog from './components/activitybar/ExternalToolsDialog.jsx';
import SettingsBackupDialog from './components/settings/SettingsBackupDialog.jsx';
import { useExternalToolsConfig } from './features/activitybar/hooks/useExternalToolsConfig.js';
import { useActivityBarConfig } from './features/activitybar/hooks/useActivityBarConfig.js';
import { useActivityBarActions } from './features/activitybar/hooks/useActivityBarActions.js';
import Sidebar from './components/Sidebar.jsx';
import PlaylistToolbar from './components/PlaylistToolbar.jsx';
import PlaylistTable from './components/PlaylistTable.jsx';
import PlaylistStatus from './components/PlaylistStatus.jsx';
import MediaPlaybackProbe from './components/MediaPlaybackProbe.jsx';
import PropertiesPanel from './components/PropertiesPanel.jsx';
import WaveformSeekbar from './components/WaveformSeekbar.jsx';
import { usePlaylist } from './hooks/usePlaylist.js';
import { useTrackProperties } from './hooks/useTrackProperties.js';
import { useWindowsFileMetadata } from './hooks/useWindowsFileMetadata.js';
import { formatItemLine, formatItemSubtitle } from './utils/playlistDisplay.js';
import {
    SIDEBAR_COLLAPSED_STORAGE_KEY,
    SIDEBAR_VIEW_STORAGE_KEY,
    SIDEBAR_WIDTH_STORAGE_KEY,
    DEFAULT_SIDEBAR_WIDTH,
    PROPERTIES_COLLAPSED_STORAGE_KEY,
    PROPERTIES_WIDTH_STORAGE_KEY,
    DEFAULT_PROPERTIES_WIDTH,
    MAX_PROPERTIES_WIDTH,
    MIN_PROPERTIES_WIDTH,
    MAX_SIDEBAR_WIDTH,
    MIN_SIDEBAR_WIDTH,
    readPropertiesCollapsed,
    readPropertiesWidth,
    readSidebarCollapsed,
    readSidebarView,
    readSidebarWidth
} from './features/settings/providers/coreUiSettings.js';
import { settingsRegistry } from './features/settings/index.js';
import { registerCoreSettingsProviders } from './features/settings/providers/coreSettingsProviders.js';

registerCoreSettingsProviders(settingsRegistry);

function clampSidebarWidth(width, containerWidth) {
    const availableMaximum = Math.max(
        MIN_SIDEBAR_WIDTH,
        Math.min(MAX_SIDEBAR_WIDTH, containerWidth * 0.55)
    );

    return Math.round(
        Math.min(availableMaximum, Math.max(MIN_SIDEBAR_WIDTH, width))
    );
}

function clampPropertiesWidth(width, containerWidth) {
    const availableMaximum = Math.max(
        MIN_PROPERTIES_WIDTH,
        Math.min(MAX_PROPERTIES_WIDTH, containerWidth * 0.45)
    );

    return Math.round(
        Math.min(availableMaximum, Math.max(MIN_PROPERTIES_WIDTH, width))
    );
}

export default function App() {
    const containerRef = useRef(null);
    const draggingRef = useRef(false);
    const propertiesDraggingRef = useRef(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
    const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
    const [sidebarView, setSidebarView] = useState(readSidebarView);
    const [propertiesCollapsed, setPropertiesCollapsed] = useState(readPropertiesCollapsed);
    const [propertiesWidth, setPropertiesWidth] = useState(readPropertiesWidth);
    const [filter, setFilter] = useState('');
    const [contentView, setContentView] = useState('playlist');
    const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
    const [activityActionError, setActivityActionError] = useState('');
    const [activityBarManagerOpen, setActivityBarManagerOpen] = useState(false);
    const [externalToolsSettingsOpen, setExternalToolsSettingsOpen] = useState(false);
    const [settingsBackupOpen, setSettingsBackupOpen] = useState(false);
    const { config: externalToolsConfig, saveConfig: saveExternalToolsConfig } = useExternalToolsConfig();
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
        if (!sidebarCollapsed && sidebarView === 'library') {
            setSidebarCollapsed(true);
            return;
        }
        setSidebarView('library');
        setSidebarCollapsed(false);
    }, [sidebarCollapsed, sidebarView]);

    const selectSidebarView = useCallback((view) => {
        const nextView = view === 'yearbook' ? 'yearbook' : 'library';
        if (!sidebarCollapsed && sidebarView === nextView) {
            setSidebarCollapsed(true);
            return;
        }
        setSidebarView(nextView);
        setSidebarCollapsed(false);
    }, [sidebarCollapsed, sidebarView]);

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

    const openExternalToolsSettings = useCallback(() => {
        setExternalToolsSettingsOpen(true);
    }, []);

    const closeExternalToolsSettings = useCallback(() => {
        setExternalToolsSettingsOpen(false);
    }, []);

    const openSettingsBackup = useCallback(() => {
        setSettingsBackupOpen(true);
    }, []);

    const closeSettingsBackup = useCallback(() => {
        setSettingsBackupOpen(false);
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

    useEffect(() => {
        try {
            window.localStorage.setItem(SIDEBAR_VIEW_STORAGE_KEY, sidebarView);
        } catch {
            // Keep the active Sidebar view for this session when storage is unavailable.
        }
    }, [sidebarView]);

    useEffect(() => {
        try {
            window.localStorage.setItem(PROPERTIES_COLLAPSED_STORAGE_KEY, String(propertiesCollapsed));
        } catch {
            // Keep the panel visibility for this session when storage is unavailable.
        }
    }, [propertiesCollapsed]);

    useEffect(() => {
        try {
            window.localStorage.setItem(PROPERTIES_WIDTH_STORAGE_KEY, String(propertiesWidth));
        } catch {
            // Keep the panel width for this session when storage is unavailable.
        }
    }, [propertiesWidth]);

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
    const selectedItemIndex = focusedItem >= 0 ? focusedItem : playingItemIndex;
    const selectedItem = items.find((item) => item.index === selectedItemIndex) || null;
    const {
        properties: trackProperties,
        loading: propertiesLoading,
        error: propertiesError
    } = useTrackProperties(activePlaylistGuid, selectedItemIndex, !propertiesCollapsed);
    const {
        metadata: windowsFileMetadata,
        loading: windowsFileMetadataLoading,
        error: windowsFileMetadataError
    } = useWindowsFileMetadata(
        activePlaylist?.index,
        selectedItemIndex,
        !propertiesCollapsed && Boolean(selectedItem)
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
        sidebarView,
        selectSidebarView,
        contentView,
        activePlaylistGuid,
        isDemoMode,
        externalTools: externalToolsConfig,
        externalToolsSettingsOpen,
        openExternalToolsSettings,
        toggleSidebar,
        toggleContentView,
        refreshPlaylist,
        openDiagnostics,
        openActivityBarManager,
        activityBarManagerOpen
    }), [
        sidebarCollapsed,
        sidebarView,
        selectSidebarView,
        contentView,
        activePlaylistGuid,
        isDemoMode,
        externalToolsConfig,
        externalToolsSettingsOpen,
        openExternalToolsSettings,
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

    function handlePropertiesPointerDown(event) {
        if (propertiesCollapsed || event.button !== 0) return;

        propertiesDraggingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        containerRef.current?.classList.add('resizing-properties');
        event.preventDefault();
    }

    function handlePropertiesPointerMove(event) {
        if (!propertiesDraggingRef.current || !containerRef.current) return;

        const bounds = containerRef.current.getBoundingClientRect();
        setPropertiesWidth(
            clampPropertiesWidth(bounds.right - event.clientX, bounds.width)
        );
    }

    function stopPropertiesDragging(event) {
        if (!propertiesDraggingRef.current) return;
        if (event && event.pointerId !== undefined
            && event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }

        propertiesDraggingRef.current = false;
        containerRef.current?.classList.remove('resizing-properties');
    }

    function handlePropertiesResizerKeyDown(event) {
        const step = event.shiftKey ? 40 : 10;
        let nextWidth = propertiesWidth;

        if (event.key === 'ArrowLeft') nextWidth += step;
        else if (event.key === 'ArrowRight') nextWidth -= step;
        else if (event.key === 'Home') nextWidth = MIN_PROPERTIES_WIDTH;
        else if (event.key === 'End') nextWidth = MAX_PROPERTIES_WIDTH;
        else return;

        event.preventDefault();
        const width = containerRef.current?.clientWidth || window.innerWidth;
        setPropertiesWidth(clampPropertiesWidth(nextWidth, width));
    }

    function handlePropertiesResizerDoubleClick() {
        const width = containerRef.current?.clientWidth || window.innerWidth;
        setPropertiesWidth(clampPropertiesWidth(DEFAULT_PROPERTIES_WIDTH, width));
    }

    return (
        <div className="app-shell">
            <div
                ref={containerRef}
            className={'cui-container'
                + (sidebarCollapsed ? ' sidebar-collapsed' : '')
                + (propertiesCollapsed ? ' properties-collapsed' : '')}
            style={{
                '--sidebar-width': sidebarWidth + 'px',
                '--properties-width': propertiesWidth + 'px'
            }}
        >
            <ActivityBar
                buttons={activityBarConfig.buttons}
                actionCatalog={activityBarActionCatalog}
                onExecuteAction={executeActivityBarAction}
                onOpenSettingsBackup={openSettingsBackup}
            />

            <ExternalToolsDialog
                open={externalToolsSettingsOpen}
                config={externalToolsConfig}
                onClose={closeExternalToolsSettings}
                onSave={saveExternalToolsConfig}
            />
            <SettingsBackupDialog
                open={settingsBackupOpen}
                onClose={closeSettingsBackup}
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

            <Sidebar
                visible={!sidebarCollapsed}
                activeView={sidebarView}
                externalTools={externalToolsConfig}
                onOpenSettings={openExternalToolsSettings}
            />

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
                        propertiesVisible={!propertiesCollapsed}
                        onToggleProperties={() => setPropertiesCollapsed((value) => !value)}
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

            <div
                className="properties-resizer"
                role="separator"
                aria-label="Cambiar ancho del panel de propiedades"
                aria-orientation="vertical"
                aria-valuemin={MIN_PROPERTIES_WIDTH}
                aria-valuemax={MAX_PROPERTIES_WIDTH}
                aria-valuenow={propertiesWidth}
                tabIndex={propertiesCollapsed ? -1 : 0}
                title="Arrastrar para cambiar el ancho"
                onPointerDown={handlePropertiesPointerDown}
                onPointerMove={handlePropertiesPointerMove}
                onPointerUp={stopPropertiesDragging}
                onPointerCancel={stopPropertiesDragging}
                onLostPointerCapture={() => {
                    propertiesDraggingRef.current = false;
                    containerRef.current?.classList.remove('resizing-properties');
                }}
                onKeyDown={handlePropertiesResizerKeyDown}
                onDoubleClick={handlePropertiesResizerDoubleClick}
            />

            <PropertiesPanel
                selectedItem={selectedItem}
                properties={trackProperties}
                loading={propertiesLoading}
                error={propertiesError}
                fileMetadata={windowsFileMetadata}
                fileMetadataLoading={windowsFileMetadataLoading}
                fileMetadataError={windowsFileMetadataError}
            />
            </div>
            <WaveformSeekbar />
        </div>
    );
}

