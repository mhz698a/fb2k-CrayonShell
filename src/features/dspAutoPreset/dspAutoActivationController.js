import { getFooSdk } from '../../services/fooSdk.js';
import {
    hasBridge,
    isDemoMode,
    subscribe
} from '../../services/foobarApi.js';
import { readDspAutoPresetSettings } from './dspAutoPresetSettings.js';
import { resolveDspPresetForTrack } from './dspPresetResolver.js';

export function normalizePlaybackPath(path) {
    return String(path || '').trim().replace(/\//g, '\\').replace(/\\+$/, '').toLocaleLowerCase('en-US');
}

export function createDspAutoActivationController({
    getSettings = readDspAutoPresetSettings,
    getSdk = getFooSdk,
    subscribeEvents = subscribe,
    isAvailable = () => !isDemoMode && hasBridge()
} = {}) {
    let state = {
        status: 'idle',
        activePreset: null,
        targetPreset: null,
        activationSource: null,
        trackPath: '',
        error: '',
        updatedAt: null
    };
    const listeners = new Set();
    const unsubscribers = [];
    let started = false;
    let requestSequence = 0;
    let pendingRequest = null;
    let worker = null;
    let lastTask = null;
    let expectedTrackPath = '';

    function publish(patch) {
        state = { ...state, ...patch, updatedAt: new Date().toISOString() };
        for (const listener of listeners) {
            try {
                listener({ ...state });
            } catch (error) {
                console.error('[DSP Auto Preset] Error notifying a state subscriber.', error);
            }
        }
        return { ...state };
    }

    function getState() {
        return { ...state };
    }

    function subscribeState(listener) {
        if (typeof listener !== 'function') {
            throw new TypeError('El suscriptor del estado DSP debe ser una función.');
        }
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    async function applyRequest(request) {
        const sdk = getSdk();
        if (!sdk?.dsp || typeof sdk.dsp.getChain !== 'function'
            || typeof sdk.dsp.applyPreset !== 'function') {
            throw new Error('El SDK no expone las operaciones necesarias para administrar DSP Presets.');
        }

        const current = await sdk.dsp.getChain();
        if (current?.success === false) {
            throw new Error(current.error || 'No se pudo consultar la cadena DSP activa.');
        }

        if (current.activePreset === request.presetName) {
            if (request.id === requestSequence) {
                publish({
                    status: 'active',
                    activePreset: request.presetName,
                    targetPreset: request.presetName,
                    activationSource: request.source,
                    trackPath: request.trackPath,
                    error: ''
                });
            }
            return { success: true, skipped: true, presetName: request.presetName };
        }

        if (request.id === requestSequence) {
            publish({
                status: 'applying',
                targetPreset: request.presetName,
                activationSource: request.source,
                trackPath: request.trackPath,
                error: ''
            });
        }

        const applied = await sdk.dsp.applyPreset(request.presetName);
        if (applied?.success === false) {
            throw new Error(applied.error || 'foobar2000 rechazó el DSP Preset solicitado.');
        }

        if (request.id === requestSequence) {
            publish({ status: 'verifying' });
        }

        const verified = await sdk.dsp.getChain();
        if (verified?.success === false) {
            throw new Error(verified.error || 'No se pudo verificar la cadena DSP después de aplicarla.');
        }
        if (verified.activePreset !== request.presetName) {
            throw new Error(
                'foobar2000 no confirmó el preset "' + request.presetName
                + '" como activo. El preset reportado es '
                + (verified.activePreset || 'ninguno') + '.'
            );
        }

        if (request.id === requestSequence) {
            publish({
                status: 'active',
                activePreset: verified.activePreset,
                targetPreset: request.presetName,
                activationSource: request.source,
                trackPath: request.trackPath,
                error: ''
            });
        }

        return { success: true, skipped: false, presetName: request.presetName };
    }

    function pumpQueue() {
        if (worker) return worker;

        worker = (async () => {
            while (pendingRequest) {
                const request = pendingRequest;
                pendingRequest = null;
                let result;

                try {
                    result = await applyRequest(request);
                } catch (error) {
                    const message = error?.message || String(error);
                    if (request.id === requestSequence) {
                        publish({
                            status: 'error',
                            targetPreset: request.presetName,
                            activationSource: request.source,
                            trackPath: request.trackPath,
                            error: message
                        });
                    }
                    result = { success: false, error: message, presetName: request.presetName };
                }

                request.resolve(result);
            }
        })().finally(() => {
            worker = null;
            if (pendingRequest) void pumpQueue();
        });

        return worker;
    }

    function requestPreset(presetName, source, trackPath = '') {
        const name = String(presetName || '').trim();
        if (!name) {
            return Promise.resolve({ success: true, skipped: true, reason: 'no-preset' });
        }

        const normalizedPath = normalizePlaybackPath(trackPath);
        if (
            state.targetPreset === name
            && normalizePlaybackPath(state.trackPath) === normalizedPath
            && ['queued', 'applying', 'verifying'].includes(state.status)
            && lastTask
        ) {
            return lastTask;
        }

        if (state.status === 'active' && state.activePreset === name) {
            publish({
                targetPreset: name,
                activationSource: source,
                trackPath,
                error: ''
            });
            return Promise.resolve({ success: true, skipped: true, presetName: name });
        }

        if (pendingRequest) {
            pendingRequest.resolve({
                success: true,
                skipped: true,
                superseded: true,
                presetName: pendingRequest.presetName
            });
        }

        const id = ++requestSequence;
        let resolveTask;
        const task = new Promise((resolve) => {
            resolveTask = resolve;
        });

        pendingRequest = {
            id,
            presetName: name,
            source,
            trackPath,
            resolve: resolveTask
        };
        publish({
            status: worker ? 'queued' : 'applying',
            targetPreset: name,
            activationSource: source,
            trackPath,
            error: ''
        });
        lastTask = task;
        void pumpQueue();
        return task;
    }

    async function prepareForTrack(trackPath) {
        if (!isAvailable()) {
            return { success: false, skipped: true, error: 'El puente nativo de foobar2000 no está disponible.' };
        }

        const resolved = resolveDspPresetForTrack(getSettings(), trackPath);
        if (!resolved.presetName) {
            expectedTrackPath = '';
            return { success: true, skipped: true, reason: 'no-preset', resolved };
        }

        expectedTrackPath = normalizePlaybackPath(trackPath);
        const result = await requestPreset(
            resolved.presetName,
            resolved.source,
            trackPath
        );

        if (result.success !== true) {
            // Let playback continue; the post-open track event will retry the rule.
            expectedTrackPath = '';
        }
        return { ...result, resolved, prepared: result.success === true };
    }

    async function syncTrack(trackPath) {
        if (!isAvailable() || !trackPath) {
            return { success: false, skipped: true, error: 'No hay una pista local disponible para sincronizar.' };
        }

        const resolved = resolveDspPresetForTrack(getSettings(), trackPath);
        if (!resolved.presetName) {
            return { success: true, skipped: true, reason: 'no-preset', resolved };
        }

        return {
            ...(await requestPreset(resolved.presetName, resolved.source, trackPath)),
            resolved
        };
    }

    async function restoreDefault() {
        const settings = getSettings();
        const defaultPreset = String(settings.defaultPreset || '').trim();
        expectedTrackPath = '';

        if (!defaultPreset) {
            publish({
                status: 'idle',
                targetPreset: null,
                activationSource: null,
                trackPath: '',
                error: 'No hay un DSP Preset predeterminado configurado.'
            });
            return { success: false, skipped: true, error: state.error };
        }

        return requestPreset(defaultPreset, 'default', '');
    }

    async function cancelPreparedTrack(fallbackTrackPath = '') {
        expectedTrackPath = '';
        if (fallbackTrackPath) {
            return syncTrack(fallbackTrackPath);
        }
        return restoreDefault();
    }

    function handleTrackChanged(track) {
        const path = String(track?.path || '');
        const normalizedPath = normalizePlaybackPath(path);
        if (!path) return;

        if (expectedTrackPath && normalizedPath === expectedTrackPath) {
            expectedTrackPath = '';
            return;
        }

        expectedTrackPath = '';
        void syncTrack(path);
    }

    function handleStopped(payload) {
        const reason = String(payload?.reason || '');
        if (reason === 'starting_another' || reason === 'shutting_down') return;
        if (expectedTrackPath && reason === 'user') return;
        if (reason === 'user' || reason === 'eof') {
            void restoreDefault();
        }
    }

    async function refreshExternalPreset() {
        if (!isAvailable() || ['queued', 'applying', 'verifying'].includes(state.status)) return;
        const observedRequestSequence = requestSequence;
        try {
            const chain = await getSdk().dsp.getChain();
            if (chain?.success === false) return;
            if (
                observedRequestSequence !== requestSequence
                || ['queued', 'applying', 'verifying'].includes(state.status)
            ) {
                return;
            }
            publish({
                activePreset: chain.activePreset || null,
                targetPreset: chain.activePreset || null,
                status: chain.activePreset ? 'active' : 'idle',
                activationSource: null,
                trackPath: '',
                error: ''
            });
        } catch {
            // A manual preset change must not break playback or the controller.
        }
    }

    function start() {
        if (started || !isAvailable()) return () => stop();
        started = true;
        unsubscribers.push(
            subscribeEvents('playback:trackChanged', handleTrackChanged),
            subscribeEvents('playback:stopped', handleStopped),
            subscribeEvents('audio:dspPresetChanged', refreshExternalPreset)
        );
        void refreshExternalPreset();
        return () => stop();
    }

    function stop() {
        while (unsubscribers.length) {
            try {
                unsubscribers.pop()?.();
            } catch {
                // Continue disposing remaining listeners.
            }
        }
        started = false;
    }

    return Object.freeze({
        start,
        stop,
        getState,
        subscribe: subscribeState,
        prepareForTrack,
        syncTrack,
        restoreDefault,
        cancelPreparedTrack
    });
}

export const dspAutoActivationController = createDspAutoActivationController();

export function startDspAutoActivationController() {
    return dspAutoActivationController.start();
}

export function getDspAutoPresetState() {
    return dspAutoActivationController.getState();
}

export function subscribeDspAutoPresetState(listener) {
    return dspAutoActivationController.subscribe(listener);
}

export function prepareDspPresetForTrack(path) {
    return dspAutoActivationController.prepareForTrack(path);
}

export function syncDspAutoPresetTrack(path) {
    return dspAutoActivationController.syncTrack(path);
}

export function cancelPreparedDspPresetTrack(fallbackTrackPath = '') {
    return dspAutoActivationController.cancelPreparedTrack(fallbackTrackPath);
}
