import { getFooSdk } from '../../services/fooSdk.js';

export const PLAYBACK_ORDER_NAMES = Object.freeze([
    'default',
    'repeat-playlist',
    'repeat-track',
    'random',
    'shuffle-tracks',
    'shuffle-albums',
    'shuffle-folders'
]);

const SNAPSHOT_FIELDS = Object.freeze([
    'playbackState',
    'currentTrack',
    'order',
    'stopAfterCurrent',
    'volume'
]);

function createInitialState() {
    return {
        connectionState: 'disconnected',
        available: false,
        initialized: false,
        playbackState: 'stopped',
        currentTrack: null,
        currentTrackPath: '',
        order: {
            index: 0,
            name: 'default'
        },
        orderKnown: false,
        stopAfterCurrent: false,
        stopAfterCurrentKnown: false,
        volume: null,
        volumeDb: null,
        muted: false,
        volumeKnown: false,
        pendingActions: [],
        readErrors: [],
        lastError: ''
    };
}

function cloneState(state) {
    return {
        ...state,
        currentTrack: state.currentTrack ? { ...state.currentTrack } : null,
        order: { ...state.order },
        pendingActions: [...state.pendingActions],
        readErrors: [...state.readErrors]
    };
}

function toError(value, fallback) {
    if (value instanceof Error) return value;
    const message = value && typeof value === 'object'
        ? value.error || value.message
        : value;
    return new Error(String(message || fallback || 'Error desconocido de reproducción.'));
}

function assertSuccess(response, operation) {
    if (response?.success === false) {
        const error = toError(response.error, 'Falló ' + operation + '.');
        if (response.code) error.code = response.code;
        throw error;
    }
    return response || {};
}

function normalizePlaybackState(value) {
    if (value === 'playing' || value === 'paused' || value === 'stopped' || value === 'opening') {
        return value;
    }
    return 'stopped';
}

function getTrackFromResponse(response) {
    return response?.found === true && response.track && typeof response.track === 'object'
        ? response.track
        : null;
}

function getTrackPath(track) {
    return String(track?.absolutePath || track?.path || '');
}

const PLAYBACK_ORDER_NAMES_BY_INDEX = PLAYBACK_ORDER_NAMES;

function normalizeOrder(response, fallbackName) {
    const rawOrder = response?.order;
    const indexValue = response?.orderIndex
        ?? (typeof rawOrder === 'number' ? rawOrder : null);
    const hasIndex = indexValue !== null && indexValue !== undefined && indexValue !== '';
    const numericIndex = hasIndex && Number.isInteger(Number(indexValue))
        ? Number(indexValue)
        : null;
    const indexedName = numericIndex !== null
        ? PLAYBACK_ORDER_NAMES_BY_INDEX[numericIndex] || ''
        : '';
    const name = String(
        response?.orderName
        || response?.name
        || (typeof rawOrder === 'string' ? rawOrder : '')
        || indexedName
        || fallbackName
        || 'default'
    );
    const index = numericIndex !== null
        ? numericIndex
        : PLAYBACK_ORDER_NAMES_BY_INDEX.indexOf(name);

    return { index: index >= 0 ? index : null, name };
}

function normalizeVolume(response, previousState) {
    const volumeValue = Number(response?.volume);
    const volumeDbValue = Number(response?.volumeDb);
    const hasVolume = response?.volume !== undefined
        && response?.volume !== null
        && Number.isFinite(volumeValue);
    const hasVolumeDb = response?.volumeDb !== undefined
        && response?.volumeDb !== null
        && Number.isFinite(volumeDbValue);
    const mutedValue = response?.muted ?? response?.isMuted;

    return {
        ...(hasVolume ? { volume: Math.max(0, Math.min(100, volumeValue)) } : {}),
        ...(hasVolumeDb ? { volumeDb: volumeDbValue } : {}),
        ...(typeof mutedValue === 'boolean' ? { muted: mutedValue } : {}),
        volumeKnown: hasVolume || hasVolumeDb || typeof mutedValue === 'boolean'
            ? true
            : previousState.volumeKnown
    };
}

function readMethod(sdk, method) {
    const fn = sdk?.player?.[method];
    if (typeof fn !== 'function') {
        throw new Error('foo-webview-sdk no expone fb.player.' + method + '().');
    }
    return fn.bind(sdk.player);
}

/**
 * Owns the single playback snapshot and routes all native playback commands.
 * The controller is deliberately independent from React so its behavior can be
 * tested without a WebView2 host.
 */
export function createPlaybackController({
    getSdk = getFooSdk
} = {}) {
    let state = createInitialState();
    let activeSdk = null;
    let started = false;
    let startReferences = 0;
    let generation = 0;
    let eventRevisions = Object.fromEntries(SNAPSHOT_FIELDS.map((field) => [field, 0]));
    const listeners = new Set();
    const unsubscribers = [];
    const pendingActionCounts = new Map();

    function publish(patch) {
        state = { ...state, ...patch };
        const snapshot = cloneState(state);
        listeners.forEach((listener) => {
            try {
                listener(snapshot);
            } catch (error) {
                console.error('[Playback Controller] Subscriber failed.', error);
            }
        });
        return snapshot;
    }

    function getState() {
        return cloneState(state);
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') {
            throw new TypeError('El suscriptor de Playback Controller debe ser una función.');
        }
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    function markEvent(field, patch) {
        eventRevisions[field] += 1;
        publish(patch);
    }

    function subscribeEvent(sdk, eventName, handler) {
        if (typeof sdk?.on !== 'function') {
            throw new Error('foo-webview-sdk no expone fb.on() para suscribirse a eventos.');
        }
        const unsubscribe = sdk.on(eventName, handler);
        if (typeof unsubscribe === 'function') {
            unsubscribers.push(unsubscribe);
            return;
        }
        if (typeof sdk.off === 'function') {
            const cleanup = () => sdk.off(eventName, handler);
            unsubscribers.push(cleanup);
            return;
        }
        throw new Error('No se pudo registrar la limpieza del evento ' + eventName + '.');
    }

    function installEventSubscriptions(sdk) {
        subscribeEvent(sdk, 'playback:stateChanged', (payload = {}) => {
            const playbackState = normalizePlaybackState(payload.state);
            markEvent('playbackState', { playbackState });
        });

        subscribeEvent(sdk, 'playback:paused', (payload = {}) => {
            if (typeof payload.paused !== 'boolean') return;
            markEvent('playbackState', {
                playbackState: payload.paused ? 'paused' : 'playing'
            });
        });

        subscribeEvent(sdk, 'playback:stopped', () => {
            markEvent('playbackState', { playbackState: 'stopped' });
        });

        subscribeEvent(sdk, 'playback:starting', (payload = {}) => {
            markEvent('playbackState', {
                playbackState: payload.paused === true ? 'paused' : 'opening'
            });
        });

        subscribeEvent(sdk, 'playback:trackChanged', (payload = {}) => {
            const track = payload.track && typeof payload.track === 'object'
                ? payload.track
                : payload.currentTrack && typeof payload.currentTrack === 'object'
                    ? payload.currentTrack
                    : payload;
            const currentTrack = track && typeof track === 'object' ? { ...track } : null;
            markEvent('currentTrack', {
                currentTrack,
                currentTrackPath: getTrackPath(currentTrack)
            });
        });

        subscribeEvent(sdk, 'playback:volumeChanged', (payload = {}) => {
            markEvent('volume', normalizeVolume(payload, state));
        });

        subscribeEvent(sdk, 'playback:orderChanged', (payload = {}) => {
            const order = normalizeOrder({
                order: payload.order,
                orderIndex: payload.orderIndex,
                orderName: payload.orderName,
                name: payload.name
            });
            markEvent('order', { order, orderKnown: true });
        });

        subscribeEvent(sdk, 'playback:stopAfterCurrentChanged', (payload = {}) => {
            if (typeof payload.enabled !== 'boolean') return;
            markEvent('stopAfterCurrent', {
                stopAfterCurrent: payload.enabled,
                stopAfterCurrentKnown: true
            });
        });
    }

    async function readInitialSnapshot(expectedGeneration, sdk) {
        const snapshotRevision = { ...eventRevisions };
        const reads = [
            ['playbackState', 'getState'],
            ['currentTrack', 'getCurrentTrack'],
            ['order', 'getOrder'],
            ['stopAfterCurrent', 'getStopAfterCurrent'],
            ['volume', 'getVolume']
        ];

        const results = await Promise.allSettled(
            reads.map(([, method]) => Promise.resolve().then(() => readMethod(sdk, method)()))
        );

        if (!started || expectedGeneration !== generation) return;

        const readErrors = [];
        const patch = {};

        results.forEach((result, index) => {
            const [field, method] = reads[index];
            if (snapshotRevision[field] !== eventRevisions[field]) return;

            if (result.status === 'rejected') {
                readErrors.push(method + ': ' + toError(result.reason).message);
                return;
            }

            try {
                const response = assertSuccess(result.value, method);
                switch (field) {
                    case 'playbackState':
                        patch.playbackState = normalizePlaybackState(response.state);
                        break;
                    case 'currentTrack': {
                        const currentTrack = getTrackFromResponse(response);
                        patch.currentTrack = currentTrack;
                        patch.currentTrackPath = getTrackPath(currentTrack);
                        break;
                    }
                    case 'order':
                        patch.order = normalizeOrder(response);
                        patch.orderKnown = true;
                        break;
                    case 'stopAfterCurrent':
                        if (typeof response.enabled !== 'boolean') {
                            throw new Error('La respuesta no contiene el estado enabled.');
                        }
                        patch.stopAfterCurrent = response.enabled;
                        patch.stopAfterCurrentKnown = true;
                        break;
                    case 'volume':
                        Object.assign(patch, normalizeVolume(response, state));
                        break;
                    default:
                        break;
                }
            } catch (error) {
                readErrors.push(method + ': ' + toError(error).message);
            }
        });

        publish({
            ...patch,
            initialized: true,
            connectionState: readErrors.length ? 'degraded' : 'ready',
            readErrors,
            lastError: readErrors[0] || ''
        });
    }

    function releaseSubscriptions() {
        while (unsubscribers.length) {
            try {
                unsubscribers.pop()?.();
            } catch (error) {
                console.error('[Playback Controller] Could not remove an event listener.', error);
            }
        }
    }

    function stop() {
        startReferences = 0;
        generation += 1;
        started = false;
        activeSdk = null;
        releaseSubscriptions();
        publish({
            connectionState: 'disconnected',
            available: false,
            initialized: false
        });
    }

    function start() {
        startReferences += 1;
        let released = false;

        const release = () => {
            if (released) return;
            released = true;
            startReferences = Math.max(0, startReferences - 1);
            if (startReferences === 0) stop();
        };

        if (started) return release;

        const currentGeneration = ++generation;
        try {
            const sdk = getSdk();
            if (!sdk?.player || typeof sdk.on !== 'function') {
                throw new Error('El SDK no expone fb.player y fb.on.');
            }
            activeSdk = sdk;
            started = true;
            eventRevisions = Object.fromEntries(SNAPSHOT_FIELDS.map((field) => [field, 0]));
            publish({
                connectionState: 'connecting',
                available: true,
                initialized: false,
                readErrors: [],
                lastError: ''
            });
            installEventSubscriptions(sdk);
            void readInitialSnapshot(currentGeneration, sdk);
        } catch (error) {
            releaseSubscriptions();
            started = false;
            activeSdk = null;
            publish({
                connectionState: 'unavailable',
                available: false,
                initialized: false,
                lastError: toError(error).message
            });
        }

        return release;
    }

    async function runAction(actionId, method, args = [], onSuccess) {
        const count = (pendingActionCounts.get(actionId) || 0) + 1;
        pendingActionCounts.set(actionId, count);
        publish({
            pendingActions: Array.from(pendingActionCounts.keys()),
            lastError: ''
        });

        try {
            const sdk = activeSdk || getSdk();
            const invoke = readMethod(sdk, method);
            const response = assertSuccess(
                await invoke(...args),
                method
            );
            await onSuccess?.(response);
            return response;
        } catch (error) {
            const normalizedError = toError(error, 'No se pudo ejecutar ' + method + '().');
            publish({ lastError: normalizedError.message });
            throw normalizedError;
        } finally {
            const remaining = (pendingActionCounts.get(actionId) || 1) - 1;
            if (remaining > 0) pendingActionCounts.set(actionId, remaining);
            else pendingActionCounts.delete(actionId);
            publish({ pendingActions: Array.from(pendingActionCounts.keys()) });
        }
    }

    async function refreshVolumeSnapshot(response) {
        const hasVolumeData = response && (
            response.volume !== undefined
            || response.volumeDb !== undefined
            || typeof response.muted === 'boolean'
            || typeof response.isMuted === 'boolean'
        );
        if (hasVolumeData) {
            markEvent('volume', normalizeVolume(response, state));
            return;
        }

        try {
            const sdk = activeSdk || getSdk();
            const currentVolume = assertSuccess(
                await readMethod(sdk, 'getVolume')(),
                'getVolume'
            );
            markEvent('volume', normalizeVolume(currentVolume, state));
        } catch (error) {
            // The transport action already succeeded. A failed follow-up read
            // must not turn the volume button into a failed command.
            publish({ readErrors: [...state.readErrors, 'getVolume: ' + toError(error).message] });
        }
    }

    const actions = Object.freeze({
        play: () => runAction('play', 'play', [], () => {
            markEvent('playbackState', {
                playbackState: state.playbackState === 'stopped' ? 'opening' : 'playing'
            });
        }),
        pause: () => runAction('pause', 'pause', [], () => {
            markEvent('playbackState', { playbackState: 'paused' });
        }),
        playPause: () => runAction('playPause', 'playPause', [], (response) => {
            markEvent('playbackState', {
                playbackState: response.state
                    ? normalizePlaybackState(response.state)
                    : response.isPlaying === true
                        ? 'playing'
                        : 'paused'
            });
        }),
        previous: () => runAction('previous', 'prev'),
        stopPlayback: () => runAction('stop', 'stop', [], () => {
            markEvent('playbackState', { playbackState: 'stopped' });
        }),
        next: () => runAction('next', 'next'),
        playRandom: () => runAction('playRandom', 'random'),
        setPlaybackOrder: (order) => {
            const value = typeof order === 'number'
                ? PLAYBACK_ORDER_NAMES[order]
                : String(order || '').trim();
            const index = PLAYBACK_ORDER_NAMES.indexOf(value);
            if (index < 0) {
                return Promise.reject(new TypeError('Playback Order no admitido: ' + order));
            }
            return runAction('setPlaybackOrder', 'setOrder', [index], (response) => {
                markEvent('order', {
                    order: normalizeOrder(response, value),
                    orderKnown: true
                });
            });
        },
        setStopAfterCurrent: (enabled) => runAction(
            'setStopAfterCurrent',
            'setStopAfterCurrent',
            [Boolean(enabled)],
            (response) => {
                markEvent('stopAfterCurrent', {
                    stopAfterCurrent: typeof response.enabled === 'boolean'
                        ? response.enabled
                        : Boolean(enabled),
                    stopAfterCurrentKnown: true
                });
            }
        ),
        toggleStopAfterCurrent: () => runAction(
            'toggleStopAfterCurrent',
            'toggleStopAfterCurrent',
            [],
            (response) => {
                if (typeof response.enabled === 'boolean') {
                    markEvent('stopAfterCurrent', {
                        stopAfterCurrent: response.enabled,
                        stopAfterCurrentKnown: true
                    });
                }
            }
        ),
        setVolume: (volume) => {
            const value = Number(volume);
            if (!Number.isFinite(value)) {
                return Promise.reject(new TypeError('El volumen debe ser un número.'));
            }
            const clamped = Math.max(0, Math.min(100, value));
            return runAction('setVolume', 'setVolume', [clamped], (response) => {
                markEvent('volume', normalizeVolume(response, state));
            });
        },
        setMuted: (muted = true) => runAction(
            'setMuted',
            'mute',
            [Boolean(muted)],
            (response) => {
                const value = response.muted ?? response.isMuted;
                if (typeof value === 'boolean') {
                    markEvent('volume', { muted: value, volumeKnown: true });
                }
            }
        ),
        toggleMute: () => runAction('toggleMute', 'toggleMute', [], (response) => {
            const value = response.muted ?? response.isMuted;
            if (typeof value === 'boolean') {
                markEvent('volume', { muted: value, volumeKnown: true });
            }
        }),
        volumeUp: () => runAction('volumeUp', 'volumeUp', [], async (response) => {
            await refreshVolumeSnapshot(response);
        }),
        volumeDown: () => runAction('volumeDown', 'volumeDown', [], async (response) => {
            await refreshVolumeSnapshot(response);
        })
    });

    async function refresh() {
        if (!started) {
            return { success: false, error: 'Playback Controller no está iniciado.' };
        }
        const sdk = activeSdk || getSdk();
        const currentGeneration = generation;
        await readInitialSnapshot(currentGeneration, sdk);
        return { success: true, state: getState() };
    }

    return Object.freeze({
        start,
        stop,
        refresh,
        getState,
        subscribe,
        ...actions
    });
}

export const playbackController = createPlaybackController();

export function startPlaybackController() {
    return playbackController.start();
}

export function getPlaybackControllerState() {
    return playbackController.getState();
}

export function subscribePlaybackControllerState(listener) {
    return playbackController.subscribe(listener);
}
