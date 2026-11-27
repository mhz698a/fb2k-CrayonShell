import { useCallback, useEffect, useRef, useState } from 'react';
import {
    DEFAULT_WAVEFORM_CACHE_MAX_BYTES,
    MAX_WAVEFORM_CACHE_MAX_BYTES,
    MIN_WAVEFORM_CACHE_MAX_BYTES,
    MEBIBYTE,
    normalizeWaveformCacheSettings,
    readWaveformCacheSettings,
    writeWaveformCacheSettings
} from '../../features/waveform/waveformCacheSettings.js';

function FaIcon({ name }) {
    return <i className={'fa fa-' + name} aria-hidden="true" />;
}

function formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes >= 1024 ** 3) return (bytes / (1024 ** 3)).toFixed(2) + ' GiB';
    if (bytes >= 1024 ** 2) return (bytes / (1024 ** 2)).toFixed(1) + ' MiB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KiB';
    return bytes + ' B';
}

function formatMaintenanceDate(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Aún no ejecutado';
    return new Date(timestamp).toLocaleString();
}

export default function WaveformCacheSettingsDialog({ open, cacheActions, progress, onClose }) {
    const dialogRef = useRef(null);
    const [budgetMiB, setBudgetMiB] = useState(String(
        Math.round(readWaveformCacheSettings().maxBytes / MEBIBYTE)
    ));
    const [snapshot, setSnapshot] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [confirmingClear, setConfirmingClear] = useState(false);

    const refreshSnapshot = useCallback(async (force = false) => {
        if (!cacheActions) {
            setSnapshot(null);
            return null;
        }
        const result = await cacheActions.maintain(force ? { force: true } : {});
        const nextSnapshot = result || cacheActions.getSnapshot?.() || null;
        setSnapshot(nextSnapshot);
        return nextSnapshot;
    }, [cacheActions]);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;

        if (open) {
            setBudgetMiB(String(
                Math.round(readWaveformCacheSettings().maxBytes / MEBIBYTE)
            ));
            setError('');
            setMessage('');
            setConfirmingClear(false);
            if (!dialog.open) dialog.showModal();
            if (cacheActions) {
                refreshSnapshot().catch((failure) => {
                    setError(failure?.message || 'No se pudo consultar el inventario de caché.');
                });
            } else {
                setSnapshot(null);
            }
        } else if (dialog.open) {
            dialog.close();
        }
    }, [open, cacheActions, refreshSnapshot]);

    async function runOperation(operation, successMessage) {
        if (busy) return;
        setBusy(true);
        setError('');
        setMessage('');
        try {
            const result = await operation();
            if (result) setSnapshot(result);
            if (successMessage) setMessage(
                typeof successMessage === 'function' ? successMessage(result) : successMessage
            );
            return result;
        } catch (failure) {
            setError(failure?.message || 'No se pudo completar la operación de caché.');
            return null;
        } finally {
            setBusy(false);
        }
    }

    function applyBudget(nextMiB = budgetMiB) {
        const parsedMiB = Number(nextMiB);
        if (!Number.isInteger(parsedMiB)
            || parsedMiB < MIN_WAVEFORM_CACHE_MAX_BYTES / MEBIBYTE
            || parsedMiB > MAX_WAVEFORM_CACHE_MAX_BYTES / MEBIBYTE) {
            setError(
                'El límite debe ser un entero entre '
                + (MIN_WAVEFORM_CACHE_MAX_BYTES / MEBIBYTE)
                + ' y '
                + (MAX_WAVEFORM_CACHE_MAX_BYTES / MEBIBYTE)
                + ' MiB.'
            );
            setMessage('');
            return;
        }

        if (!cacheActions) {
            setError('El controlador waveform todavía no está disponible.');
            return;
        }

        const previous = readWaveformCacheSettings();
        const next = normalizeWaveformCacheSettings({ maxBytes: parsedMiB * MEBIBYTE });
        void runOperation(async () => {
            writeWaveformCacheSettings(next);
            try {
                const result = await cacheActions.setMaxBytes(next.maxBytes);
                if (!result) throw new Error('El administrador de caché no devolvió un estado actualizado.');
                return result;
            } catch (failure) {
                writeWaveformCacheSettings(previous);
                throw failure;
            }
        }, (result) => {
            const evicted = Number(result?.evictedTracks) || 0;
            return 'Presupuesto actualizado a ' + formatBytes(next.maxBytes)
                + (evicted > 0 ? '. Cachés retiradas por presupuesto: ' + evicted + '.' : '.');
        });
    }

    function restoreDefaults() {
        const defaultMiB = String(DEFAULT_WAVEFORM_CACHE_MAX_BYTES / MEBIBYTE);
        setBudgetMiB(defaultMiB);
        applyBudget(defaultMiB);
    }

    function refreshCache() {
        void runOperation(
            () => refreshSnapshot(true),
            'Inventario reconciliado y presupuesto aplicado.'
        );
    }

    function confirmClearInactive() {
        setConfirmingClear(false);
        void runOperation(
            () => cacheActions.clearInactive(),
            (result) => {
                const removedTracks = Number(result?.removedTracks) || 0;
                const deletedFiles = Number(result?.deletedFiles) || 0;
                const failedFiles = Number(result?.failedFiles) || 0;
                return 'Limpieza terminada: ' + removedTracks + ' pista(s), '
                    + deletedFiles + ' archivo(s) eliminados y '
                    + failedFiles + ' operación(es) omitida(s) o fallida(s).';
            }
        );
    }

    const canManage = Boolean(cacheActions && !busy);
    const budgetIsValid = Number.isInteger(Number(budgetMiB))
        && Number(budgetMiB) >= MIN_WAVEFORM_CACHE_MAX_BYTES / MEBIBYTE
        && Number(budgetMiB) <= MAX_WAVEFORM_CACHE_MAX_BYTES / MEBIBYTE;
    const usedBytes = Number(snapshot?.usedBytes) || 0;
    const maxBytes = Number(snapshot?.maxBytes) || DEFAULT_WAVEFORM_CACHE_MAX_BYTES;
    const usagePercent = maxBytes > 0
        ? Math.min(100, Math.round((usedBytes / maxBytes) * 100))
        : 0;

    return (
        <dialog
            ref={dialogRef}
            className="waveform-cache-dialog"
            aria-labelledby="WaveformCacheSettingsTitle"
            onCancel={(event) => {
                event.preventDefault();
                onClose?.();
            }}
            onClose={onClose}
        >
            <div className="waveform-cache-settings">
                <header className="waveform-cache-heading">
                    <div>
                        <strong id="WaveformCacheSettingsTitle">Administración de caché waveform</strong>
                        <span>Controla el almacenamiento persistente de las formas de onda generadas.</span>
                    </div>
                    <button
                        className="waveform-cache-close"
                        type="button"
                        aria-label="Cerrar administración de caché"
                        onClick={onClose}
                    >
                        ×
                    </button>
                </header>

                <div className="waveform-cache-content">
                    <section className="waveform-cache-section">
                        <div className="waveform-cache-section-heading">
                            <strong>Presupuesto de almacenamiento</strong>
                            <span>Predeterminado: 1 GiB · Rango: 64 MiB a 64 GiB</span>
                        </div>
                        <div className="waveform-cache-budget-row">
                            <label htmlFor="WaveformCacheBudget">Límite máximo</label>
                            <div>
                                <input
                                    id="WaveformCacheBudget"
                                    type="number"
                                    min={MIN_WAVEFORM_CACHE_MAX_BYTES / MEBIBYTE}
                                    max={MAX_WAVEFORM_CACHE_MAX_BYTES / MEBIBYTE}
                                    step="64"
                                    value={budgetMiB}
                                    disabled={busy}
                                    onChange={(event) => setBudgetMiB(event.target.value)}
                                />
                                <span>MiB</span>
                                <button
                                    className="waveform-cache-primary"
                                    type="button"
                                    disabled={!canManage || !budgetIsValid}
                                    onClick={() => applyBudget()}
                                >
                                    Aplicar límite
                                </button>
                                <button
                                    type="button"
                                    disabled={!canManage}
                                    onClick={restoreDefaults}
                                >
                                    Restaurar 1 GiB
                                </button>
                            </div>
                        </div>
                        <p className="waveform-cache-note">
                            Al reducir el límite se eliminan primero las cachés menos utilizadas. La pista activa permanece protegida y puede hacer que el almacenamiento quede temporalmente por encima del presupuesto.
                        </p>
                    </section>

                    <section className="waveform-cache-section">
                        <div className="waveform-cache-section-heading">
                            <strong>Estado del almacenamiento</strong>
                            <button type="button" disabled={!canManage} onClick={refreshCache}>
                                <FaIcon name="refresh"/> Reconciliar
                            </button>
                        </div>
                        <div className="waveform-cache-stats">
                            <div><strong>{formatBytes(usedBytes)}</strong><span>Utilizado</span></div>
                            <div><strong>{formatBytes(Number(snapshot?.availableBytes) || 0)}</strong><span>Disponible dentro del límite</span></div>
                            <div><strong>{Number(snapshot?.cachedTracks) || 0}</strong><span>Pistas almacenadas</span></div>
                            <div><strong>{Number(snapshot?.cachedSegments) || 0}</strong><span>Segmentos almacenados</span></div>
                        </div>
                        <div
                            className={'waveform-cache-meter' + (snapshot?.overBudget ? ' is-over-budget' : '')}
                            role="progressbar"
                            aria-label="Uso del presupuesto de caché"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={usagePercent}
                        >
                            <span style={{ width: usagePercent + '%' }} />
                        </div>
                        <div className="waveform-cache-meta">
                            <span>Límite efectivo: {formatBytes(maxBytes)}</span>
                            <span>Último mantenimiento: {formatMaintenanceDate(snapshot?.lastMaintenanceAt)}</span>
                        </div>
                        {snapshot?.overBudget && (
                            <p className="waveform-cache-warning" role="status">
                                El presupuesto está excedido. La caché de la pista activa se conserva por seguridad.
                            </p>
                        )}
                        {snapshot?.root && (
                            <p className="waveform-cache-path" title={snapshot.root}>
                                Ubicación: {snapshot.root}
                            </p>
                        )}
                        {!snapshot && (
                            <p className="waveform-cache-note">
                                {cacheActions
                                    ? 'Inventario aún no disponible.'
                                    : 'Esperando a que el controlador waveform esté disponible.'}
                            </p>
                        )}
                    </section>

                    <section className="waveform-cache-section waveform-cache-cleanup">
                        <div className="waveform-cache-section-heading">
                            <strong>Limpieza manual</strong>
                            <span>Elimina cachés inactivas; conserva la pista activa.</span>
                        </div>
                        {!confirmingClear ? (
                            <button
                                className="waveform-cache-danger"
                                type="button"
                                disabled={!canManage || !snapshot?.cachedTracks}
                                onClick={() => setConfirmingClear(true)}
                            >
                                <FaIcon name="trash"/> Limpiar cachés inactivas
                            </button>
                        ) : (
                            <div className="waveform-cache-confirm" role="alert">
                                <span>La eliminación es permanente, pero solo afecta archivos regenerables de waveform. No modifica los archivos multimedia originales.</span>
                                <div>
                                    <button type="button" disabled={busy} onClick={() => setConfirmingClear(false)}>
                                        Cancelar
                                    </button>
                                    <button
                                        className="waveform-cache-danger"
                                        type="button"
                                        disabled={!canManage}
                                        onClick={confirmClearInactive}
                                    >
                                        Confirmar limpieza
                                    </button>
                                </div>
                            </div>
                        )}
                    </section>

                    {busy && (
                        <div className="waveform-cache-progress" role="status">
                            <span>
                                <FaIcon name="refresh"/>
                                {progress?.phase === 'deleting' && Number(progress.total) > 0
                                    ? 'Eliminando archivos: ' + Math.min(Number(progress.done) || 0, Number(progress.total))
                                        + ' de ' + Number(progress.total) + '.'
                                    : 'Operación en curso. La interfaz de reproducción permanece disponible.'}
                            </span>
                            {progress?.phase === 'deleting' && Number(progress.total) > 0 && (
                                <div
                                    className="waveform-cache-meter"
                                    role="progressbar"
                                    aria-label="Progreso de eliminación de caché"
                                    aria-valuemin={0}
                                    aria-valuemax={Number(progress.total)}
                                    aria-valuenow={Math.min(Number(progress.done) || 0, Number(progress.total))}
                                >
                                    <span style={{
                                        width: (Math.min(Number(progress.done) || 0, Number(progress.total))
                                            / Number(progress.total) * 100) + '%'
                                    }} />
                                </div>
                            )}
                        </div>
                    )}
                    {error && <p className="waveform-cache-feedback is-error" role="alert">{error}</p>}
                    {message && <p className="waveform-cache-feedback" role="status">{message}</p>}
                </div>

                <footer className="waveform-cache-footer">
                    <span>Los manifiestos son la fuente de verdad; el inventario global puede reconstruirse.</span>
                    <button type="button" onClick={onClose} disabled={busy}>Cerrar</button>
                </footer>
            </div>
        </dialog>
    );
}
