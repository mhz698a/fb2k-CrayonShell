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
