import { useEffect, useRef, useState } from 'react';
import SpectrumVisualizer from './audio/SpectrumVisualizer.jsx';
import ReFacetsPanel from './refacets/ReFacetsPanel.jsx';
import YearbookExplorerPanel from './yearbook/YearbookExplorerPanel.jsx';
import PlaylistManager from './PlaylistManager.jsx';
import {
    DEFAULT_REFACETS_HEIGHT as DEFAULT_FACET_HEIGHT,
    MAX_REFACETS_HEIGHT as MAX_FACET_HEIGHT,
    MIN_REFACETS_HEIGHT as MIN_FACET_HEIGHT,
    REFACETS_HEIGHT_STORAGE_KEY,
    readRefacetsHeight
} from '../features/settings/providers/coreUiSettings.js';

export default function Sidebar({
    visible = true,
    activeView = 'library',
    externalTools = {},
    onOpenSettings,
    playlists = [],
    activePlaylistGuid = '',
    onActivatePlaylist,
    onRefreshPlaylists
}) {
    const sidebarRef = useRef(null);
    const draggingRef = useRef(false);
    const [facetHeight, setFacetHeight] = useState(readRefacetsHeight);
    const [isResizing, setIsResizing] = useState(false);
    const libraryVisible = visible && activeView === 'library';
    const yearbookVisible = visible && activeView === 'yearbook';
    const playlistManagerVisible = visible && activeView === 'playlists';

    useEffect(() => {
        try {
            window.localStorage.setItem(REFACETS_HEIGHT_STORAGE_KEY, String(facetHeight));
        } catch {
            // Keep the selected proportion for this session when storage is unavailable.
        }
    }, [facetHeight]);

    function handleSplitterPointerDown(event) {
        if (event.button !== 0) return;
        draggingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        setIsResizing(true);
        event.preventDefault();
    }

    function handleSplitterPointerMove(event) {
        if (!draggingRef.current || !sidebarRef.current) return;
        const bounds = sidebarRef.current.getBoundingClientRect();
        if (bounds.height <= 0) return;

        const nextHeight = ((event.clientY - bounds.top) / bounds.height) * 100;
        setFacetHeight(Math.round(Math.max(
            MIN_FACET_HEIGHT,
            Math.min(MAX_FACET_HEIGHT, nextHeight)
        )));
    }

    function stopSplitterDrag(event) {
        if (!draggingRef.current) return;
        if (event?.pointerId !== undefined
            && event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        draggingRef.current = false;
        setIsResizing(false);
    }

    function handleSplitterKeyDown(event) {
        const step = event.shiftKey ? 10 : 3;
        let nextHeight = facetHeight;

        if (event.key === 'ArrowUp') nextHeight -= step;
        else if (event.key === 'ArrowDown') nextHeight += step;
        else if (event.key === 'Home') nextHeight = MIN_FACET_HEIGHT;
        else if (event.key === 'End') nextHeight = MAX_FACET_HEIGHT;
        else return;

        event.preventDefault();
        setFacetHeight(Math.max(
            MIN_FACET_HEIGHT,
            Math.min(MAX_FACET_HEIGHT, nextHeight)
        ));
    }

    return (
        <aside
            ref={sidebarRef}
            className="sidebar"
            id="LeftSidebar"
            aria-label="Panel lateral"
            aria-hidden={!visible}
        >
            <div className="sidebar-views">
                <section
                    className="sidebar-view"
                    aria-label="ReFacets y Spectrum"
                    aria-hidden={activeView !== 'library'}
                    hidden={activeView !== 'library'}
                >
                    <div
                        className={'sidebar-layout' + (isResizing ? ' is-resizing' : '')}
                        style={{ '--refacets-height': facetHeight + '%' }}
                    >
                        <section className="sidebar-refacets" aria-label="ReFacets">
                            <ReFacetsPanel visible={libraryVisible} />
                        </section>

                        <div
                            className="sidebar-section-splitter"
                            role="separator"
                            aria-label="Cambiar la altura entre ReFacets y Spectrum"
                            aria-orientation="horizontal"
                            aria-valuemin={MIN_FACET_HEIGHT}
                            aria-valuemax={MAX_FACET_HEIGHT}
                            aria-valuenow={facetHeight}
                            tabIndex={libraryVisible ? 0 : -1}
                            title="Arrastrar para cambiar la altura"
                            onPointerDown={handleSplitterPointerDown}
                            onPointerMove={handleSplitterPointerMove}
                            onPointerUp={stopSplitterDrag}
                            onPointerCancel={stopSplitterDrag}
                            onLostPointerCapture={() => {
                                draggingRef.current = false;
                                setIsResizing(false);
                            }}
                            onKeyDown={handleSplitterKeyDown}
                            onDoubleClick={() => setFacetHeight(DEFAULT_FACET_HEIGHT)}
                        />

                        <SpectrumVisualizer visible={libraryVisible} />
                    </div>
                </section>

                <section
                    className="sidebar-view"
                    aria-label="Yearbook Explorer"
                    aria-hidden={activeView !== 'yearbook'}
                    hidden={activeView !== 'yearbook'}
                >
                    <YearbookExplorerPanel
                        visible={yearbookVisible}
                        externalTools={externalTools}
                        onOpenSettings={onOpenSettings}
                    />
                </section>

                <section
                    className="sidebar-view"
                    aria-label="Playlist Manager"
                    aria-hidden={activeView !== 'playlists'}
                    hidden={activeView !== 'playlists'}
                >
                    <PlaylistManager
                        open={playlistManagerVisible}
                        playlists={playlists}
                        activePlaylistGuid={activePlaylistGuid}
                        onActivate={onActivatePlaylist}
                        onRefresh={onRefreshPlaylists}
                    />
                </section>
            </div>
        </aside>
    );
}
