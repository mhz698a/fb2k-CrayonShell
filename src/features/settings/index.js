import { createSettingsRegistry } from './settingsRegistry.js';

export { createSettingsRegistry } from './settingsRegistry.js';

/**
 * Application-wide registry. Feature modules register their own providers
 * during application bootstrap.
 */
export const settingsRegistry = createSettingsRegistry();

export function registerSettingsProvider(provider) {
    return settingsRegistry.register(provider);
}

export function registerSettingsProviders(providers) {
    return settingsRegistry.registerMany(providers);
}

export {
    createSettingsBackup,
    serializeSettingsBackup,
    SETTINGS_BACKUP_FORMAT,
    SETTINGS_BACKUP_FORMAT_VERSION
} from './settingsBackupService.js';

export {
    createCoreSettingsProviders,
    registerCoreSettingsProviders
} from './providers/coreSettingsProviders.js';
