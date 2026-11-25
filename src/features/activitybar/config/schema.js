import { ACTIVITY_BAR_CONFIG_VERSION, createDefaultActivityBarConfig } from './defaults.js';
import { isFa4IconName } from '../icons/fa4Catalog.js';

const MAX_BUTTONS = 80;
const MAX_LABEL_LENGTH = 48;

function cleanText(value, fallback, maxLength = MAX_LABEL_LENGTH) {
    const cleaned = String(value ?? '').trim().replace(/[\u0000-\u001f\u007f]/g, '');
    return (cleaned || fallback).slice(0, maxLength);
}

export function normalizeActivityBarConfig(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('La configuración de ActivityBar debe ser un objeto JSON.');
    }

    if (Number(value.version) !== ACTIVITY_BAR_CONFIG_VERSION) {
        throw new Error(
            'Versión de configuración no compatible. Se esperaba la versión '
            + ACTIVITY_BAR_CONFIG_VERSION + '.'
        );
    }

    if (!Array.isArray(value.buttons)) {
        throw new TypeError('La configuración no contiene una lista de botones válida.');
    }

    if (value.buttons.length > MAX_BUTTONS) {
        throw new RangeError('La ActivityBar no puede contener más de ' + MAX_BUTTONS + ' botones.');
    }

    const seenIds = new Set();
    const seenActions = new Set();
    const buttons = [];

    value.buttons.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;

        const actionId = cleanText(entry.actionId, '', 128);
        const id = cleanText(entry.id, actionId || 'button-' + index, 128);
        if (!actionId || !id || seenIds.has(id) || seenActions.has(actionId)) return;

        seenIds.add(id);
        seenActions.add(actionId);

        buttons.push({
            id,
            actionId,
            label: cleanText(entry.label, actionId),
            icon: isFa4IconName(entry.icon) ? entry.icon : 'question-circle'
        });
    });

    return {
        version: ACTIVITY_BAR_CONFIG_VERSION,
        buttons
    };
}

export function parseActivityBarConfig(jsonText) {
    let parsed;
    try {
        parsed = JSON.parse(String(jsonText));
    } catch (error) {
        throw new Error('El archivo no contiene JSON válido: ' + (error.message || String(error)));
    }
    return normalizeActivityBarConfig(parsed);
}

export function getDefaultActivityBarConfig() {
    return normalizeActivityBarConfig(createDefaultActivityBarConfig());
}
