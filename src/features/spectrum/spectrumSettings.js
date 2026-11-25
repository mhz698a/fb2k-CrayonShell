export const SPECTRUM_SETTINGS_STORAGE_KEY = 'crayonshell.spectrum.settings.v1';

export const DEFAULT_SPECTRUM_SETTINGS = Object.freeze({
    bands: 64,
    fftSize: 2048,
    fps: 30,
    minFrequency: 20,
    maxFrequency: 16000,
    output: 'bands',
    scale: 'weighted',
    channels: 'mix',
    backgroundThrottle: true,
    sensitivity: 1.5,
    decay: 0.88,
    backgroundColor: '#101418',
    barColorStart: '#1477b8',
    barColorMid: '#29a9d8',
    barColorEnd: '#79d7e8'
});

const BAND_OPTIONS = [16, 24, 32, 48, 64, 96, 128, 192, 256];
const FFT_OPTIONS = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];
const FPS_OPTIONS = [15, 24, 30, 45, 60];

function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

export function normalizeSpectrumSettings(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
    const fftSize = FFT_OPTIONS.includes(Number(source.fftSize))
        ? Number(source.fftSize)
        : DEFAULT_SPECTRUM_SETTINGS.fftSize;
    const availableBands = BAND_OPTIONS.filter((count) => count <= fftSize / 2);
    const requestedBands = Number(source.bands);
    const bands = availableBands.includes(requestedBands)
        ? requestedBands
        : (availableBands[availableBands.length - 1] || DEFAULT_SPECTRUM_SETTINGS.bands);
    const minFrequency = Math.round(clampNumber(
        source.minFrequency, 1, 95999, DEFAULT_SPECTRUM_SETTINGS.minFrequency
    ));
    const maxFrequency = Math.round(clampNumber(
        source.maxFrequency, minFrequency + 1, 96000, DEFAULT_SPECTRUM_SETTINGS.maxFrequency
    ));

    return {
        bands,
        fftSize,
        fps: FPS_OPTIONS.includes(Number(source.fps))
            ? Number(source.fps)
            : DEFAULT_SPECTRUM_SETTINGS.fps,
        minFrequency,
        maxFrequency: Math.max(minFrequency + 1, maxFrequency),
        output: source.output === 'bins' ? 'bins' : 'bands',
        scale: source.scale === 'db' ? 'db' : 'weighted',
        channels: source.channels === 'stereo' ? 'stereo' : 'mix',
        backgroundThrottle: source.backgroundThrottle !== false,
        sensitivity: clampNumber(source.sensitivity, 0.5, 3, DEFAULT_SPECTRUM_SETTINGS.sensitivity),
        decay: clampNumber(source.decay, 0.75, 0.98, DEFAULT_SPECTRUM_SETTINGS.decay),
        backgroundColor: /^#[0-9a-f]{6}$/i.test(source.backgroundColor)
            ? source.backgroundColor : DEFAULT_SPECTRUM_SETTINGS.backgroundColor,
        barColorStart: /^#[0-9a-f]{6}$/i.test(source.barColorStart)
            ? source.barColorStart : DEFAULT_SPECTRUM_SETTINGS.barColorStart,
        barColorMid: /^#[0-9a-f]{6}$/i.test(source.barColorMid)
            ? source.barColorMid : DEFAULT_SPECTRUM_SETTINGS.barColorMid,
        barColorEnd: /^#[0-9a-f]{6}$/i.test(source.barColorEnd)
            ? source.barColorEnd : DEFAULT_SPECTRUM_SETTINGS.barColorEnd
    };
}

export function readSpectrumSettings(storage = window.localStorage) {
    try {
        const saved = storage.getItem(SPECTRUM_SETTINGS_STORAGE_KEY);
        return saved
            ? normalizeSpectrumSettings(JSON.parse(saved))
            : normalizeSpectrumSettings(DEFAULT_SPECTRUM_SETTINGS);
    } catch {
        return normalizeSpectrumSettings(DEFAULT_SPECTRUM_SETTINGS);
    }
}

export function writeSpectrumSettings(value, storage = window.localStorage) {
    const settings = normalizeSpectrumSettings(value);
    storage.setItem(SPECTRUM_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return settings;
}
