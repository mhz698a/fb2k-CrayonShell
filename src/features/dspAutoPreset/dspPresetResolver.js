import {
    normalizeDspAutoPresetSettings,
    normalizeDspRulePath
} from './dspAutoPresetSettings.js';

function isInsideFolder(trackPath, folderPath) {
    // A folder rule applies to tracks below the directory, never to the
    // directory path itself (for example, while navigating into that folder).
    return trackPath.startsWith(folderPath + '\\');
}

/**
 * Resolves a track's preset. Exact track rules win; otherwise the deepest
 * matching folder wins; the configured default is the final fallback.
 */
export function resolveDspPresetForTrack(settingsValue, trackPath) {
    const settings = normalizeDspAutoPresetSettings(settingsValue);
    const normalizedTrackPath = normalizeDspRulePath(trackPath);

    if (!normalizedTrackPath) {
        return {
            presetName: settings.defaultPreset,
            source: settings.defaultPreset ? 'default' : 'none',
            ruleId: null,
            matchedPath: ''
        };
    }

    const exactRule = settings.trackRules.find((rule) => (
        rule.presetName
        && normalizeDspRulePath(rule.path) === normalizedTrackPath
    ));

    if (exactRule) {
        return {
            presetName: exactRule.presetName,
            source: 'track',
            ruleId: exactRule.id,
            matchedPath: exactRule.path
        };
    }

    const folderRule = settings.folderRules
        .filter((rule) => {
            const folderPath = normalizeDspRulePath(rule.path);
            return rule.presetName && folderPath && isInsideFolder(normalizedTrackPath, folderPath);
        })
        .sort((left, right) => (
            normalizeDspRulePath(right.path).length - normalizeDspRulePath(left.path).length
        ))[0];

    if (folderRule) {
        return {
            presetName: folderRule.presetName,
            source: 'folder',
            ruleId: folderRule.id,
            matchedPath: folderRule.path
        };
    }

    return {
        presetName: settings.defaultPreset,
        source: settings.defaultPreset ? 'default' : 'none',
        ruleId: null,
        matchedPath: ''
    };
}
