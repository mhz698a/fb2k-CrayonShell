import { useEffect, useMemo, useRef, useState } from 'react';
import {
    applySettingsBackup,
    inspectSettingsBackup
} from '../../features/settings/settingsImportService.js';
import {
    serializeSettingsBackup
} from '../../features/settings/settingsBackupService.js';
import { settingsRegistry } from '../../features/settings/index.js';

const IMPORTABLE_STATUSES = new Set(['ready', 'migrated']);
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const STATUS_LABELS = Object.freeze({
    ready: 'Compatible',
    migrated: 'Se migrará',
    invalid: 'Inválido',
    'newer-version': 'Versión más reciente',
    'migration-required': 'Migración no disponible',
    'not-in-backup': 'No incluido',
    unknown: 'No reconocido'
});

function formatExportDate(value) {
    if (!value) return 'Fecha no disponible';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    return new Intl.DateTimeFormat('es-MX', {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(date);
}

function buildBackupFileName() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return 'crayonshell-settings-' + timestamp + '.json';
}

function FaIcon({ name }) {
    return <i className={'fa fa-' + name} aria-hidden="true" />;
}

export default function SettingsBackupDialog({ open, onClose }) {
    const dialogRef = useRef(null);
    const fileInputRef = useRef(null);
    const [backupText, setBackupText] = useState('');
    const [fileName, setFileName] = useState('');
    const [plan, setPlan] = useState(null);
    const [selectedProviderIds, setSelectedProviderIds] = useState([]);
    const [confirmMachineDependent, setConfirmMachineDependent] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;

        if (open) {
            setBackupText('');
            setFileName('');
            setPlan(null);
            setSelectedProviderIds([]);
            setConfirmMachineDependent(false);
            setBusy(false);
            setError('');
            setMessage('');
            if (!dialog.open) dialog.showModal();
        } else if (dialog.open) {
            dialog.close();
        }
    }, [open]);

    const importableRows = useMemo(
        () => (plan?.providers || []).filter((row) => IMPORTABLE_STATUSES.has(row.status)),
        [plan]
    );
    const selectedCount = selectedProviderIds.length;

    function handleExport() {
        setError('');
        setMessage('');

        try {
            const json = serializeSettingsBackup(settingsRegistry);
            const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
            const url = window.URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = buildBackupFileName();
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
            setMessage('Respaldo exportado correctamente. Se incluyeron únicamente los ajustes registrados.');
        } catch (failure) {
            setError(failure?.message || 'No se pudo exportar la configuración.');
        }
    }

    async function handleFileChange(event) {
        const file = event.currentTarget.files?.[0];
        if (!file) return;

        const input = event.currentTarget;
        setBusy(true);
        setError('');
        setMessage('');

        try {
            if (file.size > MAX_FILE_SIZE) {
                throw new RangeError('El archivo de ajustes excede el límite de 5 MB.');
            }

            const contents = await file.text();
            const inspected = inspectSettingsBackup(settingsRegistry, contents);
            const defaults = inspected.providers
                .filter((row) => IMPORTABLE_STATUSES.has(row.status) && !row.machineDependent)
                .map((row) => row.id);

            setBackupText(contents);
            setFileName(file.name);
            setPlan(inspected);
            setSelectedProviderIds(defaults);
            setConfirmMachineDependent(false);
            setMessage('Archivo validado. Revisa los proveedores y las advertencias antes de restaurar.');
        } catch (failure) {
            setBackupText('');
            setFileName('');
            setPlan(null);
            setSelectedProviderIds([]);
            setError(failure?.message || 'No se pudo validar el archivo de ajustes.');
        } finally {
            input.value = '';
            setBusy(false);
        }
    }

    function toggleProvider(providerId, checked) {
        setSelectedProviderIds((current) => {
            if (checked) {
                return current.includes(providerId) ? current : [...current, providerId];
            }
            return current.filter((id) => id !== providerId);
        });
    }

    function handleMachineConfirmation(checked) {
        setConfirmMachineDependent(checked);
        if (!checked) {
            setSelectedProviderIds((current) => current.filter((id) => id !== 'external-tools'));
        }
    }

    async function handleApply() {
        if (!plan || !backupText || !selectedProviderIds.length) return;

        setBusy(true);
        setError('');
        setMessage('');

        try {
            const includesExternalTools = selectedProviderIds.includes('external-tools');
            const result = await applySettingsBackup(settingsRegistry, backupText, {
                providerIds: selectedProviderIds,
                confirmMachineDependent: includesExternalTools && confirmMachineDependent
            });
            const imported = result.importedProviderIds.join(', ');
            setMessage(
                'Restauración completada. Proveedores aplicados: ' + imported
                + '. Cierra y recarga CrayonShell para que todos los módulos adopten los ajustes.'
            );
        } catch (failure) {
            setError(failure?.message || 'No se pudo restaurar la configuración.');
        } finally {
            setBusy(false);
        }
    }

    const summary = plan?.summary;

    return (
        <dialog
            ref={dialogRef}
            className="activitybar-manager-dialog settings-backup-dialog"
            aria-labelledby="SettingsBackupTitle"
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
            onClose={onClose}
        >
            <div className="activitybar-manager settings-backup-manager">
                <header className="activitybar-manager-heading">
                    <div>
                        <strong id="SettingsBackupTitle">Respaldo global de configuración</strong>
                        <span>Exporta o restaura los ajustes persistentes de CrayonShell.</span>
                    </div>
                    <button
                        className="activitybar-manager-close"
                        type="button"
                        aria-label="Cerrar respaldo de configuración"
                        onClick={onClose}
                    >
                        ×
                    </button>
                </header>

                <div className="settings-backup-content">
                    <section className="settings-backup-intro">
                        <div>
                            <FaIcon name="download"/>
                            <div>
                                <strong>Exportar configuración actual</strong>
                                <span>Genera un archivo JSON con los seis proveedores registrados. No incluye cachés, logs ni estado temporal.</span>
                            </div>
                        </div>
                        <button type="button" onClick={handleExport} disabled={busy}>
                            <FaIcon name="file-export"/> Exportar JSON
                        </button>
                    </section>

                    <section className="settings-backup-import">
                        <div className="activitybar-manager-section-heading">
                            <strong>Importar un respaldo</strong>
                            <span>Límite: 5 MB · Formato JSON</span>
                        </div>
                        <div className="settings-backup-file-row">
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={busy}
                            >
                                <FaIcon name="folder-open"/> Seleccionar archivo
                            </button>
                            <span title={fileName}>{fileName || 'Ningún archivo seleccionado'}</span>
                            <input
                                ref={fileInputRef}
                                className="activitybar-manager-file-input"
                                type="file"
                                accept=".json,application/json"
                                onChange={handleFileChange}
                            />
                        </div>
                        <p className="activitybar-manager-note">
                            La validación y la vista previa no modifican los ajustes actuales. Solo se escribirá información al ejecutar la restauración.
                        </p>
                    </section>

                    {plan && (
                        <section className="settings-backup-preview" aria-label="Vista previa del respaldo">
                            <div className="activitybar-manager-section-heading">
                                <strong>Vista previa</strong>
                                <span>{plan.application?.name || 'Aplicación desconocida'} {plan.application?.version || ''}</span>
                            </div>
                            <div className="settings-backup-summary">
                                <div><strong>{summary.importable}</strong><span>Disponibles</span></div>
                                <div><strong>{summary.migrations}</strong><span>Con migración</span></div>
                                <div><strong>{summary.invalid + summary.newerVersions + summary.migrationRequired}</strong><span>No importables</span></div>
                                <div><strong>{summary.warnings}</strong><span>Advertencias</span></div>
                            </div>
                            <p className="settings-backup-exported">
                                Exportado: {formatExportDate(plan.exportedAt)}
                            </p>

                            <div className="settings-backup-provider-list">
                                {plan.providers.map((row) => {
                                    const importable = IMPORTABLE_STATUSES.has(row.status);
                                    const machineLocked = row.machineDependent && !confirmMachineDependent;
                                    const checked = selectedProviderIds.includes(row.id);

                                    return (
                                        <article className="settings-backup-provider" key={row.id}>
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                disabled={!importable || machineLocked || busy}
                                                aria-label={'Restaurar ' + row.label}
                                                onChange={(event) => toggleProvider(row.id, event.target.checked)}
                                            />
                                            <div className="settings-backup-provider-main">
                                                <div className="settings-backup-provider-heading">
                                                    <strong>{row.label}</strong>
                                                    <span className={'settings-backup-status is-' + row.status}>
                                                        {STATUS_LABELS[row.status] || row.status}
                                                    </span>
                                                </div>
                                                <p>{row.description}</p>
                                                <span className="settings-backup-version">
                                                    {row.sourceVersion
                                                        ? 'Versión ' + row.sourceVersion + ' → ' + (row.targetVersion ?? '—')
                                                        : 'Sin versión de origen'}
                                                </span>
                                                {row.warnings.map((warning, index) => (
                                                    <p className="settings-backup-warning" key={index}>{warning}</p>
                                                ))}
                                                {row.error && (
                                                    <p className="settings-backup-error">{row.error}</p>
                                                )}
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>

                            {plan.providers.some((row) => row.machineDependent && IMPORTABLE_STATUSES.has(row.status)) && (
                                <label className="settings-backup-machine-confirm">
                                    <input
                                        type="checkbox"
                                        checked={confirmMachineDependent}
                                        disabled={busy}
                                        onChange={(event) => handleMachineConfirmation(event.target.checked)}
                                    />
                                    <span>
                                        Confirmo que deseo reemplazar ejecutables y rutas locales de External Tools con los valores del respaldo. Revisaré estos valores después de importarlos.
                                    </span>
                                </label>
                            )}
                            <p className="activitybar-manager-note">
                                {selectedCount} proveedor(es) seleccionado(s). Los proveedores ausentes o incompatibles se omitirán y no modificarán la configuración local.
                            </p>
                        </section>
                    )}

                    {error && <p className="settings-backup-feedback is-error" role="alert">{error}</p>}
                    {message && <p className="settings-backup-feedback" role="status">{message}</p>}
                </div>

                <footer className="activitybar-manager-footer settings-backup-footer">
                    <span>
                        {plan
                            ? 'No se aplican cambios hasta pulsar Restaurar seleccionados.'
                            : 'Los respaldos se guardan localmente como archivos JSON.'}
                    </span>
                    <div>
                        <button type="button" onClick={onClose} disabled={busy}>Cerrar</button>
                        <button
                            className="activitybar-manager-primary"
                            type="button"
                            onClick={handleApply}
                            disabled={!plan?.canApply || selectedCount === 0 || busy}
                        >
                            <FaIcon name="refresh"/> {busy ? 'Procesando…' : 'Restaurar seleccionados'}
                        </button>
                    </div>
                </footer>
            </div>
        </dialog>
    );
}
