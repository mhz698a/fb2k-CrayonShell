import { useCallback, useEffect, useRef, useState } from 'react';
import { getFooSdk } from '../../services/fooSdk.js';

const SETTINGS_STORAGE_KEY = 'crayonshell.spectrum.settings.v1';

const DEFAULT_SETTINGS = Object.freeze({
    bands: 64,
    fftSize: 2048,
    fps: 30,
    minFrequency: 20,
    maxFrequency: 16000,
    sensitivity: 1.5,
    decay: 0.88
});

const BAND_OPTIONS = [32, 48, 64, 96];
const FFT_OPTIONS = [512, 1024, 2048, 4096, 8192];
const FPS_OPTIONS = [15, 24, 30, 45, 60];
const MIN_FREQUENCY_OPTIONS = [20, 30, 40, 60, 80, 100];
const MAX_FREQUENCY_OPTIONS = [8000, 12000, 16000, 18000, 20000];

function normalizeSettings(candidate = {}) {
    const bands = Number(candidate.bands);
    const fftSize = Number(candidate.fftSize);
    const fps = Number(candidate.fps);
    const minFrequency = Number(candidate.minFrequency);
    const maxFrequency = Number(candidate.maxFrequency);
    const sensitivity = Number(candidate.sensitivity);
    const decay = Number(candidate.decay);

    const normalizedMin = MIN_FREQUENCY_OPTIONS.includes(minFrequency)
        ? minFrequency
        : DEFAULT_SETTINGS.minFrequency;
    const validMax = MAX_FREQUENCY_OPTIONS.includes(maxFrequency)
        && maxFrequency > normalizedMin
        ? maxFrequency
        : DEFAULT_SETTINGS.maxFrequency;

    return {
        bands: BAND_OPTIONS.includes(bands) ? bands : DEFAULT_SETTINGS.bands,
        fftSize: FFT_OPTIONS.includes(fftSize) ? fftSize : DEFAULT_SETTINGS.fftSize,
        fps: FPS_OPTIONS.includes(fps) ? fps : DEFAULT_SETTINGS.fps,
        minFrequency: normalizedMin,
        maxFrequency: validMax,
        sensitivity: Number.isFinite(sensitivity)
            ? Math.max(0.5, Math.min(3, sensitivity))
            : DEFAULT_SETTINGS.sensitivity,
        decay: Number.isFinite(decay)
            ? Math.max(0.75, Math.min(0.98, decay))
            : DEFAULT_SETTINGS.decay
    };
}

function readSettings() {
    try {
        const stored = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
        return stored ? normalizeSettings(JSON.parse(stored)) : { ...DEFAULT_SETTINGS };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

function drawBars(canvas, values) {
    if (!canvas) return;

    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(bounds.width * pixelRatio);
    const pixelHeight = Math.round(bounds.height * pixelRatio);

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
    }

    const context = canvas.getContext('2d');
    if (!context) return;

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    context.fillStyle = '#101418';
    context.fillRect(0, 0, bounds.width, bounds.height);

    const count = values.length;
    if (count === 0) return;

    const gap = Math.max(0.5, Math.min(2, bounds.width / count * 0.18));
    const barWidth = Math.max(0.5, (bounds.width - gap * (count - 1)) / count);
    const gradient = context.createLinearGradient(0, bounds.height, 0, 0);
    gradient.addColorStop(0, '#1477b8');
    gradient.addColorStop(0.65, '#29a9d8');
    gradient.addColorStop(1, '#79d7e8');
    context.fillStyle = gradient;

    values.forEach((value, index) => {
        const barHeight = Math.max(1, Math.min(bounds.height, value * bounds.height));
        const x = index * (barWidth + gap);
        context.fillRect(x, bounds.height - barHeight, barWidth, barHeight);
    });
}

function SelectField({ label, value, options, onChange, formatOption = String }) {
    return (
        <label className="spectrum-field">
            <span>{label}</span>
            <select value={value} onChange={(event) => onChange(Number(event.target.value))}>
                {options.map((option) => (
                    <option key={option} value={option}>
                        {formatOption(option)}
                    </option>
                ))}
            </select>
        </label>
    );
}

export default function SpectrumVisualizer({ visible = true }) {
    const canvasRef = useRef(null);
    const dialogRef = useRef(null);
    const contextMenuRef = useRef(null);
    const settingsRef = useRef(null);
    const targetBarsRef = useRef([]);
    const currentBarsRef = useRef([]);
    const receivedFrameRef = useRef(false);

    const [settings, setSettings] = useState(readSettings);
    const [draftSettings, setDraftSettings] = useState(settings);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [contextMenu, setContextMenu] = useState(null);
    const [status, setStatus] = useState('Panel oculto');

    settingsRef.current = settings;

    const redraw = useCallback(() => {
        drawBars(canvasRef.current, currentBarsRef.current);
    }, []);

    const receiveSpectrum = useCallback((spectrum) => {
        const values = Array.isArray(spectrum) ? spectrum : [];
        const currentSettings = settingsRef.current || DEFAULT_SETTINGS;
        targetBarsRef.current = values.map((value) => {
            const normalized = Math.max(0, Math.min(1, Number(value) || 0));
            return Math.min(
                1,
                Math.pow(normalized, 0.78) * currentSettings.sensitivity
            );
        });
    }, []);

    useEffect(() => {
        if (!visible) {
            setStatus('Panel oculto');
            targetBarsRef.current = [];
            currentBarsRef.current = [];
            redraw();
            return undefined;
        }

        let active = true;
        let unsubscribe = null;
        receivedFrameRef.current = false;
        setStatus('Conectando con foobar2000…');
        targetBarsRef.current = [];
        currentBarsRef.current = [];
        redraw();

        try {
            const sdk = getFooSdk();
            if (typeof sdk.audio?.subscribeSpectrum !== 'function') {
                throw new Error('El SDK no expone fb.audio.subscribeSpectrum().');
            }

            unsubscribe = sdk.audio.subscribeSpectrum((frame) => {
                if (!active) return;
                receiveSpectrum(frame?.spectrum);
                if (!receivedFrameRef.current) {
                    receivedFrameRef.current = true;
                    setStatus('Recibiendo espectro');
                }
            }, {
                bands: settings.bands,
                fftSize: settings.fftSize,
                fps: settings.fps,
                minFrequency: settings.minFrequency,
                maxFrequency: settings.maxFrequency,
                scale: 'weighted',
                output: 'bands',
                backgroundThrottle: true
            });

            unsubscribe.ready.then((outcome) => {
                if (!active) return;
                if (!outcome.ok) {
                    setStatus('Spectrum no disponible: ' + (outcome.error || outcome.code || 'error desconocido'));
                    return;
                }
                if (!receivedFrameRef.current) {
                    setStatus(outcome.streamReady === false
                        ? 'Esperando una señal de audio…'
                        : 'Conectado · esperando audio');
                }
            });
        } catch (error) {
            setStatus(error.message || String(error));
        }

        return () => {
            active = false;
            if (typeof unsubscribe === 'function') unsubscribe();
        };
    }, [
        visible,
        settings.bands,
        settings.fftSize,
        settings.fps,
        settings.minFrequency,
        settings.maxFrequency,
        receiveSpectrum,
        redraw
    ]);

    useEffect(() => {
        if (!visible) return undefined;

        let animationFrame = 0;
        function animate() {
            const targets = targetBarsRef.current;
            const previous = currentBarsRef.current;
            const currentSettings = settingsRef.current || DEFAULT_SETTINGS;
            const count = Math.max(targets.length, previous.length);

            currentBarsRef.current = Array.from({ length: count }, (_, index) => {
                const target = targets[index] || 0;
                const prior = previous[index] || 0;
                return target >= prior
                    ? prior + (target - prior) * 0.42
                    : Math.max(target, prior * currentSettings.decay);
            });

            redraw();
            animationFrame = window.requestAnimationFrame(animate);
        }

        animationFrame = window.requestAnimationFrame(animate);
        return () => window.cancelAnimationFrame(animationFrame);
    }, [visible, redraw]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = canvas?.parentElement;
        if (!container || typeof ResizeObserver === 'undefined') return undefined;

        const observer = new ResizeObserver(redraw);
        observer.observe(container);
        return () => observer.disconnect();
    }, [redraw]);

    useEffect(() => {
        if (!dialogOpen) return undefined;
        const dialog = dialogRef.current;
        if (dialog && !dialog.open) dialog.showModal();
        return undefined;
    }, [dialogOpen]);

    useEffect(() => {
        if (!contextMenu) return undefined;

        function handlePointerDown(event) {
            if (!contextMenuRef.current?.contains(event.target)) {
                setContextMenu(null);
            }
        }

        function handleKeyDown(event) {
            if (event.key === 'Escape') setContextMenu(null);
        }

        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [contextMenu]);

    function handleContextMenu(event) {
        event.preventDefault();
        const menuWidth = 205;
        const menuHeight = 42;
        setContextMenu({
            left: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
            top: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8))
        });
    }

    function openSettings() {
        setDraftSettings({ ...settings });
        setContextMenu(null);
        setDialogOpen(true);
    }

    function updateDraft(field, value) {
        setDraftSettings((current) => ({ ...current, [field]: value }));
    }

    function saveSettings() {
        const nextSettings = normalizeSettings(draftSettings);
        setSettings(nextSettings);
        try {
            window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
        } catch {
            // The settings still apply for this session if storage is unavailable.
        }
        setDialogOpen(false);
    }

    function resetDraft() {
        setDraftSettings({ ...DEFAULT_SETTINGS });
    }

    return (
        <section
            className="spectrum-section"
            aria-label="Spectrum Visualizer"
            onContextMenu={handleContextMenu}
        >
            <header className="sidebar-section-heading spectrum-heading">
                <strong>Spectrum</strong>
                <span className="spectrum-status" title={status}>{status}</span>
            </header>

            <div className="spectrum-canvas-wrap">
                <canvas
                    ref={canvasRef}
                    className="spectrum-canvas"
                    role="img"
                    aria-label="Visualizador de espectro de audio"
                />
                <div className="spectrum-hint">Clic derecho para configurar</div>
            </div>

            {contextMenu && (
                <div
                    ref={contextMenuRef}
                    className="spectrum-context-menu"
                    role="menu"
                    style={{ left: contextMenu.left + 'px', top: contextMenu.top + 'px' }}
                    onContextMenu={(event) => event.preventDefault()}
                >
                    <button
                        type="button"
                        role="menuitem"
                        onClick={openSettings}
                    >
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
                            <span>Los cambios se aplican al guardar.</span>
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

                    <div className="spectrum-settings-grid">
                        <SelectField
                            label="Bandas"
                            value={draftSettings.bands}
                            options={BAND_OPTIONS}
                            onChange={(value) => updateDraft('bands', value)}
                        />
                        <SelectField
                            label="Tamaño FFT"
                            value={draftSettings.fftSize}
                            options={FFT_OPTIONS}
                            onChange={(value) => updateDraft('fftSize', value)}
                        />
                        <SelectField
                            label="Actualización"
                            value={draftSettings.fps}
                            options={FPS_OPTIONS}
                            onChange={(value) => updateDraft('fps', value)}
                            formatOption={(value) => value + ' FPS'}
                        />
                        <SelectField
                            label="Frecuencia mínima"
                            value={draftSettings.minFrequency}
                            options={MIN_FREQUENCY_OPTIONS}
                            onChange={(value) => updateDraft('minFrequency', value)}
                            formatOption={(value) => value + ' Hz'}
                        />
                        <SelectField
                            label="Frecuencia máxima"
                            value={draftSettings.maxFrequency}
                            options={MAX_FREQUENCY_OPTIONS}
                            onChange={(value) => updateDraft('maxFrequency', value)}
                            formatOption={(value) => (value / 1000) + ' kHz'}
                        />

                        <label className="spectrum-field spectrum-range-field">
                            <span>
                                Sensibilidad
                                <output>{draftSettings.sensitivity.toFixed(1)}×</output>
                            </span>
                            <input
                                type="range"
                                min="0.5"
                                max="3"
                                step="0.1"
                                value={draftSettings.sensitivity}
                                onChange={(event) => updateDraft('sensitivity', Number(event.target.value))}
                            />
                        </label>

                        <label className="spectrum-field spectrum-range-field">
                            <span>
                                Persistencia de barras
                                <output>{Math.round(draftSettings.decay * 100)}%</output>
                            </span>
                            <input
                                type="range"
                                min="0.75"
                                max="0.98"
                                step="0.01"
                                value={draftSettings.decay}
                                onChange={(event) => updateDraft('decay', Number(event.target.value))}
                            />
                        </label>
                    </div>

                    <footer className="spectrum-settings-actions">
                        <button type="button" className="spectrum-secondary-button" onClick={resetDraft}>
                            Restablecer valores
                        </button>
                        <div>
                            <button type="button" className="spectrum-secondary-button" onClick={() => setDialogOpen(false)}>
                                Cancelar
                            </button>
                            <button type="submit" className="spectrum-primary-button">
                                Guardar
                            </button>
                        </div>
                    </footer>
                </form>
            </dialog>
        </section>
    );
}
