import { createActionRegistry } from './actionRegistry.js';
import { registerCoreActivityBarActions } from './coreActions.js';

export const activityBarActionRegistry = createActionRegistry();

registerCoreActivityBarActions(activityBarActionRegistry);
