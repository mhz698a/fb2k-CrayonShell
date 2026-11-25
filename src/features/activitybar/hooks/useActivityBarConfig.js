import { useCallback, useEffect, useState } from 'react';
import { createDefaultActivityBarConfig } from '../config/defaults.js';
import { normalizeActivityBarConfig, parseActivityBarConfig } from '../config/schema.js';
import { loadActivityBarConfig, saveActivityBarConfig } from '../config/storage.js';

export function useActivityBarConfig() {
    const [config, setConfig] = useState(loadActivityBarConfig);

    useEffect(() => {
        try {
            saveActivityBarConfig(config);
        } catch (error) {
            console.error('[ActivityBar] No se pudo guardar la configuración.', error);
        }
    }, [config]);

    const addButton = useCallback((action) => {
        if (!action?.id) return false;

        setConfig((current) => {
            if (current.buttons.some((button) => button.actionId === action.id)) return current;
            const next = {
                ...current,
                buttons: [
                    ...current.buttons,
                    {
                        id: action.id,
                        actionId: action.id,
                        label: action.label || action.id,
                        icon: action.defaultIcon || 'question-circle'
                    }
                ]
            };
            try {
                return normalizeActivityBarConfig(next);
            } catch {
                return current;
            }
        });
        return true;
    }, []);

    const removeButton = useCallback((buttonId) => {
        setConfig((current) => ({
            ...current,
            buttons: current.buttons.filter((button) => button.id !== buttonId)
        }));
    }, []);

    const updateButton = useCallback((buttonId, changes) => {
        setConfig((current) => ({
            ...current,
            buttons: current.buttons.map((button) => (
                button.id === buttonId
                    ? { ...button, ...changes }
                    : button
            ))
        }));
    }, []);

    const moveButton = useCallback((buttonId, targetIndex) => {
        setConfig((current) => {
            const sourceIndex = current.buttons.findIndex((button) => button.id === buttonId);
            if (sourceIndex < 0) return current;

            const boundedIndex = Math.max(0, Math.min(current.buttons.length - 1, targetIndex));
            if (sourceIndex === boundedIndex) return current;

            const buttons = [...current.buttons];
            const [moved] = buttons.splice(sourceIndex, 1);
            buttons.splice(boundedIndex, 0, moved);
            return { ...current, buttons };
        });
    }, []);

    const restoreDefaults = useCallback(() => {
        setConfig(createDefaultActivityBarConfig());
    }, []);

    const replaceConfig = useCallback((value) => {
        const normalized = typeof value === 'string'
            ? parseActivityBarConfig(value)
            : normalizeActivityBarConfig(value);
        setConfig(normalized);
        return normalized;
    }, []);

    return {
        config,
        addButton,
        removeButton,
        updateButton,
        moveButton,
        restoreDefaults,
        replaceConfig
    };
}
