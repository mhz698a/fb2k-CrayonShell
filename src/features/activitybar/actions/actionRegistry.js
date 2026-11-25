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

function normalizeAction(definition, moduleId = 'manual') {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
        throw new TypeError('La definición de una acción debe ser un objeto.');
    }

    const id = String(definition.id || '').trim();
    if (!id) {
        throw new TypeError('Toda acción debe tener un identificador.');
    }
    if (typeof definition.execute !== 'function') {
        throw new TypeError('La acción "' + id + '" debe proporcionar execute().');
    }

    const executionPolicy = definition.executionPolicy || 'parallel';
    if (!['parallel', 'single'].includes(executionPolicy)) {
        throw new TypeError(
            'La acción "' + id + '" tiene una executionPolicy no válida. Usa "parallel" o "single".'
        );
    }

    return Object.freeze({
        id,
        label: String(definition.label || id).trim().slice(0, 80),
        category: String(definition.category || 'General').trim().slice(0, 80),
        description: String(definition.description || '').trim().slice(0, 240),
        defaultIcon: String(definition.defaultIcon || '').trim(),
        executionPolicy,
        moduleId,
        isAvailable: typeof definition.isAvailable === 'function'
            ? definition.isAvailable
            : () => true,
        isActive: typeof definition.isActive === 'function'
            ? definition.isActive
            : () => false,
        execute: definition.execute
    });
}

function evaluateAction(action, context) {
    let availability;
    let availabilityError = null;

    try {
        availability = normalizeAvailability(action.isAvailable(context));
    } catch (error) {
        availability = {
            available: false,
            reason: error?.message || 'No se pudo comprobar la disponibilidad.'
        };
        availabilityError = error;
    }

    let active = false;
    try {
        active = Boolean(action.isActive(context));
    } catch {
        active = false;
    }

    return {
        id: action.id,
        label: action.label,
        category: action.category,
        description: action.description,
        defaultIcon: action.defaultIcon,
        executionPolicy: action.executionPolicy,
        moduleId: action.moduleId,
        available: availability.available,
        unavailableReason: availability.reason,
        active,
        running: false,
        availabilityError: availabilityError
            ? (availabilityError.message || String(availabilityError))
            : ''
    };
}

export function createActionRegistry() {
    const actions = new Map();
    const modules = new Map();
    const listeners = new Set();
    let revision = 0;

    function notify() {
        revision += 1;
        for (const listener of listeners) {
            try {
                listener();
            } catch (error) {
                console.error('[ActivityBar] Error notificando un cambio del registro.', error);
            }
        }
    }

    function subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    function register(definition) {
        const action = normalizeAction(definition);
        if (actions.has(action.id)) {
            throw new Error('Ya existe una acción registrada con el identificador: ' + action.id);
        }

        actions.set(action.id, action);
        notify();

        let registered = true;
        return () => {
            if (!registered) return false;
            registered = false;
            const current = actions.get(action.id);
            if (current !== action) return false;
            const removed = actions.delete(action.id);
            if (removed) notify();
            return removed;
        };
    }

    function registerModule(moduleDefinition) {
        if (!moduleDefinition || typeof moduleDefinition !== 'object') {
            throw new TypeError('La definición de un módulo de acciones debe ser un objeto.');
        }

        const moduleId = String(moduleDefinition.id || '').trim();
        if (!moduleId) {
            throw new TypeError('Todo módulo de acciones debe tener un identificador.');
        }
        if (modules.has(moduleId)) {
            throw new Error('Ya existe un módulo de ActivityBar registrado: ' + moduleId);
        }
        if (typeof moduleDefinition.register !== 'function') {
            throw new TypeError('El módulo "' + moduleId + '" debe proporcionar register().');
        }

        const stagedActions = [];
        const stagedIds = new Set();
        let moduleCleanup = null;

        const scopedRegistry = Object.freeze({
            register(definition) {
                const action = normalizeAction(definition, moduleId);
                if (stagedIds.has(action.id) || actions.has(action.id)) {
                    throw new Error(
                        'El módulo "' + moduleId
                        + '" intenta registrar un identificador de acción duplicado: '
                        + action.id
                    );
                }

                stagedIds.add(action.id);
                stagedActions.push(action);
                let staged = true;

                return () => {
                    if (!staged) return false;
                    staged = false;
                    stagedIds.delete(action.id);
                    const index = stagedActions.indexOf(action);
                    if (index >= 0) stagedActions.splice(index, 1);
                    return index >= 0;
                };
            }
        });

        try {
            moduleCleanup = moduleDefinition.register(scopedRegistry) || null;
            if (moduleCleanup !== null && typeof moduleCleanup !== 'function') {
                throw new TypeError(
                    'El registro del módulo "' + moduleId
                    + '" debe devolver una función de limpieza o undefined.'
                );
            }

            // Verify the complete module before publishing any action.
            for (const action of stagedActions) {
                if (actions.has(action.id)) {
                    throw new Error('Ya existe una acción registrada con el identificador: ' + action.id);
                }
            }
        } catch (error) {
            try {
                moduleCleanup?.();
            } catch (cleanupError) {
                console.error('[ActivityBar] Falló la limpieza del módulo rechazado.', cleanupError);
            }
            throw error;
        }

        const moduleRecord = {
            id: moduleId,
            label: String(moduleDefinition.label || moduleId).trim().slice(0, 80),
            description: String(moduleDefinition.description || '').trim().slice(0, 240),
            actionIds: new Set(stagedActions.map((action) => action.id)),
            cleanup: moduleCleanup
        };

        stagedActions.forEach((action) => actions.set(action.id, action));
        modules.set(moduleId, moduleRecord);
        notify();

        return () => removeModule(moduleId, moduleRecord);
    }

    function removeModule(moduleId, expectedRecord) {
        const currentModule = modules.get(moduleId);
        if (!currentModule || (expectedRecord && currentModule !== expectedRecord)) return false;

        modules.delete(moduleId);
        for (const actionId of currentModule.actionIds) {
            const currentAction = actions.get(actionId);
            if (currentAction?.moduleId === moduleId) actions.delete(actionId);
        }

        try {
            currentModule.cleanup?.();
        } catch (error) {
            console.error('[ActivityBar] Error limpiando el módulo ' + moduleId + '.', error);
        }

        notify();
        return true;
    }

    function unregisterModule(moduleId) {
        return removeModule(String(moduleId || ''));
    }

    function unregister(id) {
        const actionId = String(id || '');
        const currentAction = actions.get(actionId);
        if (!currentAction) return false;

        actions.delete(actionId);
        modules.get(currentAction.moduleId)?.actionIds.delete(actionId);
        notify();
        return true;
    }

    function get(id) {
        return actions.get(String(id || '')) || null;
    }

    function getState(id, context = {}) {
        const action = get(id);
        if (!action) return null;
        const state = evaluateAction(action, context);
        const owner = modules.get(action.moduleId);
        return {
            ...state,
            moduleLabel: owner?.label || 'Registro manual',
            moduleDescription: owner?.description || ''
        };
    }

    function getCatalog(context = {}) {
        return Array.from(actions.values(), (action) => getState(action.id, context));
    }

    function getModules() {
        return Array.from(modules.values(), (module) => ({
            id: module.id,
            label: module.label,
            description: module.description,
            actionIds: Array.from(module.actionIds),
            actionCount: module.actionIds.size
        }));
    }

    return Object.freeze({
        register,
        registerModule,
        unregister,
        unregisterModule,
        get,
        getState,
        getCatalog,
        getModules,
        subscribe,
        getRevision: () => revision,
        has: (id) => actions.has(String(id || ''))
    });
}
