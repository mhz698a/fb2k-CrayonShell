import { useEffect, useMemo, useRef, useState } from 'react';
import { getDspAutoPresetState, subscribeDspAutoPresetState } from '../features/dspAutoPreset/dspAutoActivationController.js';
import { formatTrackDuration, getSelectedTrackStats } from '../utils/playlistStatus.js';

const STATUS_VISIBILITY_KEY = 'crayonshell.statusbar.visibility.v1';
const STATUS_ITEMS = [
    { id: 'message', label: 'Mensaje operativo' },
    { id: 'playbackState', label: 'Estado de reproducción' },
    { id: 'selectionCount', label: 'Cantidad de elementos seleccionados' },
    { id: 'selectionDuration', label: 'Duración total seleccionada' },
    { id: 'playlistTrackCount', label: 'Cantidad de pistas de la playlist' },
    { id: 'playlistCount', label: 'Cantidad de playlists' },
    { id: 'playlistName', label: 'Playlist actual' },
    { id: 'playerConnection', label: 'Conexión con foobar2000' },
    { id: 'dspPreset', label: 'DSP Preset activo' }
];
const DEFAULT_VISIBILITY = Object.freeze(Object.fromEntries(STATUS_ITEMS.map((item) => [item.id, true])));
const DSP_SOURCE_LABELS = { default: 'predeterminado', folder: 'carpeta', track: 'canción' };

function readStatusVisibility() {
    try {
        const stored = JSON.parse(window.localStorage.getItem(STATUS_VISIBILITY_KEY) || 'null');
        if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return { ...DEFAULT_VISIBILITY };
        return Object.fromEntries(STATUS_ITEMS.map((item) => [item.id, stored[item.id] !== false]));
    } catch { return { ...DEFAULT_VISIBILITY }; }
}
function getDspStatusPresentation(state) {
    const presetName = state.targetPreset || state.activePreset || '';
    switch (state.status) {
        case 'queued': return { label: 'DSP · En cola' + (presetName ? ': ' + presetName : ''), title: 'Esperando para aplicar el DSP Preset' + (presetName ? ': ' + presetName : ''), variant: 'is-queued' };
        case 'applying': return { label: 'DSP · Aplicando' + (presetName ? ': ' + presetName : ''), title: 'Aplicando DSP Preset' + (presetName ? ': ' + presetName : ''), variant: 'is-applying' };
        case 'verifying': return { label: 'DSP · Verificando' + (presetName ? ': ' + presetName : ''), title: 'Verificando el DSP Preset' + (presetName ? ': ' + presetName : ''), variant: 'is-verifying' };
        case 'error': return { label: 'DSP · Error', title: state.error || 'No se pudo aplicar el DSP Preset.', variant: 'is-error' };
        case 'active': {
            const name = state.activePreset || state.targetPreset || 'Activo';
            const source = DSP_SOURCE_LABELS[state.activationSource];
            return { label: 'DSP · ' + name + (source ? ' · ' + source : ''), title: 'DSP Preset activo: ' + name + (source ? ' (origen: ' + source + ')' : ''), variant: 'is-active' };
        }
        default: return { label: 'DSP · ' + (state.activePreset || 'Sin preset'), title: state.activePreset ? 'DSP Preset activo: ' + state.activePreset : 'No hay un DSP Preset activo.', variant: 'is-idle' };
    }
}
function getPlaybackStatePresentation(state) {
    switch (state) {
        case 'playing': return { icon: 'fa-play', label: 'Reproduciendo' };
        case 'paused': return { icon: 'fa-pause', label: 'Pausado' };
        case 'opening': return { icon: 'fa-spinner fa-spin', label: 'Abriendo' };
        default: return { icon: 'fa-stop', label: 'Detenido' };
    }
}
function getPlayerStatusPresentation(controller = {}) {
    const labels = { disconnected: 'Desconectado', connecting: 'Conectando', ready: 'Conectado', degraded: 'Conexión parcial', unavailable: 'No disponible' };
    const connection = controller.connectionState || 'disconnected';
    const label = labels[connection] || 'Estado desconocido';
    return {
        label: 'Player · ' + label,
        title: controller.lastError || ('Conexión de reproducción: ' + label),
        variant: connection === 'ready' ? 'is-ready' : connection === 'connecting' ? 'is-connecting' : connection === 'degraded' ? 'is-degraded' : connection === 'unavailable' ? 'is-error' : 'is-disconnected'
    };
}
const FaIcon = ({ name }) => <i className={'fa ' + name} aria-hidden="true" />;

export default function StatusBar({ message, playbackController, playlists = [], activePlaylist = null, items = [], selectedIndices = [] }) {
    const [dspState, setDspState] = useState(() => getDspAutoPresetState());
    const [visibility, setVisibility] = useState(readStatusVisibility);
    const [contextMenu, setContextMenu] = useState(null);
    const menuRef = useRef(null);

    useEffect(() => {
        const unsubscribe = subscribeDspAutoPresetState(setDspState);
        setDspState(getDspAutoPresetState());
        return unsubscribe;
    }, []);
    useEffect(() => {
        try { window.localStorage.setItem(STATUS_VISIBILITY_KEY, JSON.stringify(visibility)); } catch {}
    }, [visibility]);
    useEffect(() => {
        if (!contextMenu) return undefined;
        const closeOutside = (event) => { if (!menuRef.current?.contains(event.target)) setContextMenu(null); };
        const closeEscape = (event) => { if (event.key === 'Escape') setContextMenu(null); };
        document.addEventListener('pointerdown', closeOutside);
        document.addEventListener('keydown', closeEscape);
        return () => {
            document.removeEventListener('pointerdown', closeOutside);
            document.removeEventListener('keydown', closeEscape);
        };
    }, [contextMenu]);

    const selectedStats = useMemo(() => getSelectedTrackStats(items, selectedIndices), [items, selectedIndices]);
    const dsp = getDspStatusPresentation(dspState);
    const player = getPlayerStatusPresentation(playbackController);
    const playback = getPlaybackStatePresentation(playbackController?.playbackState);
    const openMenu = (event) => {
        event.preventDefault();
        const width = 270, height = 360;
        const pointerX = Number.isFinite(event.clientX) ? event.clientX : window.innerWidth - width - 12;
        const pointerY = Number.isFinite(event.clientY) ? event.clientY : window.innerHeight - height - 12;
        setContextMenu({
            left: Math.max(8, Math.min(pointerX, window.innerWidth - width - 8)),
            top: Math.max(8, Math.min(pointerY, window.innerHeight - height - 8))
        });
    };
    const toggle = (id) => setVisibility((current) => ({ ...current, [id]: current[id] === false }));

    return (
        <footer id="StatusBar" className="status-bar" aria-label="Status Bar" tabIndex={0}
            onContextMenu={openMenu}
            onKeyDown={(event) => {
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openMenu(event);
            }}>
            {visibility.message && <span className="statusbar-item statusbar-message" title={message}>
                <FaIcon name="fa-info-circle" /><span>{message || 'Listo'}</span>
            </span>}
            {visibility.playbackState && <span className="statusbar-item statusbar-playback-state" title={playback.label} aria-label={playback.label}>
                <FaIcon name={playback.icon} />
            </span>}
            {visibility.selectionCount && <span className="statusbar-item" title="Elementos seleccionados">
                <FaIcon name="fa-check-square-o" /><span>{selectedStats.count} seleccionados</span>
            </span>}
            {visibility.selectionDuration && <span className="statusbar-item" title="Duración total seleccionada">
                <FaIcon name="fa-clock-o" /><span>{formatTrackDuration(selectedStats.durationSeconds)}</span>
            </span>}
            {visibility.playlistTrackCount && <span className="statusbar-item" title="Elementos de la playlist actual">
                <FaIcon name="fa-list-ol" /><span>{items.length} pistas</span>
            </span>}
            {visibility.playlistCount && <span className="statusbar-item" title="Playlists disponibles">
                <FaIcon name="fa-files-o" /><span>{playlists.length} playlists</span>
            </span>}
            {visibility.playlistName && <span className="statusbar-item statusbar-playlist-name" title={activePlaylist?.name || 'Sin playlist activa'}>
                <FaIcon name="fa-music" /><span>{activePlaylist?.name || 'Sin playlist activa'}</span>
            </span>}
            {visibility.playerConnection && <span className={'statusbar-item statusbar-player-connection ' + player.variant} title={player.title}>
                <FaIcon name="fa-plug" /><span>{player.label}</span>
            </span>}
            {visibility.dspPreset && <span className={'statusbar-item statusbar-dsp ' + dsp.variant} title={dsp.title}>
                <FaIcon name="fa-sliders" /><span>{dsp.label}</span>
            </span>}
            {contextMenu && <div ref={menuRef} className="statusbar-context-menu" role="menu"
                aria-label="Mostrar u ocultar estados de la Status Bar"
                style={{ left: contextMenu.left + 'px', top: contextMenu.top + 'px' }}>
                <div className="statusbar-context-menu-heading">Estados visibles</div>
                {STATUS_ITEMS.map((item) => <button key={item.id} type="button" role="menuitemcheckbox"
                    aria-checked={visibility[item.id] !== false} className="statusbar-context-menu-item"
                    onClick={() => toggle(item.id)}>
                    <FaIcon name={visibility[item.id] !== false ? 'fa-check-square-o' : 'fa-square-o'} />
                    <span>{item.label}</span>
                </button>)}
            </div>}
        </footer>
    );
}
