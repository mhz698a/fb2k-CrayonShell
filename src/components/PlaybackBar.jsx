import { useRef, useState } from 'react';

const PLAYBACK_ORDERS = [
    { value: 'default', label: 'Predeterminado' },
    { value: 'repeat-playlist', label: 'Repetir playlist' },
    { value: 'repeat-track', label: 'Repetir canción' },
    { value: 'random', label: 'Aleatorio' }
];

function FaIcon({ name }) {
    return <i className={'fa fa-' + name} aria-hidden="true" />;
}

function runAction(action) {
    if (typeof action !== 'function') return;
    Promise.resolve().then(action).catch(() => {
        // The playback controller publishes the failure in its shared state.
    });
}

export default function PlaybackBar({
    controller,
    hasCurrentTrack = false,
    onFocusPlayingTrack
}) {
    const [volumeDraft, setVolumeDraft] = useState(null);
    const volumeDraftRef = useRef(null);

    const available = Boolean(controller?.available);
    const state = controller || {};
    const actions = state.actions || {};
    const pending = new Set(state.pendingActions || []);
    const isPending = (actionId) => pending.has(actionId);
    const order = PLAYBACK_ORDERS.some((item) => item.value === state.order?.name)
        ? state.order.name
        : 'default';
    const volume = volumeDraft ?? (
        Number.isFinite(Number(state.volume)) ? Number(state.volume) : 0
    );
    const volumeKnown = Boolean(state.volumeKnown);
    const isPlaying = state.playbackState === 'playing' || state.playbackState === 'opening';
    const playPauseLabel = isPlaying ? 'Pausar' : 'Reproducir';

    const updateVolumeDraft = (event) => {
        const nextVolume = Math.max(0, Math.min(100, Number(event.target.value) || 0));
        volumeDraftRef.current = nextVolume;
        setVolumeDraft(nextVolume);
    };

    const commitVolume = () => {
        if (volumeDraftRef.current === null) return;
        const nextVolume = volumeDraftRef.current;
        volumeDraftRef.current = null;
        setVolumeDraft(null);
        runAction(() => actions.setVolume?.(nextVolume));
    };

    const cancelVolume = () => {
        volumeDraftRef.current = null;
        setVolumeDraft(null);
    };

    const transportDisabled = !available;
    const stopAfterCurrent = Boolean(state.stopAfterCurrent);

    return (
        <section className="playback-bar" aria-label="Playback Bar">
            <div className="playback-bar-transport" role="group" aria-label="Controles de transporte">
                <button
                    className="playback-control playback-control-primary"
                    type="button"
                    aria-label={playPauseLabel}
                    title={playPauseLabel}
                    disabled={transportDisabled || isPending('playPause')}
                    aria-busy={isPending('playPause')}
                    onClick={() => runAction(actions.playPause)}
                >
                    <FaIcon name={state.playbackState === 'opening' ? 'spinner fa-spin' : isPlaying ? 'pause' : 'play'} />
                </button>
                <button
                    className="playback-control"
                    type="button"
                    aria-label="Pista anterior"
                    title="Pista anterior"
                    disabled={transportDisabled || isPending('previous')}
                    onClick={() => runAction(actions.previous)}
                >
                    <FaIcon name="step-backward" />
                </button>
                <button
                    className="playback-control"
                    type="button"
                    aria-label="Detener"
                    title="Detener"
                    disabled={transportDisabled || isPending('stop')}
                    onClick={() => runAction(actions.stopPlayback)}
                >
                    <FaIcon name="stop" />
                </button>
                <button
                    className="playback-control"
                    type="button"
                    aria-label="Pista siguiente"
                    title="Pista siguiente"
                    disabled={transportDisabled || isPending('next')}
                    onClick={() => runAction(actions.next)}
                >
                    <FaIcon name="step-forward" />
                </button>
                <button
                    className="playback-control"
                    type="button"
                    aria-label="Reproducir aleatoriamente"
                    title="Reproducir aleatoriamente"
                    disabled={transportDisabled || isPending('playRandom')}
                    onClick={() => runAction(actions.playRandom)}
                >
                    <FaIcon name="random" />
                </button>
                <button
                    className={'playback-control playback-control-wide'
                        + (stopAfterCurrent ? ' is-active' : '')}
                    type="button"
                    aria-label="Detener después de la canción actual"
                    aria-pressed={stopAfterCurrent}
                    title={stopAfterCurrent
                        ? 'Desactivar Detener después de la canción actual'
                        : 'Detener después de la canción actual'}
                    disabled={transportDisabled || !state.stopAfterCurrentKnown || isPending('setStopAfterCurrent')}
                    onClick={() => runAction(() => actions.setStopAfterCurrent?.(!stopAfterCurrent))}
                >
                    <FaIcon name="stop-circle" />
                    <span>Stop after current</span>
                </button>
                <button
                    className="playback-control playback-control-wide"
                    type="button"
                    aria-label="Active Now Playing"
                    title="Seleccionar y enfocar la canción en reproducción"
                    disabled={transportDisabled || !hasCurrentTrack}
                    onClick={() => runAction(onFocusPlayingTrack)}
                >
                    <FaIcon name="crosshairs" />
                    <span>Active Now Playing</span>
                </button>
                <label className="playback-order-control">
                    <span>Playback Order</span>
                    <select
                        aria-label="Playback Order"
                        value={order}
                        disabled={transportDisabled || !state.orderKnown || isPending('setPlaybackOrder')}
                        onChange={(event) => runAction(() => actions.setPlaybackOrder?.(event.target.value))}
                    >
                        {PLAYBACK_ORDERS.map((item) => (
                            <option key={item.value} value={item.value}>{item.label}</option>
                        ))}
                    </select>
                </label>
            </div>

            <div className="playback-bar-volume" role="group" aria-label="Control de volumen">
                <button
                    className="playback-control playback-volume-mute"
                    type="button"
                    aria-label={state.muted ? 'Activar sonido' : 'Silenciar'}
                    aria-pressed={Boolean(state.muted)}
                    title={state.muted ? 'Activar sonido' : 'Silenciar'}
                    disabled={transportDisabled || !volumeKnown || isPending('toggleMute')}
                    onClick={() => runAction(actions.toggleMute)}
                >
                    <FaIcon name={state.muted || Number(state.volume) === 0 ? 'volume-off' : 'volume-up'} />
                </button>
                <label className="playback-volume-slider">
                    <span className="sr-only">Volumen</span>
                    <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        aria-label="Volumen"
                        aria-valuetext={Math.round(volume) + '%'}
                        value={volume}
                        disabled={transportDisabled || !volumeKnown}
                        onChange={updateVolumeDraft}
                        onPointerUp={commitVolume}
                        onPointerCancel={cancelVolume}
                        onKeyUp={commitVolume}
                        onBlur={commitVolume}
                    />
                </label>
                <span className="playback-volume-value">{Math.round(volume)}%</span>
            </div>
        </section>
    );
}
