import { demoBridge } from './mockFb2k.js';

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
    const bridge = getBridge();

    if (!bridge || typeof bridge.on !== 'function') {
        return () => {};
    }

    const unsubscribe = bridge.on(eventName, handler);

    if (typeof unsubscribe === 'function') {
        return unsubscribe;
    }

    return () => {
        if (typeof bridge.off === 'function') {
            bridge.off(eventName, handler);
        }
    };
}
