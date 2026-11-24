import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getFooSdk } from '../services/fooSdk.js';
import {
    buildLibraryFacetTree,
    syncLibraryViewerSelection
} from '../services/libraryFacets.js';

const SYNC_DEBOUNCE_MS = 350;

function updateSelection(current, value, multi) {
    if (!multi) {
        return current.length === 1 && current[0] === value ? [] : [value];
    }
    return current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];
}

function collatorCompare(left, right) {
    return new Intl.Collator('es', {
        numeric: true,
        sensitivity: 'base'
    }).compare(left, right);
}

function sortYears(left, right) {
    const leftNumber = Number(left.label);
    const rightNumber = Number(right.label);
    const leftIsYear = /^\d{4}$/.test(left.label) && Number.isFinite(leftNumber);
    const rightIsYear = /^\d{4}$/.test(right.label) && Number.isFinite(rightNumber);

    if (leftIsYear && rightIsYear) return leftNumber - rightNumber;
    if (leftIsYear) return -1;
    if (rightIsYear) return 1;
    return collatorCompare(left.label, right.label);
}

function buildFacetData(directories, selectedYears) {
    const yearCounts = new Map();
    const yearLabels = new Map();
    const subfolderCounts = new Map();
    const subfolderLabels = new Map();
    const yearFilter = new Set(selectedYears);
    let filteredCount = 0;

    directories.forEach((directory) => {
        const count = Math.max(0, Number(directory.trackCount) || 0);
        if (count === 0) return;

        yearCounts.set(
            directory.yearValue,
            (yearCounts.get(directory.yearValue) || 0) + count
        );
        yearLabels.set(directory.yearValue, directory.yearLabel);

        const matchesYear = yearFilter.size === 0 || yearFilter.has(directory.yearValue);
        if (matchesYear) {
            subfolderCounts.set(
                directory.subfolderValue,
                (subfolderCounts.get(directory.subfolderValue) || 0) + count
            );
            subfolderLabels.set(directory.subfolderValue, directory.subfolderLabel);
            filteredCount += count;
        }
    });

    const years = Array.from(yearCounts, ([value, count]) => ({
        value,
        label: yearLabels.get(value) || value,
        count
    })).sort(sortYears);

    const subfolders = Array.from(subfolderCounts, ([value, count]) => ({
        value,
        label: subfolderLabels.get(value) || value,
        count
    })).sort((left, right) => collatorCompare(left.label, right.label));

    return { years, subfolders, filteredCount };
}

const INITIAL_STATE = {
    status: 'idle',
    message: 'Abre el panel para consultar la Media Library.',
    progress: null
};

export function useLibraryFacets(enabled) {
    const [directories, setDirectories] = useState([]);
    const [state, setState] = useState(INITIAL_STATE);
    const [selectedYears, setSelectedYears] = useState([]);
    const [selectedSubfolders, setSelectedSubfolders] = useState([]);
    const [playlistSyncStatus, setPlaylistSyncStatus] = useState('idle');
    const [playlistSyncMessage, setPlaylistSyncMessage] = useState('');

    const directoriesRef = useRef([]);
    const sdkRef = useRef(null);
    const refreshRef = useRef(() => {});
    const playlistSyncRef = useRef({
        generation: 0,
        queue: Promise.resolve(),
        hadSelection: false
    });

    useEffect(() => {
        if (!enabled) return undefined;

        let active = true;
        let syncTimer = null;
        let syncRunning = false;
        let syncPending = false;
        let sdk = null;
        let scanController = null;
        const unsubscribers = [];

        function setStatus(status, message, progress = null) {
            if (!active) return;
            setState({ status, message, progress });
        }

        function publishDirectories(nextDirectories) {
            directoriesRef.current = nextDirectories;
            if (!active) return;

            const yearValues = new Set();
            const subfolderValues = new Set();
            nextDirectories.forEach((directory) => {
                yearValues.add(directory.yearValue);
                subfolderValues.add(directory.subfolderValue);
            });

            setDirectories(nextDirectories);
            setSelectedYears((current) => current.filter((value) => yearValues.has(value)));
            setSelectedSubfolders((current) => current.filter((value) => subfolderValues.has(value)));
        }

        async function runSyncCycle() {
            const libraryStatus = await sdk.library.getStatus();
            if (!libraryStatus || libraryStatus.success === false) {
                throw new Error(libraryStatus?.error || 'No se pudo consultar el estado de la Media Library.');
            }

            if (libraryStatus.enabled === false) {
                publishDirectories([]);
                setStatus('disabled', 'La Media Library de foobar2000 está deshabilitada.');
                return;
            }

            if (!libraryStatus.initialized) {
                setStatus('waiting', 'Esperando a que foobar2000 termine de cargar la biblioteca…');
                return;
            }

            scanController?.abort();
            scanController = new AbortController();
            const controller = scanController;

            setStatus('loading', 'Consultando el árbol de carpetas de foobar2000…', {
                fetched: 0,
                total: 0
            });

            const result = await buildLibraryFacetTree(sdk, {
                signal: controller.signal,
                onProgress(info) {
                    if (!active || controller.signal.aborted) return;
                    setStatus('loading', 'Consultando el árbol de carpetas de foobar2000…', {
                        fetched: Number(info.visited) || 0,
                        total: 0
                    });
                }
            });

            if (!active || controller.signal.aborted) return;

            publishDirectories(result.directories);
            const folderCount = result.directories.length.toLocaleString('es-MX');
            const trackCount = result.totalTracks.toLocaleString('es-MX');
            const cacheLabel = result.fromCache ? ' · caché nativa' : '';
            const skippedLabel = result.skippedTracks > 0
                ? ' · ' + result.skippedTracks.toLocaleString('es-MX') + ' pistas sin ruta local'
                : '';

            setStatus(
                'ready',
                'Media Library consultada · ' + trackCount + ' pistas · ' + folderCount
                    + ' carpetas' + cacheLabel + skippedLabel,
                { fetched: result.directories.length, total: 0 }
            );
        }

        async function queueSync() {
            if (!active) return;
            if (syncRunning) {
                syncPending = true;
                return;
            }

            syncRunning = true;
            try {
                do {
                    syncPending = false;
                    await runSyncCycle();
                } while (syncPending && active);
            } catch (error) {
                if (!active || error?.name === 'AbortError') return;
                setStatus('error', error.message || String(error));
            } finally {
                syncRunning = false;
            }
        }

        function scheduleSync() {
            if (!active) return;
            window.clearTimeout(syncTimer);
            syncTimer = window.setTimeout(() => {
                syncTimer = null;
                void queueSync();
            }, SYNC_DEBOUNCE_MS);
        }

        async function initialize() {
            try {
                await queueSync();
            } catch (error) {
                if (active) setStatus('error', error.message || String(error));
            }
        }

        try {
            sdk = getFooSdk();
            sdkRef.current = sdk;
        } catch (error) {
            setStatus('unavailable', error.message || String(error));
            return () => {
                active = false;
                sdkRef.current = null;
            };
        }

        ['library:initialized', 'library:itemsAdded', 'library:itemsRemoved'].forEach((eventName) => {
            const unsubscribe = sdk.on(eventName, () => {
                if (eventName === 'library:initialized') {
                    void initialize();
                } else {
                    scheduleSync();
                }
            });
            if (typeof unsubscribe === 'function') unsubscribers.push(unsubscribe);
        });

        refreshRef.current = () => {
            void initialize();
        };

        void initialize();

        return () => {
            active = false;
            window.clearTimeout(syncTimer);
            scanController?.abort();
            unsubscribers.forEach((unsubscribe) => unsubscribe());
            if (sdkRef.current === sdk) sdkRef.current = null;
            refreshRef.current = () => {};
        };
    }, [enabled]);

    const facetData = useMemo(
        () => buildFacetData(directories, selectedYears),
        [directories, selectedYears]
    );

    const matchingDirectories = useMemo(() => {
        if (selectedSubfolders.length === 0) return [];

        const years = new Set(selectedYears);
        const subfolders = new Set(selectedSubfolders);
        return directories.filter((directory) => (
            (years.size === 0 || years.has(directory.yearValue))
            && subfolders.has(directory.subfolderValue)
            && directory.trackCount > 0
        ));
    }, [directories, selectedYears, selectedSubfolders]);

    useEffect(() => {
        const sync = playlistSyncRef.current;

        if (!enabled) {
            sync.generation += 1;
            return undefined;
        }

        const hasSubfolderSelection = selectedSubfolders.length > 0;
        if (!hasSubfolderSelection && !sync.hadSelection) return undefined;

        sync.hadSelection = hasSubfolderSelection;
        const generation = ++sync.generation;
        const sdk = sdkRef.current;
        if (!sdk) return undefined;

        const targetDirectories = hasSubfolderSelection ? matchingDirectories : [];
        setPlaylistSyncStatus('syncing');
        setPlaylistSyncMessage('Actualizando Library Viewer Selection…');

        sync.queue = sync.queue.catch(() => {}).then(async () => {
            if (generation !== sync.generation) return;

            try {
                const result = await syncLibraryViewerSelection(sdk, targetDirectories, {
                    shouldApply: () => generation === sync.generation
                });

                if (result.stale || generation !== sync.generation) return;

                setPlaylistSyncStatus('ready');
                setPlaylistSyncMessage(
                    'Library Viewer Selection · '
                    + (result.trackCount || 0).toLocaleString('es-MX')
                    + ' pistas'
                );
            } catch (error) {
                if (generation !== sync.generation) return;
                setPlaylistSyncStatus('error');
                setPlaylistSyncMessage(
                    'Library Viewer Selection: ' + (error.message || String(error))
                );
            }
        });

        return () => {
            if (sync.generation === generation) sync.generation += 1;
        };
    }, [enabled, matchingDirectories, selectedSubfolders, selectedYears]);

    const selectYear = useCallback((value, multi = false) => {
        setSelectedYears((current) => updateSelection(current, value, multi));
    }, []);

    const selectSubfolder = useCallback((value, multi = false) => {
        setSelectedSubfolders((current) => updateSelection(current, value, multi));
    }, []);

    const clearYears = useCallback(() => setSelectedYears([]), []);
    const clearSubfolders = useCallback(() => setSelectedSubfolders([]), []);
    const refresh = useCallback(() => refreshRef.current(), []);

    return {
        status: state.status,
        message: state.message,
        progress: state.progress,
        totalTracks: directories.reduce(
            (total, directory) => total + (Number(directory.trackCount) || 0),
            0
        ),
        years: facetData.years,
        subfolders: facetData.subfolders,
        selectedYears,
        selectedSubfolders,
        filteredCount: facetData.filteredCount,
        playlistSyncStatus,
        playlistSyncMessage,
        selectYear,
        selectSubfolder,
        clearYears,
        clearSubfolders,
        refresh
    };
}
