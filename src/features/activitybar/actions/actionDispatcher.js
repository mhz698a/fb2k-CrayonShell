function normalizeError(error) {
    return {
        name: error?.name ? String(error.name) : 'Error',
        message: error?.message ? String(error.message) : String(error || 'Error desconocido'),
        code: error?.code ? String(error.code) : null,
        cause: error
    };
}

export function createActionDispatcher(registry, { onError } = {}) {
    if (!registry || typeof registry.get !== 'function'
        || typeof registry.getState !== 'function') {
        throw new TypeError('ActionDispatcher necesita un Action Registry válido.');
    }

    const listeners = new Set();
    const activeExecutions = new Map();
    let revision = 0;

    function notify() {
        revision += 1;
        for (const listener of listeners) {
            try {
                listener();
            } catch (error) {
                console.error('[ActivityBar] Error notificando el estado del dispatcher.', error);
            }
        }
    }

    function subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    function getState(actionId, context = {}) {
        const state = registry.getState(actionId, context);
        if (!state) return null;
        return {
            ...state,
            running: (activeExecutions.get(state.id) || 0) > 0
        };
    }

    function getCatalog(context = {}) {
        return registry.getCatalog(context).map((state) => ({
            ...state,
            running: (activeExecutions.get(state.id) || 0) > 0
        }));
    }

    function reportFailure(failure) {
        try {
            onError?.(failure);
        } catch (reportError) {
            console.error('[ActivityBar] No se pudo reportar el error de acción.', reportError);
        }
    }

    async function execute(actionId, context = {}, payload) {
        const id = String(actionId || '').trim();
        const action = registry.get(id);

        if (!action) {
            const failure = {
                ok: false,
                status: 'error',
                actionId: id,
                error: normalizeError(
                    new Error('No existe una acción registrada con el identificador: ' + id)
                )
            };
            reportFailure(failure);
            return failure;
        }

        const state = getState(id, context);
        if (state?.availabilityError) {
            const failure = {
                ok: false,
                status: 'error',
                actionId: id,
                error: normalizeError(new Error(state.availabilityError))
            };
            reportFailure(failure);
            return failure;
        }

        if (!state?.available) {
            return {
                ok: false,
                status: 'unavailable',
                actionId: id,
                reason: state?.unavailableReason
                    || 'La acción no está disponible en este contexto.'
            };
        }

        if (action.executionPolicy === 'single' && state.running) {
            return {
                ok: false,
                status: 'busy',
                actionId: id,
                reason: 'La acción ya se está ejecutando.'
            };
        }

        activeExecutions.set(id, (activeExecutions.get(id) || 0) + 1);
        notify();

        try {
            const result = await action.execute(context, payload);
            return {
                ok: true,
                status: 'success',
                actionId: id,
                result
            };
        } catch (error) {
            const failure = {
                ok: false,
                status: 'error',
                actionId: id,
                error: normalizeError(error)
            };
            reportFailure(failure);
            return failure;
        } finally {
            const remaining = (activeExecutions.get(id) || 1) - 1;
            if (remaining > 0) activeExecutions.set(id, remaining);
            else activeExecutions.delete(id);
            notify();
        }
    }

    return Object.freeze({
        execute,
        getState,
        getCatalog,
        subscribe,
        getRevision: () => revision
    });
}
