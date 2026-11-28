import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke, isDemoMode } from '../services/foobarApi.js';
import { getFooSdk } from '../services/fooSdk.js';
import { formatTrackDuration } from '../utils/playlistStatus.js';
import {
    copyPlaylistToClipboard,
    formatByteSize,
    loadPlaylistStatistics,
    pastePlaylistFromClipboard
} from '../features/playlistManager/playlistManagerService.js';

function getErrorMessage(error, fallback) {
    return error?.message || String(error || fallback);
}

async function writeSystemClipboard(text) {
    const result = await getFooSdk().clipboard.write(text);
    if (result?.success === false) {
        throw new Error(result.error || 'No se pudo escribir en el portapapeles.');
    }
}

async function readSystemClipboard() {
    const result = await getFooSdk().clipboard.read();
    if (result?.success === false) {
        throw new Error(result.error || 'No se pudo leer el portapapeles.');
    }
    return String(result.text || '');
}

export default function PlaylistManager({
    open = false,
    playlists = [],
    activePlaylistGuid = '',
    onActivate,
    onRefresh
}) {
    const [selectedGuid, setSelectedGuid] = useState(activePlaylistGuid);
    const [statistics, setStatistics] = useState({});
    const [statisticsLoading, setStatisticsLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const [dialog, setDialog] = useState(null);
    const dialogRef = useRef(null);
    const busyRef = useRef(false);

    const selectedPlaylist = playlists.find((playlist) => playlist.guid === selectedGuid) || null;
    const playlistSignature = useMemo(
        () => playlists.map((playlist) => String(playlist.guid) + ':' + String(playlist.trackCount)).join('|'),
        [playlists]
    );

    useEffect(() => {
        if (selectedGuid && playlists.some((playlist) => playlist.guid === selectedGuid)) return;
        setSelectedGuid(activePlaylistGuid || playlists[0]?.guid || '');
    }, [playlistSignature, activePlaylistGuid]);

    useEffect(() => {
        if (!open) return undefined;

        let current = true;
        const queue = [...playlists];
        const nextStatistics = {};
        setStatistics({});
        setStatisticsLoading(queue.length > 0);

        const worker = async () => {
            while (current && queue.length > 0) {
                const playlist = queue.shift();
                try {
                    const result = await loadPlaylistStatistics(playlist, { invoke });
                    if (current) {
                        nextStatistics[playlist.guid] = result;
                        setStatistics((previous) => ({
                            ...previous,
                            [playlist.guid]: result
                        }));
                    }
                } catch (error) {
                    if (current) {
                        nextStatistics[playlist.guid] = { error: getErrorMessage(error) };
                        setStatistics((previous) => ({
                            ...previous,
                            [playlist.guid]: { error: getErrorMessage(error) }
                        }));
                    }
                }
            }
        };

        Promise.all([worker(), worker()]).finally(() => {
            if (current) setStatisticsLoading(false);
        });

        return () => {
            current = false;
        };
    }, [open, playlistSignature]);

    useEffect(() => {
        const node = dialogRef.current;
        if (!node) return;

        if (dialog && !node.open) node.showModal();
        else if (!dialog && node.open) node.close();
    }, [dialog]);

    async function runExclusive(operation) {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        setFeedback(null);

        try {
            await operation();
        } catch (error) {
            setFeedback({
                type: 'error',
                text: getErrorMessage(error, 'No se pudo completar la operación.')
            });
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }

    async function refreshAfterMutation() {
        if (typeof onRefresh === 'function') await onRefresh();
    }

    async function activateSelected() {
        if (!selectedPlaylist || selectedPlaylist.guid === activePlaylistGuid) return;
        await runExclusive(async () => {
            await onActivate?.(selectedPlaylist.guid);
        });
    }

    function openNameDialog(type) {
        if (type === 'rename' && (!selectedPlaylist || selectedPlaylist.isLocked)) return;
        setDialog({
            type,
            playlist: type === 'rename' ? selectedPlaylist : null,
            name: type === 'rename' ? selectedPlaylist.name : 'New Playlist'
        });
    }

    async function submitNameDialog(event) {
        event.preventDefault();
        const name = String(dialog?.name || '').trim();
        if (!dialog || !name) return;

        const currentDialog = dialog;
        await runExclusive(async () => {
            if (currentDialog.type === 'create') {
                const created = await invoke('playlist.create', { name });
                if (!created.guid) throw new Error('foobar2000 no devolvió el GUID de la playlist creada.');
                setSelectedGuid(created.guid);
                setFeedback({ type: 'success', text: 'Playlist creada: ' + name });
            } else {
                await invoke('playlist.rename', {
                    playlistGuid: currentDialog.playlist.guid,
                    name
                });
                setFeedback({ type: 'success', text: 'Playlist renombrada: ' + name });
            }
            setDialog(null);
            await refreshAfterMutation();
        });
    }

    async function confirmRemove() {
        if (!dialog?.playlist) return;
        const playlist = dialog.playlist;
        await runExclusive(async () => {
            await invoke('playlist.remove', { playlistGuid: playlist.guid });
            setDialog(null);
            setSelectedGuid(activePlaylistGuid === playlist.guid ? '' : selectedGuid);
            await refreshAfterMutation();
            setFeedback({ type: 'success', text: 'Playlist eliminada: ' + playlist.name });
        });
    }

    async function copySelected(operation) {
        if (!selectedPlaylist || (operation === 'cut' && selectedPlaylist.isLocked)) return;
        await runExclusive(async () => {
            const result = await copyPlaylistToClipboard(selectedPlaylist, {
                invoke,
                operation,
                writeText: isDemoMode ? undefined : writeSystemClipboard
            });
            if (operation === 'cut') {
                setSelectedGuid('');
                await refreshAfterMutation();
            }
            setFeedback({
                type: 'success',
                text: (operation === 'cut' ? 'Playlist cortada: ' : 'Playlist copiada: ')
                    + result.name + ' · ' + result.trackCount + ' pistas'
            });
        });
    }

    async function pasteClipboard() {
        await runExclusive(async () => {
            const result = await pastePlaylistFromClipboard({
                invoke,
                readText: isDemoMode ? undefined : readSystemClipboard,
                writeText: isDemoMode ? undefined : writeSystemClipboard
            });
            setSelectedGuid(result.guid);
            await refreshAfterMutation();
            setFeedback({
                type: 'success',
                text: 'Playlist pegada: ' + result.name + ' · ' + result.trackCount + ' pistas'
            });
        });
    }

    async function undoSelected() {
        if (!selectedPlaylist || selectedPlaylist.isLocked) return;
        await runExclusive(async () => {
            try {
                await invoke('playlist.undo', { playlistGuid: selectedPlaylist.guid });
                await refreshAfterMutation();
                setFeedback({ type: 'success', text: 'Se aplicó Undo a ' + selectedPlaylist.name });
            } catch (error) {
                if (error?.code === 'NOT_FOUND') {
                    setFeedback({
                        type: 'error',
                        text: 'No hay historial nativo de deshacer para esta playlist.'
                    });
                    return;
                }
                throw error;
            }
        });
    }

    function handleListKeyDown(event) {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Enter') return;
        event.preventDefault();
        if (event.key === 'Enter') {
            void activateSelected();
            return;
        }

        if (playlists.length === 0) return;
        const currentIndex = playlists.findIndex((playlist) => playlist.guid === selectedGuid);
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = currentIndex < 0
            ? 0
            : Math.max(0, Math.min(playlists.length - 1, currentIndex + direction));
        setSelectedGuid(playlists[nextIndex]?.guid || '');
    }

    return (
        <section className={'playlist-manager' + (open ? '' : ' is-hidden')}
            aria-label="Gestor de playlists">
            <header className="playlist-manager-heading">
                <div>
                    <strong>Playlists</strong>
                    <span>{playlists.length} playlists</span>
                </div>
            </header>

            <div className="playlist-manager-list" role="listbox"
                aria-label="Lista de playlists" tabIndex={0} onKeyDown={handleListKeyDown}>
                {playlists.map((playlist) => {
                    const stats = statistics[playlist.guid];
                    const unknownDurationCount = Number(stats?.unknownDurationCount) || 0;
                    const unknownSizeCount = Number(stats?.unknownSizeCount) || 0;
                    const duration = stats && !stats.error
                        ? (unknownDurationCount === stats.trackCount && stats.trackCount > 0
                            ? 'N/D'
                            : (unknownDurationCount > 0 ? '≥ ' : '') + formatTrackDuration(stats.durationSeconds))
                        : stats?.error ? 'Duración no disponible' : 'Calculando duración…';
                    const size = stats && !stats.error
                        ? (stats.knownSizeCount === 0 && unknownSizeCount > 0
                            ? 'N/D'
                            : (unknownSizeCount > 0 ? '≥ ' : '') + formatByteSize(stats.fileSizeBytes))
                        : stats?.error ? 'Tamaño no disponible' : 'Calculando tamaño…';
                    const statTitle = stats?.error
                        ? stats.error
                        : [
                            unknownDurationCount > 0
                                ? unknownDurationCount + ' pistas sin duración disponible'
                                : '',
                            unknownSizeCount > 0
                                ? unknownSizeCount + ' pistas sin tamaño de archivo disponible'
                                : ''
                        ].filter(Boolean).join(' · ') || 'Duración y tamaño total';

                    return (
                        <button key={playlist.guid} type="button"
                            role="option"
                            aria-selected={selectedGuid === playlist.guid}
                            className={'playlist-manager-row'
                                + (selectedGuid === playlist.guid ? ' is-selected' : '')
                                + (playlist.guid === activePlaylistGuid ? ' is-active' : '')}
                            onClick={() => setSelectedGuid(playlist.guid)}
                            onDoubleClick={() => {
                                setSelectedGuid(playlist.guid);
                                if (playlist.guid !== activePlaylistGuid) {
                                    void runExclusive(async () => {
                                        await onActivate?.(playlist.guid);
                                    });
                                }
                            }}>
                            <span className="playlist-manager-primary">
                                <span className="playlist-manager-name">{playlist.name}</span>
                                {playlist.guid === activePlaylistGuid && (
                                    <span className="playlist-manager-active">Active</span>
                                )}
                                {playlist.isLocked && (
                                    <i className="fa fa-lock playlist-manager-lock" title="Playlist bloqueada" aria-label="Playlist bloqueada" />
                                )}
                            </span>
                            <span className="playlist-manager-secondary" title={statTitle}>
                                {Number(playlist.trackCount) || 0} items
                                <span>·</span>
                                {duration}
                                <span>·</span>
                                {size}
                            </span>
                        </button>
                    );
                })}
                {playlists.length === 0 && (
                    <div className="playlist-manager-empty">No hay playlists disponibles.</div>
                )}
                {statisticsLoading && playlists.length > 0 && (
                    <span className="playlist-manager-loading" aria-live="polite">Calculando estadísticas…</span>
                )}
            </div>

            {feedback && (
                <div className={'playlist-manager-feedback' + (feedback.type === 'error' ? ' is-error' : '')}
                    role="status" aria-live="polite">
                    {feedback.text}
                </div>
            )}

            <footer className="playlist-manager-toolbar" aria-label="Acciones de playlist">
                <button type="button" title="Activate" aria-label="Activate"
                    disabled={!selectedPlaylist || selectedPlaylist.guid === activePlaylistGuid || busy}
                    onClick={() => void activateSelected()}>
                    <i className="fa fa-play" aria-hidden="true" />
                </button>
                <button type="button" title="Rename" aria-label="Rename"
                    disabled={!selectedPlaylist || selectedPlaylist.isLocked || busy}
                    onClick={() => openNameDialog('rename')}>
                    <i className="fa fa-pencil" aria-hidden="true" />
                </button>
                <button type="button" title="Remove" aria-label="Remove"
                    disabled={!selectedPlaylist || selectedPlaylist.isLocked || busy}
                    onClick={() => setDialog({ type: 'remove', playlist: selectedPlaylist })}>
                    <i className="fa fa-trash" aria-hidden="true" />
                </button>
                <span className="playlist-manager-toolbar-separator" />
                <button type="button" title="Create New" aria-label="Create New"
                    disabled={busy} onClick={() => openNameDialog('create')}>
                    <i className="fa fa-plus" aria-hidden="true" />
                </button>
                <button type="button" title="Cut" aria-label="Cut"
                    disabled={!selectedPlaylist || selectedPlaylist.isLocked || busy}
                    onClick={() => void copySelected('cut')}>
                    <i className="fa fa-scissors" aria-hidden="true" />
                </button>
                <button type="button" title="Copy" aria-label="Copy"
                    disabled={!selectedPlaylist || busy}
                    onClick={() => void copySelected('copy')}>
                    <i className="fa fa-copy" aria-hidden="true" />
                </button>
                <button type="button" title="Paste" aria-label="Paste"
                    disabled={busy} onClick={() => void pasteClipboard()}>
                    <i className="fa fa-clipboard" aria-hidden="true" />
                </button>
                <span className="playlist-manager-toolbar-separator" />
                <button type="button" title="Undo" aria-label="Undo"
                    disabled={!selectedPlaylist || selectedPlaylist.isLocked || busy}
                    onClick={() => void undoSelected()}>
                    <i className="fa fa-undo" aria-hidden="true" />
                </button>
            </footer>

            <dialog ref={dialogRef} className="playlist-manager-dialog"
                onCancel={(event) => {
                    event.preventDefault();
                    setDialog(null);
                }}
                onClick={(event) => {
                    if (event.target === dialogRef.current) setDialog(null);
                }}>
                {dialog?.type === 'remove' ? (
                    <div className="playlist-manager-dialog-content">
                        <strong>Remove playlist</strong>
                        <p>
                            Se eliminará <b>{dialog.playlist?.name}</b> de foobar2000.
                            La eliminación de una playlist no se puede recuperar con Undo.
                            ¿Deseas continuar?
                        </p>
                        <div className="playlist-manager-dialog-actions">
                            <button type="button" disabled={busy} onClick={() => setDialog(null)}>No</button>
                            <button type="button" className="is-danger" disabled={busy}
                                onClick={() => void confirmRemove()}>Sí, eliminar</button>
                        </div>
                    </div>
                ) : (
                    <form className="playlist-manager-dialog-content" onSubmit={submitNameDialog}>
                        <strong>{dialog?.type === 'rename' ? 'Rename playlist' : 'Create playlist'}</strong>
                        <label htmlFor="PlaylistManagerName">Nombre</label>
                        <input id="PlaylistManagerName" type="text" autoFocus
                            value={dialog?.name || ''}
                            onChange={(event) => setDialog((previous) => ({
                                ...previous,
                                name: event.target.value
                            }))}
                            maxLength={180} required />
                        <div className="playlist-manager-dialog-actions">
                            <button type="button" disabled={busy} onClick={() => setDialog(null)}>Cancel</button>
                            <button type="submit" disabled={busy || !String(dialog?.name || '').trim()}>
                                {dialog?.type === 'rename' ? 'Rename' : 'Create'}
                            </button>
                        </div>
                    </form>
                )}
            </dialog>
        </section>
    );
}
