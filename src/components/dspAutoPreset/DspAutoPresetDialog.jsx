import { useEffect, useMemo, useRef, useState } from 'react';
import { getFooSdk } from '../../services/fooSdk.js';
import {
    createDspAutoPresetRule,
    getDspTrackDirectory,
    normalizeDspRulePath,
    normalizeDspAutoPresetSettings,
    readDspAutoPresetSettings,
    writeDspAutoPresetSettings
} from '../../features/dspAutoPreset/dspAutoPresetSettings.js';

function FaIcon({ name }) {
    return <i className={'fa fa-' + name} aria-hidden="true" />;
}

function RuleRow({ rule, presets, onChange, onRemove }) {
    return (
        <div className="dsp-auto-preset-rule">
            <input
                className="dsp-auto-preset-path"
                type="text"
                value={rule.path}
                aria-label="Ruta de la regla"
                onChange={(event) => onChange({ path: event.currentTarget.value })}
            />
            <select
                value={rule.presetName}
                aria-label="DSP Preset de la regla"
                onChange={(event) => onChange({ presetName: event.currentTarget.value })}
            >
                <option value="">Sin asignar</option>
                {rule.presetName && !presets.some((preset) => preset.name === rule.presetName) && (
                    <option value={rule.presetName}>
                        {rule.presetName} (no disponible)
                    </option>
                )}
                {presets.map((preset) => (
                    <option key={preset.name} value={preset.name}>{preset.name}</option>
                ))}
            </select>
            <button
                type="button"
                className="dsp-auto-preset-icon-button is-danger"
                title="Eliminar regla"
                aria-label="Eliminar regla"
                onClick={onRemove}
            >
                <FaIcon name="trash"/>
            </button>
        </div>
    );
}

export default function DspAutoPresetDialog({
    open,
    currentTrackPath = '',
    isDemoMode = false,
    onClose
}) {
    const dialogRef = useRef(null);
    const [config, setConfig] = useState(() => readDspAutoPresetSettings());
    const [presets, setPresets] = useState([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');
    const [activeTrackPath, setActiveTrackPath] = useState(currentTrackPath);

    useEffect(() => {
        if (open && currentTrackPath) {
            setActiveTrackPath(currentTrackPath);
        }
    }, [open, currentTrackPath]);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;

        if (open && !dialog.open) dialog.showModal();
        else if (!open && dialog.open) dialog.close();

        if (!open) return undefined;

        let cancelled = false;
        setLoading(true);
        setError('');
        setInfo('');

        async function load() {
            try {
                if (isDemoMode) {
                    throw new Error('La administración de DSP requiere ejecutar CrayonShell dentro de foobar2000.');
                }
                const sdk = getFooSdk();
                const [presetResult, chainResult, currentTrackResult] = await Promise.all([
                    sdk.dsp.getPresets(),
                    sdk.dsp.getChain(),
                    typeof sdk.player?.getCurrentTrack === 'function'
                        ? sdk.player.getCurrentTrack().catch(() => null)
                        : Promise.resolve(null)
                ]);
                if (presetResult?.success === false) {
                    throw new Error(presetResult.error || 'No se pudieron consultar los DSP Presets.');
                }
                if (chainResult?.success === false) {
                    throw new Error(chainResult.error || 'No se pudo consultar el DSP activo.');
                }

                const available = Array.isArray(presetResult.presets)
                    ? presetResult.presets.map((preset) => ({
                        name: String(preset.name || ''),
                        index: Number(preset.index),
                        active: Boolean(preset.active)
                    })).filter((preset) => preset.name)
                    : [];
                const saved = readDspAutoPresetSettings();
                if (!saved.defaultPreset && chainResult.activePreset) {
                    saved.defaultPreset = chainResult.activePreset;
                }
                const playingTrack = currentTrackResult?.found ? currentTrackResult.track : null;
                const resolvedTrackPath = String(
                    playingTrack?.absolutePath
                    || playingTrack?.path
                    || currentTrackPath
                    || ''
                ).trim();

                if (!cancelled) {
                    setPresets(available);
                    setConfig(saved);
                    setActiveTrackPath(resolvedTrackPath);
                }
            } catch (loadError) {
                if (!cancelled) setError(loadError?.message || String(loadError));
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        void load();
        return () => {
            cancelled = true;
        };
    }, [open, isDemoMode]);

    const presetNames = useMemo(
        () => presets.map((preset) => preset.name),
        [presets]
    );

    function updateRule(kind, id, patch) {
        setConfig((current) => ({
            ...current,
            [kind]: current[kind].map((rule) => (
                rule.id === id ? { ...rule, ...patch } : rule
            ))
        }));
    }

    function addFolderRule() {
        const folderPath = getDspTrackDirectory(activeTrackPath);
        if (!folderPath) {
            setError('La canción actual no tiene una ruta de archivo local desde la que obtener su carpeta.');
            return;
        }

        setError('');
        const normalizedPath = normalizeDspRulePath(folderPath);
        if (config.folderRules.some((rule) => normalizeDspRulePath(rule.path) === normalizedPath)) {
            setInfo('La carpeta de esta canción ya tiene una regla. Puedes editarla en la lista.');
            return;
        }

        setConfig((current) => ({
            ...current,
            folderRules: [
                ...current.folderRules,
                createDspAutoPresetRule(folderPath, current.defaultPreset || presetNames[0] || '')
            ]
        }));
        setInfo('Carpeta añadida. Guarda los cambios y vuelve a abrir la canción para que se aplique el DSP Preset.');
    }

    function addTrackRule() {
        if (!activeTrackPath) return;
        setError('');
        const normalizedPath = normalizeDspRulePath(activeTrackPath);
        if (config.trackRules.some((rule) => normalizeDspRulePath(rule.path) === normalizedPath)) {
            setInfo('La canción actual ya tiene una regla. Puedes editarla en la lista.');
            return;
        }

        setConfig((current) => ({
            ...current,
            trackRules: [
                ...current.trackRules,
                createDspAutoPresetRule(activeTrackPath, current.defaultPreset || presetNames[0] || '')
            ]
        }));
        setInfo('Canción añadida. Guarda los cambios y vuelve a abrir/reproducir esta canción para que se aplique el DSP Preset.');
    }

    function removeRule(kind, id) {
        setConfig((current) => ({
            ...current,
            [kind]: current[kind].filter((rule) => rule.id !== id)
        }));
    }

    function save() {
        setSaving(true);
        setError('');
        try {
            const normalized = normalizeDspAutoPresetSettings(config);
            if (normalized.defaultPreset && !presetNames.includes(normalized.defaultPreset)) {
                throw new Error('El DSP Preset predeterminado ya no existe en foobar2000.');
            }
            for (const rule of [...normalized.folderRules, ...normalized.trackRules]) {
                if (rule.presetName && !presetNames.includes(rule.presetName)) {
                    throw new Error('El DSP Preset "' + rule.presetName + '" ya no existe.');
                }
            }
            writeDspAutoPresetSettings(normalized);
            setConfig(normalized);
            onClose();
        } catch (saveError) {
            setError(saveError?.message || String(saveError));
        } finally {
            setSaving(false);
        }
    }

    const isDisabled = loading || saving || isDemoMode || presets.length === 0;

    return (
        <dialog
            ref={dialogRef}
            className="dsp-auto-preset-dialog"
            aria-labelledby="DspAutoPresetTitle"
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
            onClose={onClose}
        >
            <div className="dsp-auto-preset">
                <header className="dsp-auto-preset-heading">
                    <div>
                        <strong id="DspAutoPresetTitle">Administrador de DSP Auto Presets</strong>
                        <span>Selecciona el procesamiento que se aplicará al abrir cada canción.</span>
                    </div>
                    <button
                        type="button"
                        className="dsp-auto-preset-icon-button"
                        aria-label="Cerrar administrador"
                        onClick={onClose}
                    >
                        <FaIcon name="times"/>
                    </button>
                </header>

                {loading && <div className="dsp-auto-preset-message">Consultando DSP Presets de foobar2000…</div>}
                {error && <div className="dsp-auto-preset-message is-error" role="alert">{error}</div>}
                {info && <div className="dsp-auto-preset-message" role="status">{info}</div>}

                <section className="dsp-auto-preset-section">
                    <div className="dsp-auto-preset-section-heading">
                        <strong>DSP Preset predeterminado</strong>
                        <span>Se utiliza cuando ninguna regla coincide y al detener la reproducción.</span>
                    </div>
                    <select
                        className="dsp-auto-preset-default"
                        value={config.defaultPreset}
                        disabled={loading || saving || presets.length === 0}
                        onChange={(event) => setConfig((current) => ({
                            ...current,
                            defaultPreset: event.currentTarget.value
                        }))}
                    >
                        <option value="">Seleccionar DSP Preset predeterminado</option>
                        {config.defaultPreset && !presetNames.includes(config.defaultPreset) && (
                            <option value={config.defaultPreset}>
                                {config.defaultPreset} (no disponible)
                            </option>
                        )}
                        {presets.map((preset) => (
                            <option key={preset.name} value={preset.name}>{preset.name}</option>
                        ))}
                    </select>
                </section>

                <section className="dsp-auto-preset-section">
                    <div className="dsp-auto-preset-section-heading">
                        <div>
                            <strong>Reglas por subcarpeta</strong>
                            <span>Se aplican cuando se abre una canción dentro de la carpeta.</span>
                        </div>
                        <span className="dsp-auto-preset-count">{config.folderRules.length}</span>
                    </div>
                    <div className="dsp-auto-preset-rules">
                        {config.folderRules.length === 0 && (
                            <div className="dsp-auto-preset-empty">No hay reglas de carpeta configuradas.</div>
                        )}
                        {config.folderRules.map((rule) => (
                            <RuleRow
                                key={rule.id}
                                rule={rule}
                                presets={presets}
                                onChange={(patch) => updateRule('folderRules', rule.id, patch)}
                                onRemove={() => removeRule('folderRules', rule.id)}
                            />
                        ))}
                    </div>
                    <button
                        type="button"
                        className="dsp-auto-preset-add"
                        disabled={isDisabled || !getDspTrackDirectory(activeTrackPath)}
                        title={getDspTrackDirectory(activeTrackPath) || 'No hay una canción local en reproducción'}
                        onClick={addFolderRule}
                    >
                        <FaIcon name="folder-open"/> Agregar carpeta contenedora
                    </button>
                </section>

                <section className="dsp-auto-preset-section">
                    <div className="dsp-auto-preset-section-heading">
                        <div>
                            <strong>Reglas por canción</strong>
                            <span>La excepción se crea únicamente con la canción que está sonando.</span>
                        </div>
                        <span className="dsp-auto-preset-count">{config.trackRules.length}</span>
                    </div>
                    <div className="dsp-auto-preset-rules">
                        {config.trackRules.length === 0 && (
                            <div className="dsp-auto-preset-empty">No hay excepciones por canción.</div>
                        )}
                        {config.trackRules.map((rule) => (
                            <RuleRow
                                key={rule.id}
                                rule={rule}
                                presets={presets}
                                onChange={(patch) => updateRule('trackRules', rule.id, patch)}
                                onRemove={() => removeRule('trackRules', rule.id)}
                            />
                        ))}
                    </div>
                    <button
                        type="button"
                        className="dsp-auto-preset-add"
                        disabled={isDisabled || !activeTrackPath}
                        title={activeTrackPath || 'No hay una canción en reproducción'}
                        onClick={addTrackRule}
                    >
                        <FaIcon name="music"/> Agregar canción actual
                    </button>
                    {activeTrackPath && (
                        <div className="dsp-auto-preset-current-path" title={activeTrackPath}>
                            En reproducción: {activeTrackPath}
                        </div>
                    )}
                </section>

                <footer className="dsp-auto-preset-footer">
                    <span>{presets.length} DSP Presets disponibles</span>
                    <div>
                        <button type="button" className="dsp-auto-preset-secondary" onClick={onClose}>
                            Cancelar
                        </button>
                        <button
                            type="button"
                            className="dsp-auto-preset-primary"
                            disabled={loading || saving || isDemoMode || presets.length === 0 || !config.defaultPreset}
                            onClick={save}
                        >
                            <FaIcon name="save"/> Guardar cambios
                        </button>
                    </div>
                </footer>
            </div>
        </dialog>
    );
}
