import { useEffect, useState } from 'react';
import {
    getDspAutoPresetState,
    subscribeDspAutoPresetState
} from '../features/dspAutoPreset/dspAutoActivationController.js';

const DSP_SOURCE_LABELS = {
    default: 'predeterminado',
    folder: 'carpeta',
    track: 'canción'
};

function getDspStatusPresentation(state) {
    const presetName = state.targetPreset || state.activePreset || '';

    switch (state.status) {
        case 'queued':
            return {
                label: 'DSP · En cola' + (presetName ? ': ' + presetName : ''),
                title: 'Esperando para aplicar el DSP Preset' + (presetName ? ': ' + presetName : ''),
                variant: 'is-queued'
            };
        case 'applying':
            return {
                label: 'DSP · Aplicando' + (presetName ? ': ' + presetName : ''),
                title: 'Aplicando DSP Preset' + (presetName ? ': ' + presetName : ''),
                variant: 'is-applying'
            };
        case 'verifying':
            return {
                label: 'DSP · Verificando' + (presetName ? ': ' + presetName : ''),
                title: 'Verificando el DSP Preset' + (presetName ? ': ' + presetName : ''),
                variant: 'is-verifying'
            };
        case 'error':
            return {
                label: 'DSP · Error',
                title: state.error || 'No se pudo aplicar el DSP Preset.',
                variant: 'is-error'
            };
        case 'active': {
            const activePreset = state.activePreset || state.targetPreset || 'Activo';
            const sourceLabel = DSP_SOURCE_LABELS[state.activationSource];
            return {
                label: 'DSP · ' + activePreset + (sourceLabel ? ' · ' + sourceLabel : ''),
                title: 'DSP Preset activo: ' + activePreset
                    + (sourceLabel ? ' (origen: ' + sourceLabel + ')' : ''),
                variant: 'is-active'
            };
        }
        default:
            return {
                label: 'DSP · ' + (state.activePreset || 'Sin preset'),
                title: state.activePreset
                    ? 'DSP Preset activo: ' + state.activePreset
                    : 'No hay un DSP Preset activo.',
                variant: 'is-idle'
            };
    }
}

function getPlayerStatusPresentation(controller = {}) {
    const connectionLabels = {
        disconnected: 'Desconectado',
        connecting: 'Conectando',
        ready: 'Conectado',
        degraded: 'Conexión parcial',
        unavailable: 'No disponible'
    };
    const playbackLabels = {
        playing: 'Reproduciendo',
        paused: 'Pausado',
        stopped: 'Detenido',
        opening: 'Abriendo'
    };
    const connectionState = controller.connectionState || 'disconnected';
    const connectionLabel = connectionLabels[connectionState] || 'Estado desconocido';
    const playbackLabel = controller.initialized
        ? playbackLabels[controller.playbackState] || ''
        : '';

    return {
        label: 'Player · ' + connectionLabel + (playbackLabel ? ' · ' + playbackLabel : ''),
        title: controller.lastError || (
            'Conexión de reproducción: ' + connectionLabel
            + (playbackLabel ? '. Estado: ' + playbackLabel : '.')
        ),
        variant: connectionState === 'ready'
            ? 'is-ready'
            : connectionState === 'connecting'
                ? 'is-connecting'
                : connectionState === 'degraded'
                    ? 'is-degraded'
                    : connectionState === 'unavailable'
                        ? 'is-error'
                        : 'is-disconnected'
    };
}

export default function StatusBar({ message, playbackController }) {
    const [dspState, setDspState] = useState(() => getDspAutoPresetState());

    useEffect(() => {
        const unsubscribe = subscribeDspAutoPresetState(setDspState);
        setDspState(getDspAutoPresetState());
        return unsubscribe;
    }, []);

    const dspStatus = getDspStatusPresentation(dspState);
    const playerStatus = getPlayerStatusPresentation(playbackController);

    return (
        <footer id="StatusBar" className="status-bar" aria-live="polite">
            <span className="playlist-status-message" title={message}>
                {message}
            </span>
            <span
                className={'playlist-status-playback ' + playerStatus.variant}
                title={playerStatus.title}
            >
                {playerStatus.label}
            </span>
            <span
                className={'playlist-status-dsp ' + dspStatus.variant}
                title={dspStatus.title}
            >
                {dspStatus.label}
            </span>
        </footer>
    );
}
