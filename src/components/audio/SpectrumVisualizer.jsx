import { useCallback, useEffect, useRef, useState } from 'react';
import { getFooSdk } from '../../services/fooSdk.js';
import {
    DEFAULT_SPECTRUM_SETTINGS,
    normalizeSpectrumSettings,
    readSpectrumSettings,
    SPECTRUM_SETTINGS_STORAGE_KEY,
    writeSpectrumSettings
} from '../../features/spectrum/spectrumSettings.js';


function normalizeValues(values, settings, decibels) {
    if (!Array.isArray(values)) return [];
    return values.map((raw) => {
        const number = Number(raw);
        const value = decibels
            ? Math.max(0, Math.min(1, ((Number.isFinite(number) ? number : -160) + 90) / 90))
            : Math.max(0, Math.min(1, Number.isFinite(number) ? number : 0));
        return Math.min(1, Math.pow(value, 0.78) * settings.sensitivity);
    });
}

function smooth(target, previous, decay) {
    const count = Math.max(target.length, previous.length);
    return Array.from({ length: count }, (_, index) => {
        const next = target[index] || 0;
        const prior = previous[index] || 0;
        const result = next >= prior ? prior + (next - prior) * 0.42 : Math.max(next, prior * decay);
        return result < 0.002 ? 0 : result;
    });
}

function smoothFrame(target, previous, decay) {
    if (Array.isArray(target)) return smooth(target, Array.isArray(previous) ? previous : [], decay);
    if (target && typeof target === 'object') {
        const oldLeft = previous && !Array.isArray(previous) ? previous.left : [];
        const oldRight = previous && !Array.isArray(previous) ? previous.right : [];
        return {
            left: smooth(target.left || [], oldLeft || [], decay),
            right: smooth(target.right || [], oldRight || [], decay)
        };
    }
    return [];
}

function drawSeries(context, values, x, y, width, height) {
    if (!values.length || width <= 0 || height <= 0) return;
    const gap = Math.max(0.5, Math.min(2, width / values.length * 0.18));
    const barWidth = Math.max(0.5, (width - gap * (values.length - 1)) / values.length);
    values.forEach((value, index) => {
        if (value < 0.01) return;
        const barHeight = Math.max(1, Math.min(height, value * height));
        context.fillRect(x + index * (barWidth + gap), y + height - barHeight, barWidth, barHeight);
    });
}

function drawBars(canvas, frame, settings = DEFAULT_SPECTRUM_SETTINGS) {
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(bounds.width * ratio);
    const height = Math.round(bounds.height * ratio);
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    context.fillStyle = settings.backgroundColor;
    context.fillRect(0, 0, bounds.width, bounds.height);
    const gradient = context.createLinearGradient(0, bounds.height, 0, 0);
    gradient.addColorStop(0, settings.barColorStart);
    gradient.addColorStop(0.65, settings.barColorMid);
    gradient.addColorStop(1, settings.barColorEnd);
    context.fillStyle = gradient;

    if (frame && !Array.isArray(frame) && Array.isArray(frame.left) && Array.isArray(frame.right)) {
        const rowHeight = Math.max(1, (bounds.height - 3) / 2);
        drawSeries(context, frame.left, 0, 0, bounds.width, rowHeight);
        drawSeries(context, frame.right, 0, rowHeight + 3, bounds.width, rowHeight);
    } else {
        drawSeries(context, Array.isArray(frame) ? frame : [], 0, 0, bounds.width, bounds.height);
    }
}

function SelectField({ label, value, options, onChange }) {
    return (
        <label className="spectrum-field">
            <span>{label}</span>
            <select value={value} onChange={(event) => onChange(event.target.value)}>
                {options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                ))}
            </select>
        </label>
    );
}

function NumberField({ label, value, min, max, onChange }) {
    return (
        <label className="spectrum-field">
            <span>{label}</span>
            <div className="spectrum-number-control">
                <input
                    type="number"
                    min={min}
                    max={max}
                    value={value}
                    onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
                />
                <span>Hz</span>
            </div>
        </label>
    );
}

export default function SpectrumVisualizer({ visible = true }) {
    // Subscribe on first show and preserve the stream across later hide/show cycles.
    const [hasBeenVisible, setHasBeenVisible] = useState(visible);

    useEffect(() => {
        if (visible) setHasBeenVisible(true);
    }, [visible]);
    const canvasRef = useRef(null);
    const dialogRef = useRef(null);
    const menuRef = useRef(null);
    const settingsRef = useRef(null);
    const targetRef = useRef([]);
    const currentRef = useRef([]);
    const receivedRef = useRef(false);
    const fallbackMessageRef = useRef('');

    const [settings, setSettings] = useState(readSpectrumSettings);
    const [draft, setDraft] = useState(settings);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [menu, setMenu] = useState(null);
    const [status, setStatus] = useState('Conectando con foobar2000…');

    settingsRef.current = settings;

    const redraw = useCallback(() => {
        drawBars(canvasRef.current, currentRef.current, settingsRef.current || DEFAULT_SPECTRUM_SETTINGS);
    }, []);

    const receiveFrame = useCallback((frame) => {
        const currentSettings = settingsRef.current || DEFAULT_SPECTRUM_SETTINGS;
        const isDb = currentSettings.output === 'bins' || currentSettings.scale === 'db';
        if (currentSettings.output === 'bins'
            && currentSettings.channels === 'stereo'
            && Array.isArray(frame?.left) && Array.isArray(frame?.right)) {
            targetRef.current = {
                left: normalizeValues(frame.left, currentSettings, true),
                right: normalizeValues(frame.right, currentSettings, true)
            };
        } else {
            targetRef.current = normalizeValues(frame?.spectrum, currentSettings, isDb);
        }
    }, []);

    useEffect(() => {
        if (!hasBeenVisible) return undefined;

        let active = true;
        let unsubscribe = null;
        let animationFrame = 0;
        receivedRef.current = false;
        targetRef.current = [];
        currentRef.current = [];
        setStatus('Conectando con foobar2000…');
        redraw();

        function animate() {
            const currentSettings = settingsRef.current || DEFAULT_SPECTRUM_SETTINGS;
            currentRef.current = smoothFrame(
                targetRef.current,
                currentRef.current,
                currentSettings.decay
            );
            redraw();
            animationFrame = window.requestAnimationFrame(animate);
        }

        try {
            const sdk = getFooSdk();
            if (typeof sdk.audio?.subscribeSpectrum !== 'function') {
                throw new Error('El SDK no expone fb.audio.subscribeSpectrum().');
            }

            const options = {
                fftSize: settings.fftSize,
                fps: settings.fps,
                minFrequency: settings.minFrequency,
                maxFrequency: settings.maxFrequency,
                output: settings.output,
                backgroundThrottle: settings.backgroundThrottle
            };
            if (settings.output === 'bands') {
                options.bands = settings.bands;
                options.scale = settings.scale;
            } else {
                options.channels = settings.channels;
            }

            unsubscribe = sdk.audio.subscribeSpectrum((frame) => {
                if (!active) return;
                receiveFrame(frame);
                if (!receivedRef.current) {
                    receivedRef.current = true;
                    setStatus('Recibiendo espectro');
                }
            }, options);

            animationFrame = window.requestAnimationFrame(animate);
            unsubscribe.ready.then((outcome) => {
                if (!active) return;
                if (!outcome.ok) {
                    window.cancelAnimationFrame(animationFrame);
                    animationFrame = 0;
                    setStatus('Spectrum no disponible: ' + (outcome.error || outcome.code || 'error desconocido'));
                    return;
                }

                if (settings.output === 'bins' && outcome.output !== 'bins') {
                    fallbackMessageRef.current = 'Este host no admite bins FFT; se usarán bandas logarítmicas.';
                    const supported = normalizeSpectrumSettings({ ...settings, output: 'bands' });
                    setSettings(supported);
                    try {
                        writeSpectrumSettings(supported);
                    } catch {
                        // Keep the supported setting for this session.
                    }
                    return;
                }

                if (!receivedRef.current) {
                    setStatus(fallbackMessageRef.current || (
                        outcome.streamReady === false
                            ? 'Esperando una señal de audio…'
                            : 'Conectado · esperando audio'
                    ));
                }
            });
        } catch (error) {
            setStatus(error.message || String(error));
        }

        return () => {
            active = false;
            if (animationFrame) window.cancelAnimationFrame(animationFrame);
            if (typeof unsubscribe === 'function') unsubscribe();
        };
    }, [
        hasBeenVisible,
        settings.bands,
        settings.fftSize,
        settings.fps,
        settings.minFrequency,
        settings.maxFrequency,
        settings.output,
        settings.scale,
        settings.channels,
        settings.backgroundThrottle,
        receiveFrame,
        redraw
    ]);

    useEffect(() => {
        const container = canvasRef.current?.parentElement;
        if (!container || typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(redraw);
        observer.observe(container);
        return () => observer.disconnect();
    }, [redraw]);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (dialogOpen && !dialog.open) dialog.showModal();
        else if (!dialogOpen && dialog.open) dialog.close();
    }, [dialogOpen]);

    useEffect(() => {
        if (!menu) return undefined;
        function dismiss(event) {
            if (!menuRef.current?.contains(event.target)) setMenu(null);
        }
        function escape(event) {
            if (event.key === 'Escape') setMenu(null);
        }
        document.addEventListener('pointerdown', dismiss);
        document.addEventListener('keydown', escape);
        return () => {
            document.removeEventListener('pointerdown', dismiss);
            document.removeEventListener('keydown', escape);
        };
    }, [menu]);

    function openContextMenu(event) {
        event.preventDefault();
        const menuWidth = 205;
        const menuHeight = 42;
        setMenu({
            left: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
            top: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8))
        });
    }

    function openSettings() {
        setDraft({ ...settings });
        setMenu(null);
        setDialogOpen(true);
    }

    function updateDraft(field, value) {
        setDraft((current) => ({ ...current, [field]: value }));
    }

    function saveSettings() {
        const next = normalizeSpectrumSettings(draft);
        setSettings(next);
        try {
            writeSpectrumSettings(next);
        } catch {
            // Settings remain active for this session.
        }
        setDialogOpen(false);
    }

    return (
        <section className="spectrum-section" aria-label="Spectrum Visualizer" onContextMenu={openContextMenu}>
            <div className="spectrum-canvas-wrap">
                <canvas ref={canvasRef} className="spectrum-canvas" role="img" aria-label="Visualizador de espectro de audio" />
                <div className="spectrum-hint">Clic derecho para configurar</div>
            </div>

            {menu && (
                <div
                    ref={menuRef}
                    className="spectrum-context-menu"
                    role="menu"
                    style={{ left: menu.left + 'px', top: menu.top + 'px' }}
                    onContextMenu={(event) => event.preventDefault()}
                >
                    <button type="button" role="menuitem" onClick={openSettings}>
                        Configurar Spectrum…
                    </button>
                </div>
            )}

            <dialog
                ref={dialogRef}
                className="spectrum-settings-dialog"
                aria-labelledby="SpectrumSettingsTitle"
                onCancel={(event) => {
                    event.preventDefault();
                    setDialogOpen(false);
                }}
                onClose={() => setDialogOpen(false)}
            >
                <form
                    className="spectrum-settings"
                    onSubmit={(event) => {
                        event.preventDefault();
                        saveSettings();
                    }}
                >
                    <header className="spectrum-settings-heading">
                        <div>
                            <strong id="SpectrumSettingsTitle">Configuración del Spectrum</strong>
                            <span>Opciones de análisis FFT y presentación.</span>
                        </div>
                        <button
                            className="spectrum-settings-close"
                            type="button"
                            aria-label="Cerrar configuración"
                            onClick={() => setDialogOpen(false)}
                        >
                            ×
                        </button>
                    </header>

                    <div className="spectrum-dialog-status" role="status" title={status}>
                        <span>Estado del visualizador</span>
                        <strong>{status}</strong>
                    </div>

                    <section className="spectrum-settings-section">
                        <strong>Análisis FFT</strong>
                        <div className="spectrum-settings-grid">
                            <SelectField
                                label="Salida"
                                value={draft.output}
                                options={[
                                    { value: 'bands', label: 'Bandas logarítmicas' },
                                    { value: 'bins', label: 'Bins FFT lineales' }
                                ]}
                                onChange={(value) => updateDraft('output', value)}
                            />
                            {draft.output === 'bands' && (
                                <SelectField
                                    label="Número de bandas"
                                    value={String(draft.bands)}
                                    options={BAND_OPTIONS.map((value) => ({
                                        value: String(value), label: String(value)
                                    }))}
                                    onChange={(value) => updateDraft('bands', Number(value))}
                                />
                            )}
                            <SelectField
                                label="Tamaño FFT"
                                value={String(draft.fftSize)}
                                options={FFT_OPTIONS.map((value) => ({
                                    value: String(value), label: value.toLocaleString('es-MX')
                                }))}
                                onChange={(value) => updateDraft('fftSize', Number(value))}
                            />
                            <SelectField
                                label="Actualización"
                                value={String(draft.fps)}
                                options={FPS_OPTIONS.map((value) => ({
                                    value: String(value), label: value + ' FPS'
                                }))}
                                onChange={(value) => updateDraft('fps', Number(value))}
                            />
                            {draft.output === 'bands' && (
                                <SelectField
                                    label="Escala de amplitud"
                                    value={draft.scale}
                                    options={[
                                        { value: 'weighted', label: 'Weighted (visual)' },
                                        { value: 'db', label: 'Decibelios (dB)' }
                                    ]}
                                    onChange={(value) => updateDraft('scale', value)}
                                />
                            )}
                            {draft.output === 'bins' && (
                                <SelectField
                                    label="Canales"
                                    value={draft.channels}
                                    options={[
                                        { value: 'mix', label: 'Mezcla' },
                                        { value: 'stereo', label: 'Estéreo (L / R)' }
                                    ]}
                                    onChange={(value) => updateDraft('channels', value)}
                                />
                            )}
                            <NumberField
                                label="Frecuencia mínima"
                                value={draft.minFrequency}
                                min={1}
                                max={95999}
                                onChange={(value) => updateDraft('minFrequency', value)}
                            />
                            <NumberField
                                label="Frecuencia máxima"
                                value={draft.maxFrequency}
                                min={Number(draft.minFrequency) + 1}
                                max={96000}
                                onChange={(value) => updateDraft('maxFrequency', value)}
                            />
                            <label className="spectrum-check-field">
                                <input
                                    type="checkbox"
                                    checked={draft.backgroundThrottle}
                                    onChange={(event) => updateDraft('backgroundThrottle', event.target.checked)}
                                />
                                <span>Reducir FPS cuando otra aplicación esté en primer plano</span>
                            </label>
                        </div>
                        <p className="spectrum-settings-note">
                            La API genera FFT. Bandas: distribución logarítmica del host.
                            Bins: resolución lineal. La salida bins utiliza dB.
                        </p>
                        <p className="spectrum-settings-note is-limited">
                            CQT, SWIFT, Analog-style, funciones de ventana, Hop Size, Window Skew,
                            Reaction Alignment y Reassignment Sharpening requieren transformaciones
                            que la API de espectro actual no expone. No se muestran como controles
                            porque no tendrían efecto.
                        </p>
                        {draft.fftSize >= 32768 && (
                            <p className="spectrum-settings-warning">
                                FFT de alta resolución: 32768 o 65536 pueden aumentar notablemente
                                el uso de CPU y el tiempo de análisis.
                            </p>
                        )}
                    </section>

                    <section className="spectrum-settings-section">
                        <strong>Presentación</strong>
                        <div className="spectrum-settings-grid">
                            <label className="spectrum-field spectrum-color-field">
                                <span>Fondo del visualizador</span>
                                <input type="color" value={draft.backgroundColor} onChange={(event) => updateDraft('backgroundColor', event.target.value)} />
                            </label>
                            <label className="spectrum-field spectrum-color-field">
                                <span>Color inferior de barras</span>
                                <input type="color" value={draft.barColorStart} onChange={(event) => updateDraft('barColorStart', event.target.value)} />
                            </label>
                            <label className="spectrum-field spectrum-color-field">
                                <span>Color medio de barras</span>
                                <input type="color" value={draft.barColorMid} onChange={(event) => updateDraft('barColorMid', event.target.value)} />
                            </label>
                            <label className="spectrum-field spectrum-color-field">
                                <span>Color superior de barras</span>
                                <input type="color" value={draft.barColorEnd} onChange={(event) => updateDraft('barColorEnd', event.target.value)} />
                            </label>
                            <label className="spectrum-field spectrum-range-field">
                                <span>
                                    Sensibilidad
                                    <output>{Number(draft.sensitivity).toFixed(1)}×</output>
                                </span>
                                <input
                                    type="range" min="0.5" max="3" step="0.1"
                                    value={draft.sensitivity}
                                    onChange={(event) => updateDraft('sensitivity', Number(event.target.value))}
                                />
                            </label>
                            <label className="spectrum-field spectrum-range-field">
                                <span>
                                    Persistencia de barras
                                    <output>{Math.round(draft.decay * 100)}%</output>
                                </span>
                                <input
                                    type="range" min="0.75" max="0.98" step="0.01"
                                    value={draft.decay}
                                    onChange={(event) => updateDraft('decay', Number(event.target.value))}
                                />
                            </label>
                        </div>
                    </section>

                    <footer className="spectrum-settings-actions">
                        <button
                            type="button"
                            className="spectrum-secondary-button"
                            onClick={() => setDraft({ ...DEFAULT_SPECTRUM_SETTINGS })}
                        >
                            Restablecer valores
                        </button>
                        <div>
                            <button type="button" className="spectrum-secondary-button" onClick={() => setDialogOpen(false)}>
                                Cancelar
                            </button>
                            <button type="submit" className="spectrum-primary-button">Guardar</button>
                        </div>
                    </footer>
                </form>
            </dialog>
        </section>
    );
}
