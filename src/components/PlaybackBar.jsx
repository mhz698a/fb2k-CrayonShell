import { useCallback, useEffect, useRef, useState } from 'react';
import { PLAYBACK_ORDER_NAMES } from '../features/playback/playbackController.js';

const PLAYBACK_ORDER_LABELS = Object.freeze({
    default: 'Predeterminado',
    'repeat-playlist': 'Repetir playlist',
    'repeat-track': 'Repetir canción',
    random: 'Aleatorio',
    'shuffle-tracks': 'Mezclar pistas',
    'shuffle-albums': 'Mezclar álbumes',
    'shuffle-folders': 'Mezclar carpetas'
});
const PLAYBACK_ORDERS = PLAYBACK_ORDER_NAMES.map((value) => ({
    value,
    label: PLAYBACK_ORDER_LABELS[value]
}));
const FaIcon = ({ name }) => <i className={'fa ' + name} aria-hidden="true" />;
function runAction(action) {
    if (typeof action !== 'function') return;
    Promise.resolve().then(action).catch(() => {});
}

export default function PlaybackBar({ controller, hasCurrentTrack = false, onFocusPlayingTrack }) {
    const [volumeDraft, setVolumeDraft] = useState(null);
    const [volumeInteractionActive, setVolumeInteractionActive] = useState(false);
    const volumeInteractionRef = useRef(false);
    const volumeDraftRef = useRef(null);
    const pendingVolumeRef = useRef(null);
    const volumeTimerRef = useRef(null);
    const volumeQueueRef = useRef(Promise.resolve());
    const state = controller || {};
    const actions = state.actions || {};
    const available = Boolean(state.available);
    const pending = new Set(state.pendingActions || []);
    const isPending = (id) => pending.has(id);
    const order = PLAYBACK_ORDERS.some((item) => item.value === state.order?.name) ? state.order.name : 'default';
    const volume = volumeDraft ?? (Number.isFinite(Number(state.volume)) ? Number(state.volume) : 0);
    const volumeKnown = Boolean(state.volumeKnown);
    const isPlaying = state.playbackState === 'playing' || state.playbackState === 'opening';
    const playPauseLabel = isPlaying ? 'Pausar' : 'Reproducir';
    const stopAfterCurrent = Boolean(state.stopAfterCurrent);

    const flushVolume = useCallback(() => {
        if (volumeTimerRef.current !== null) {
            window.clearTimeout(volumeTimerRef.current);
            volumeTimerRef.current = null;
        }
        const nextVolume = pendingVolumeRef.current;
        if (nextVolume === null) return;
        pendingVolumeRef.current = null;
        const operation = volumeQueueRef.current.catch(() => {}).then(() => actions.setVolume?.(nextVolume));
        volumeQueueRef.current = operation.catch(() => {});
        operation.then(() => {
            if (!volumeInteractionRef.current && pendingVolumeRef.current === null && volumeDraftRef.current === nextVolume) {
                volumeDraftRef.current = null;
                setVolumeDraft(null);
            }
        }).catch(() => {});
    }, [actions.setVolume]);

    const scheduleVolume = useCallback((rawValue) => {
        const value = Math.max(0, Math.min(100, Number(rawValue) || 0));
        volumeInteractionRef.current = true;
        setVolumeInteractionActive(true);
        volumeDraftRef.current = value;
        pendingVolumeRef.current = value;
        setVolumeDraft(value);
        if (volumeTimerRef.current === null) volumeTimerRef.current = window.setTimeout(flushVolume, 45);
    }, [flushVolume]);

    const finishVolumeChange = useCallback(() => {
        volumeInteractionRef.current = false;
        setVolumeInteractionActive(false);
        flushVolume();
        volumeQueueRef.current.catch(() => {}).then(() => {
            if (!volumeInteractionRef.current && pendingVolumeRef.current === null) {
                volumeDraftRef.current = null;
                setVolumeDraft(null);
            }
        });
    }, [flushVolume]);

    useEffect(() => () => {
        if (volumeTimerRef.current !== null) window.clearTimeout(volumeTimerRef.current);
        if (pendingVolumeRef.current !== null) {
            const finalVolume = pendingVolumeRef.current;
            pendingVolumeRef.current = null;
            volumeQueueRef.current = volumeQueueRef.current
                .catch(() => {})
                .then(() => actions.setVolume?.(finalVolume))
                .catch(() => {});
        }
    }, [actions.setVolume]);

    const disabled = !available;
    return (
        <section className="playback-bar" aria-label="Playback Bar">
            <div className="playback-bar-transport" role="group" aria-label="Controles de transporte">
                <button className="playback-control playback-control-primary" type="button"
                    aria-label={playPauseLabel} title={playPauseLabel}
                    disabled={disabled || isPending('playPause')}
                    onClick={() => runAction(actions.playPause)}>
                    <FaIcon name={state.playbackState === 'opening' ? 'fa-spinner fa-spin' : isPlaying ? 'fa-pause' : 'fa-play'} />
                </button>
                <button className="playback-control" type="button" aria-label="Pista anterior"
                    title="Pista anterior" disabled={disabled || isPending('previous')}
                    onClick={() => runAction(actions.previous)}>
                    <FaIcon name="fa-step-backward" />
                </button>
                <button className="playback-control" type="button" aria-label="Detener"
                    title="Detener" disabled={disabled || isPending('stop')}
                    onClick={() => runAction(actions.stopPlayback)}>
                    <FaIcon name="fa-stop" />
                </button>
                <button className="playback-control" type="button" aria-label="Pista siguiente"
                    title="Pista siguiente" disabled={disabled || isPending('next')}
                    onClick={() => runAction(actions.next)}>
                    <FaIcon name="fa-step-forward" />
                </button>
                <button className="playback-control" type="button" aria-label="Reproducir aleatoriamente"
                    title="Reproducir aleatoriamente" disabled={disabled || isPending('playRandom')}
                    onClick={() => runAction(actions.playRandom)}>
                    <FaIcon name="fa-question" />
                </button>
                <button className={'playback-control playback-control-toggle' + (stopAfterCurrent ? ' is-active' : '')}
                    type="button" aria-label="Detener después de la canción actual" aria-pressed={stopAfterCurrent}
                    title={stopAfterCurrent ? 'Desactivar Detener después de la canción actual' : 'Detener después de la canción actual'}
                    disabled={disabled || !state.stopAfterCurrentKnown || isPending('setStopAfterCurrent')}
                    onClick={() => runAction(() => actions.setStopAfterCurrent?.(!stopAfterCurrent))}>
                    <FaIcon name="fa-stop-circle" />
                </button>
                <button className="playback-control playback-control-toggle" type="button"
                    aria-label="Active Now Playing" title="Seleccionar y enfocar la canción en reproducción"
                    disabled={disabled || !hasCurrentTrack} onClick={() => runAction(onFocusPlayingTrack)}>
                    <FaIcon name="fa-crosshairs" />
                </button>
                <label className="playback-order-control">
                    <span>Playback Order</span>
                    <select aria-label="Playback Order" value={order}
                        disabled={disabled || !state.orderKnown || isPending('setPlaybackOrder')}
                        onChange={(event) => runAction(() => actions.setPlaybackOrder?.(event.target.value))}>
                        {PLAYBACK_ORDERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                </label>
            </div>
            <div className="playback-bar-volume" role="group" aria-label="Control de volumen">
                <button className="playback-control playback-volume-step" type="button"
                    aria-label="Bajar volumen" title="Bajar volumen"
                    disabled={disabled || !volumeKnown || isPending('volumeDown')}
                    onClick={() => runAction(actions.volumeDown)}>
                    <FaIcon name="fa-volume-down" />
                </button>
                <label className="playback-volume-slider">
                    <span className="sr-only">Volumen</span>
                    <span className="playback-volume-range">
                        <input type="range" min="0" max="100" step="1" aria-label="Volumen"
                            aria-valuetext={Math.round(volume) + '%'} value={volume}
                            disabled={disabled || !volumeKnown}
                            onChange={(event) => scheduleVolume(event.target.value)}
                            onPointerDown={() => { volumeInteractionRef.current = true; setVolumeInteractionActive(true); }}
                            onPointerUp={finishVolumeChange} onPointerCancel={finishVolumeChange}
                            onKeyDown={() => { volumeInteractionRef.current = true; setVolumeInteractionActive(true); }}
                            onKeyUp={finishVolumeChange} onBlur={finishVolumeChange} />
                        {volumeInteractionActive && <output className="playback-volume-tooltip"
                            style={{ left: Math.max(8, Math.min(92, volume)) + '%' }} aria-hidden="true">
                            {Math.round(volume)}%
                        </output>}
                    </span>
                </label>
                <button className="playback-control playback-volume-step" type="button"
                    aria-label="Subir volumen" title="Subir volumen"
                    disabled={disabled || !volumeKnown || isPending('volumeUp')}
                    onClick={() => runAction(actions.volumeUp)}>
                    <FaIcon name="fa-volume-up" />
                </button>
                <button className={'playback-control playback-volume-mute' + (state.muted ? ' is-muted' : '')} type="button"
                    aria-label={state.muted ? 'Activar sonido' : 'Silenciar'}
                    aria-pressed={Boolean(state.muted)}
                    title={state.muted ? 'Activar sonido' : 'Silenciar'}
                    disabled={disabled || !volumeKnown || isPending('toggleMute')}
                    onClick={() => runAction(actions.toggleMute)}>
                    <FaIcon name={state.muted || Number(state.volume) === 0 ? 'fa-volume-off' : 'fa-volume-up'} />
                </button>
            </div>
        </section>
    );
}
