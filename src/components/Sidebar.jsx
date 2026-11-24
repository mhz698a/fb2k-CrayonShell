import { useEffect, useRef, useState } from 'react';
import SpectrumVisualizer from './audio/SpectrumVisualizer.jsx';
import ReFacetsPanel from './refacets/ReFacetsPanel.jsx';

const DEFAULT_FACET_HEIGHT = 68;
const MIN_FACET_HEIGHT = 30;
const MAX_FACET_HEIGHT = 85;
const FACET_HEIGHT_STORAGE_KEY = 'crayonshell.sidebar.refacetsHeight.v1';

function readFacetHeight() {
    try {
        const saved = window.localStorage.getItem(FACET_HEIGHT_STORAGE_KEY);
        if (saved === null) return DEFAULT_FACET_HEIGHT;
        const stored = Number(saved);
        return Number.isFinite(stored)
            ? Math.max(MIN_FACET_HEIGHT, Math.min(MAX_FACET_HEIGHT, stored))
            : DEFAULT_FACET_HEIGHT;
    } catch {
        return DEFAULT_FACET_HEIGHT;
    }
}

export default function Sidebar({ visible = true }) {
    const sidebarRef = useRef(null);
    const draggingRef = useRef(false);
    const [facetHeight, setFacetHeight] = useState(readFacetHeight);
    const [isResizing, setIsResizing] = useState(false);

    useEffect(() => {
        try {
            window.localStorage.setItem(FACET_HEIGHT_STORAGE_KEY, String(facetHeight));
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
            <div
                className={'sidebar-layout' + (isResizing ? ' is-resizing' : '')}
                style={{ '--refacets-height': facetHeight + '%' }}
            >
                <section className="sidebar-refacets" aria-label="ReFacets">
                    <ReFacetsPanel visible={visible} />
                </section>

                <div
                    className="sidebar-section-splitter"
                    role="separator"
                    aria-label="Cambiar la altura entre ReFacets y Spectrum"
                    aria-orientation="horizontal"
                    aria-valuemin={MIN_FACET_HEIGHT}
                    aria-valuemax={MAX_FACET_HEIGHT}
                    aria-valuenow={facetHeight}
                    tabIndex={visible ? 0 : -1}
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

                <SpectrumVisualizer visible={visible} />
            </div>
        </aside>
    );
}
