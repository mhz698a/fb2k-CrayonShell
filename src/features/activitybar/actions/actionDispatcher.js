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

    async function execute(actionId, context = {}, payload) {
        const id = String(actionId || '').trim();
        const action = registry.get(id);

        if (!action) {
            const error = new Error('No existe una acción registrada con el identificador: ' + id);
            const failure = {
                ok: false,
                status: 'error',
                actionId: id,
                error: normalizeError(error)
            };
            try {
                onError?.(failure);
            } catch (reportError) {
                console.error('[ActivityBar] No se pudo reportar el error de acción.', reportError);
            }
            return failure;
        }

        const state = registry.getState(id, context);
        if (state?.availabilityError) {
            const failure = {
                ok: false,
                status: 'error',
                actionId: id,
                error: normalizeError(new Error(state.availabilityError))
            };
            try {
                onError?.(failure);
            } catch (reportError) {
                console.error('[ActivityBar] No se pudo reportar el error de disponibilidad.', reportError);
            }
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

            try {
                onError?.(failure);
            } catch (reportError) {
                console.error('[ActivityBar] No se pudo reportar el error de acción.', reportError);
            }

            return failure;
        }
    }

    return Object.freeze({
        execute,
        getState: (actionId, context = {}) => registry.getState(actionId, context),
        getCatalog: (context = {}) => registry.getCatalog(context)
    });
}
