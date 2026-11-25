function normalizeAvailability(value) {
    if (typeof value === 'boolean') {
        return {
            available: value,
            reason: value ? '' : 'La acción no está disponible en este contexto.'
        };
    }

    if (value && typeof value === 'object') {
        return {
            available: value.available !== false,
            reason: value.reason ? String(value.reason) : ''
        };
    }

    return { available: Boolean(value), reason: '' };
}

function evaluateAction(action, context) {
    let availability;
    let availabilityError = null;

    try {
        availability = normalizeAvailability(
            typeof action.isAvailable === 'function'
                ? action.isAvailable(context)
                : true
        );
    } catch (error) {
        availability = {
            available: false,
            reason: error?.message || 'No se pudo comprobar la disponibilidad.'
        };
        availabilityError = error;
    }

    let active = false;
    try {
        active = typeof action.isActive === 'function'
            ? Boolean(action.isActive(context))
            : false;
    } catch {
        active = false;
    }

    return {
        id: action.id,
        label: action.label,
        category: action.category,
        description: action.description,
        defaultIcon: action.defaultIcon,
        available: availability.available,
        unavailableReason: availability.reason,
        active,
        availabilityError
    };
}

export function createActionRegistry() {
    const actions = new Map();

    function register(definition) {
        if (!definition || typeof definition !== 'object') {
            throw new TypeError('La definición de una acción debe ser un objeto.');
        }

        const id = String(definition.id || '').trim();
        if (!id) {
            throw new TypeError('Toda acción debe tener un identificador.');
        }
        if (actions.has(id)) {
            throw new Error('Ya existe una acción registrada con el identificador: ' + id);
        }
        if (typeof definition.execute !== 'function') {
            throw new TypeError('La acción "' + id + '" debe proporcionar execute().');
        }

        const action = Object.freeze({
            id,
            label: String(definition.label || id),
            category: String(definition.category || 'General'),
            description: String(definition.description || ''),
            defaultIcon: String(definition.defaultIcon || ''),
            isAvailable: typeof definition.isAvailable === 'function'
                ? definition.isAvailable
                : () => true,
            isActive: typeof definition.isActive === 'function'
                ? definition.isActive
                : () => false,
            execute: definition.execute
        });

        actions.set(id, action);

        let registered = true;
        return () => {
            if (!registered) return false;
            registered = false;
            return actions.delete(id);
        };
    }

    function unregister(id) {
        return actions.delete(String(id || ''));
    }

    function get(id) {
        return actions.get(String(id || '')) || null;
    }

    function getState(id, context = {}) {
        const action = get(id);
        return action ? evaluateAction(action, context) : null;
    }

    function getCatalog(context = {}) {
        return Array.from(actions.values(), (action) => evaluateAction(action, context));
    }

    return Object.freeze({
        register,
        unregister,
        get,
        getState,
        getCatalog,
        has: (id) => actions.has(String(id || ''))
    });
}
