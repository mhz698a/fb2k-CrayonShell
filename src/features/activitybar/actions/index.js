import { createActionRegistry } from './actionRegistry.js';
import { registerCoreActivityBarActions } from './coreActions.js';
import { registerLegacyActivityActions } from './legacyActions.js';

export const activityBarActionRegistry = createActionRegistry();

activityBarActionRegistry.registerModule({
    id: 'core',
    label: 'CrayonShell',
    description: 'Acciones integradas de interfaz, playlist y diagnóstico.',
    register: registerCoreActivityBarActions
});

activityBarActionRegistry.registerModule({
    id: 'legacy',
    label: 'Herramientas heredadas',
    description: 'Adaptadores nativos y lanzadores de la ActivityBar original.',
    register: registerLegacyActivityActions
});

/**
 * Register an action module from any CrayonShell feature.
 *
 * The module must provide a stable id, label, optional description and a
 * register(scopedRegistry) function. The returned disposer unloads the module
 * and every action it registered.
 */
export function registerActivityBarModule(moduleDefinition) {
    return activityBarActionRegistry.registerModule(moduleDefinition);
}
