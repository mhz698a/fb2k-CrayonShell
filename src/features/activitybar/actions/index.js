import { createActionRegistry } from './actionRegistry.js';
import { registerCoreActivityBarActions } from './coreActions.js';
import { registerLegacyActivityActions } from './legacyActions.js';

export const activityBarActionRegistry = createActionRegistry();

registerCoreActivityBarActions(activityBarActionRegistry);
registerLegacyActivityActions(activityBarActionRegistry);
