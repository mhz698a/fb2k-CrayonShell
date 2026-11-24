import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getFooSdk } from '../services/fooSdk.js';
import {
    assertLibraryResponse,
    buildLibraryFacetIndex,
    fetchChangedFacetTracks
} from '../services/libraryFacets.js';

const SYNC_DEBOUNCE_MS = 400;

function isUnsupportedChangesEndpoint(error) {
    const code = String(error?.code || '').toUpperCase();
    const message = String(error?.message || '').toLowerCase();
    return code === 'METHOD_NOT_FOUND'
        || code === 'NOT_SUPPORTED'
        || message.includes('method not found')
        || message.includes('unknown method')
        || message.includes('not implemented');
}

function updateSelection(current, value, multi) {
    if (!multi) {
        return current.length === 1 && current[0] === value ? [] : [value];
    }
    return current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];
}

function sortYears(left, right) {
    const leftNumber = Number(left.label);
    const rightNumber = Number(right.label);
    const leftIsYear = /^\d{4}$/.test(left.label) && Number.isFinite(leftNumber);
    const rightIsYear = /^\d{4}$/.test(right.label) && Number.isFinite(rightNumber);

    if (leftIsYear && rightIsYear) return rightNumber - leftNumber;
    return new Intl.Collator('es', { numeric: true, sensitivity: 'base' })
        .compare(right.label, left.label);
}

function buildFacetData(records, selectedYears, selectedSubfolders) {
    const yearFilter = new Set(selectedYears);
    const subfolderFilter = new Set(selectedSubfolders);
    const yearCounts = new Map();
    const subfolderCounts = new Map();
    let filteredCount = 0;

    records.forEach((record) => {
        const matchesYear = yearFilter.size === 0 || yearFilter.has(record.yearValue);
        const matchesSubfolder = subfolderFilter.size === 0
            || subfolderFilter.has(record.subfolderValue);

        if (matchesSubfolder) {
            yearCounts.set(record.yearValue, (yearCounts.get(record.yearValue) || 0) + 1);
        }
        if (matchesYear) {
            subfolderCounts.set(
                record.subfolderValue,
                (subfolderCounts.get(record.subfolderValue) || 0) + 1
            );
        }
        if (matchesYear && matchesSubfolder) filteredCount += 1;
    });

    selectedYears.forEach((value) => {
        if (!yearCounts.has(value)) yearCounts.set(value, 0);
    });
    selectedSubfolders.forEach((value) => {
        if (!subfolderCounts.has(value)) subfolderCounts.set(value, 0);
    });

    const yearLabels = new Map();
    const subfolderLabels = new Map();
    records.forEach((record) => {
        yearLabels.set(record.yearValue, record.yearLabel);
        subfolderLabels.set(record.subfolderValue, record.subfolderLabel);
    });
    selectedYears.forEach((value) => {
        if (!yearLabels.has(value)) yearLabels.set(value, value === '__CRAYONSHELL_EMPTY_YEAR__' ? '(Sin año)' : value);
    });
    selectedSubfolders.forEach((value) => {
        if (!subfolderLabels.has(value)) {
            subfolderLabels.set(value, value === '__CRAYONSHELL_EMPTY_SUBFOLDER__'
                ? '(Sin subcarpeta)'
                : value);
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
    })).sort((left, right) => new Intl.Collator('es', {
        numeric: true,
        sensitivity: 'base'
    }).compare(left.label, right.label));

    return { years, subfolders, filteredCount };
}

const INITIAL_STATE = {
    status: 'idle',
    message: 'Abre el panel para conectar con la Media Library.',
    progress: null
};

export function useLibraryFacets(enabled) {
    const [records, setRecords] = useState([]);
    const [state, setState] = useState(INITIAL_STATE);
    const [selectedYears, setSelectedYears] = useState([]);
    const [selectedSubfolders, setSelectedSubfolders] = useState([]);

    const recordsRef = useRef(new Map());
    const revisionRef = useRef(null);
    const refreshRef = useRef(() => {});
    const selectionRef = useRef({ years: [], subfolders: [] });

    selectionRef.current = { years: selectedYears, subfolders: selectedSubfolders };

    useEffect(() => {
        if (!enabled) return undefined;

        let active = true;
        let syncTimer = null;
        let syncRunning = false;
        let syncPending = false;
        let scanController = null;
        let sdk = null;
        let incrementalSyncAvailable = true;
        const unsubscribers = [];

        function setStatus(status, message, progress = null) {
            if (!active) return;
            setState({ status, message, progress });
        }

        function publishIndex(nextIndex) {
            recordsRef.current = nextIndex;
            if (!active) return;

            setRecords(Array.from(nextIndex.values()));
            setSelectedYears((current) => current.filter((value) =>
                nextIndex.size === 0
                    ? false
                    : Array.from(nextIndex.values()).some((record) => record.yearValue === value)
            ));
            setSelectedSubfolders((current) => current.filter((value) =>
                nextIndex.size === 0
                    ? false
                    : Array.from(nextIndex.values()).some((record) => record.subfolderValue === value)
            ));
        }

        async function requestChanges(mark) {
            if (!incrementalSyncAvailable || typeof sdk.library?.getChanges !== 'function') {
                return null;
            }

            try {
                const response = mark
                    ? await sdk.library.getChanges({ epoch: mark.epoch, since: mark.revision })
                    : await sdk.library.getChanges();

                return assertLibraryResponse(response, 'library.getChanges');
            } catch (error) {
                if (isUnsupportedChangesEndpoint(error)) {
                    incrementalSyncAvailable = false;
                    revisionRef.current = null;
                    return null;
                }
                throw error;
            }
        }

        async function applyChangesToIndex(index, changes) {
            const nextIndex = new Map(index);
            (Array.isArray(changes.removed) ? changes.removed : []).forEach((handle) => {
                nextIndex.delete(String(handle));
            });

            const changed = Array.isArray(changes.changed) ? changes.changed : [];
            if (changed.length > 0) {
                const result = await fetchChangedFacetTracks(sdk, changed);
                result.missing.forEach((handle) => nextIndex.delete(handle));
                result.records.forEach((record, handle) => nextIndex.set(handle, record));
            }

            return nextIndex;
        }

        async function rebuildFromBaseline(baseline) {
            let currentBaseline = baseline;
            for (let attempt = 0; attempt < 3; attempt += 1) {
                if (!active) return;

                scanController?.abort();
                scanController = new AbortController();
                const controller = scanController;
                setStatus('loading', 'Indexando la Media Library…', {
                    fetched: 0,
                    total: 0
                });

                let fetchedProgress = 0;
                const nextIndex = await buildLibraryFacetIndex(sdk, {
                    signal: controller.signal,
                    onProgress(info) {
                        fetchedProgress = info.fetched;
                        setStatus('loading', 'Indexando la Media Library…', {
                            fetched: info.fetched,
                            total: info.total
                        });
                    }
                });

                if (!active || controller.signal.aborted) return;

                let finalIndex = nextIndex;
                let nextMark = currentBaseline;

                if (currentBaseline && incrementalSyncAvailable) {
                    const catchup = await requestChanges({
                        epoch: currentBaseline.epoch,
                        revision: currentBaseline.revision
                    });

                    if (catchup?.resync) {
                        currentBaseline = catchup;
                        continue;
                    }
                    if (catchup) {
                        finalIndex = await applyChangesToIndex(nextIndex, catchup);
                        nextMark = catchup;
                    }
                }

                if (!active) return;
                publishIndex(finalIndex);
                revisionRef.current = nextMark && !nextMark.resync
                    ? { epoch: nextMark.epoch, revision: nextMark.revision }
                    : null;

                setStatus('ready',
                    finalIndex.size === 0
                        ? 'Media Library vacía.'
                        : 'Media Library sincronizada · ' + finalIndex.size.toLocaleString('es-MX') + ' pistas.',
                    { fetched: finalIndex.size, total: finalIndex.size }
                );
                return;
            }

            throw new Error('La biblioteca cambió repetidamente durante la indexación. Vuelve a actualizar.');
        }

        async function runSyncCycle() {
            const libraryStatus = assertLibraryResponse(
                await sdk.library.getStatus(),
                'library.getStatus'
            );

            if (!libraryStatus.enabled) {
                revisionRef.current = null;
                publishIndex(new Map());
                setStatus('disabled', 'La Media Library de foobar2000 está deshabilitada.');
                return;
            }

            if (!libraryStatus.initialized) {
                setStatus('waiting', 'Esperando a que foobar2000 termine de cargar la biblioteca…');
                return;
            }

            if (!revisionRef.current) {
                const baseline = await requestChanges(null);
                await rebuildFromBaseline(baseline);
                return;
            }

            const changes = await requestChanges(revisionRef.current);
            if (!changes) {
                await rebuildFromBaseline(null);
                return;
            }
            if (changes.resync) {
                await rebuildFromBaseline(changes);
                return;
            }

            const nextIndex = await applyChangesToIndex(recordsRef.current, changes);
            if (!active) return;

            publishIndex(nextIndex);
            revisionRef.current = {
                epoch: changes.epoch,
                revision: changes.revision
            };
            setStatus('ready',
                nextIndex.size === 0
                    ? 'Media Library vacía.'
                    : 'Media Library sincronizada · ' + nextIndex.size.toLocaleString('es-MX') + ' pistas.',
                { fetched: nextIndex.size, total: nextIndex.size }
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
        } catch (error) {
            setStatus('unavailable', error.message || String(error));
            return () => {
                active = false;
            };
        }

        const libraryEvents = [
            'library:initialized',
            'library:itemsAdded',
            'library:itemsRemoved',
            'library:itemsModified'
        ];

        libraryEvents.forEach((eventName) => {
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
            revisionRef.current = null;
            void initialize();
        };

        void initialize();

        return () => {
            active = false;
            window.clearTimeout(syncTimer);
            scanController?.abort();
            unsubscribers.forEach((unsubscribe) => unsubscribe());
            refreshRef.current = () => {};
        };
    }, [enabled]);

    const facetData = useMemo(
        () => buildFacetData(records, selectedYears, selectedSubfolders),
        [records, selectedYears, selectedSubfolders]
    );

    const selectYear = useCallback((value, multi = false) => {
        setSelectedYears((current) => updateSelection(current, value, multi));
    }, []);

    const selectSubfolder = useCallback((value, multi = false) => {
        setSelectedSubfolders((current) => updateSelection(current, value, multi));
    }, []);

    const clearYears = useCallback(() => setSelectedYears([]), []);
    const clearSubfolders = useCallback(() => setSelectedSubfolders([]), []);
    const refresh = useCallback(() => refreshRef.current(), []);

    const matchingTracks = useMemo(() => {
        const years = new Set(selectedYears);
        const subfolders = new Set(selectedSubfolders);
        return records.filter((record) => (
            (years.size === 0 || years.has(record.yearValue))
            && (subfolders.size === 0 || subfolders.has(record.subfolderValue))
        ));
    }, [records, selectedYears, selectedSubfolders]);

    return {
        status: state.status,
        message: state.message,
        progress: state.progress,
        totalTracks: records.length,
        years: facetData.years,
        subfolders: facetData.subfolders,
        selectedYears,
        selectedSubfolders,
        filteredCount: facetData.filteredCount,
        matchingTracks,
        selectYear,
        selectSubfolder,
        clearYears,
        clearSubfolders,
        refresh
    };
}
