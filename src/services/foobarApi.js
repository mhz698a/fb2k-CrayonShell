import { demoBridge } from './mockFb2k.js';
import { getFooSdk } from './fooSdk.js';

const injectedBridge = () => {
    if (typeof window === 'undefined') return null;
    const bridge = window.fb2k;

    return bridge && typeof bridge.invoke === 'function'
        ? bridge
        : null;
};

export const isDemoMode = import.meta.env.DEV && !injectedBridge();

function getBridge() {
    return injectedBridge() || (isDemoMode ? demoBridge : null);
}

export function hasBridge() {
    const bridge = getBridge();
    return Boolean(bridge && typeof bridge.invoke === 'function');
}

export async function invoke(method, params = {}) {
    const bridge = getBridge();

    if (!bridge || typeof bridge.invoke !== 'function') {
        throw new Error('No se encontró fb2k.invoke. Abre la aplicación desde foobar2000.');
    }

    const result = await bridge.invoke(method, params);

    if (result && result.success === false) {
        const error = new Error(result.error || ('Falló ' + method));
        error.code = result.code;
        throw error;
    }

    return result || {};
}

export function subscribe(eventName, handler) {
    // Demo events remain on the local mock. In foobar2000, subscribe through
    // the official foo-webview-sdk emitter instead of the legacy fb2k bridge.
    // Playback Controller already uses this exact emitter for playback events.
    let eventSource = null;
    try {
        eventSource = isDemoMode ? getBridge() : getFooSdk();
    } catch (error) {
        console.error('[CrayonShell][events] SDK event source unavailable', {
            eventName,
            error
        });
        return () => {};
    }

    if (!eventSource || typeof eventSource.on !== 'function') {
        console.error('[CrayonShell][events] SDK does not expose on()', { eventName });
        return () => {};
    }

    const unsubscribe = eventSource.on(eventName, handler);
    if (typeof unsubscribe === 'function') return unsubscribe;

    return () => {
        if (typeof eventSource.off === 'function') {
            eventSource.off(eventName, handler);
        }
    };
}
