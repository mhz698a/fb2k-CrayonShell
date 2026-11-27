import { registerActivityBarModule } from '../activitybar/actions/index.js';

export {
    createDspAutoActivationController,
    dspAutoActivationController,
    getDspAutoPresetState,
    subscribeDspAutoPresetState,
    startDspAutoActivationController,
    prepareDspPresetForTrack,
    syncDspAutoPresetTrack,
    cancelPreparedDspPresetTrack
} from './dspAutoActivationController.js';

export {
    DSP_AUTO_PRESET_SETTINGS_STORAGE_KEY,
    DSP_AUTO_PRESET_SETTINGS_VERSION,
    createDspAutoPresetRule,
    normalizeDspAutoPresetSettings,
    readDspAutoPresetSettings,
    writeDspAutoPresetSettings
} from './dspAutoPresetSettings.js';

export { resolveDspPresetForTrack } from './dspPresetResolver.js';

registerActivityBarModule({
    id: 'dsp-auto-preset',
    label: 'DSP Auto Presets',
    description: 'Administración y activación automática de DSP Presets.',
    register(actions) {
        return actions.register({
            id: 'dsp.autoPreset.manage',
            label: 'Administrar DSP Auto Presets',
            category: 'Audio',
            description: 'Configura presets predeterminados, reglas por carpeta y excepciones por canción.',
            defaultIcon: 'sliders',
            executionPolicy: 'single',
            isAvailable: (context) => ({
                available: typeof context?.openDspAutoPresetManager === 'function',
                reason: 'El administrador de DSP Auto Presets no está disponible.'
            }),
            isActive: (context) => context.dspAutoPresetManagerOpen === true,
            execute: (context) => context.openDspAutoPresetManager()
        });
    }
});
