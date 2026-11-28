export function getMenuNodeLabel(node = {}) {
    const label = node.displayLabel || node.label || node.displayPath || node.path || '';
    const segments = String(label).split('/');
    return segments[segments.length - 1].trim();
}

export function isMenuCommandExecutable(node = {}) {
    const isDynamic = node.source === 'mainmenu_dynamic'
        || node.source === 'contextmenu_dynamic';
    const hasAddress = isDynamic
        ? Boolean(
            typeof node.guid === 'string'
            && node.guid.trim()
            && typeof node.subGuid === 'string'
            && node.subGuid.trim()
        )
        : Boolean(
            (typeof node.guid === 'string' && node.guid.trim())
            || (typeof node.path === 'string' && node.path.trim())
        );

    return hasAddress
        && node.hidden !== true
        && node.enabled !== false
        && node.available !== false
        && node.executable !== false;
}

/**
 * The SDK normally returns a hierarchical menu tree. Older/native fallback
 * providers can return a flat command list with slash-separated paths; rebuild
 * that list into submenus while preserving each command's stable address.
 */
export function buildMainMenuTree(items = [], flatFallback = false) {
    const source = Array.isArray(items) ? items.filter((item) => item && item.hidden !== true) : [];
    if (!flatFallback || !source.every((item) => item.type === 'command')) {
        return source;
    }

    const roots = [];

    source.forEach((item) => {
        const rawPath = String(item.displayPath || item.path || item.displayLabel || item.label || '');
        const segments = rawPath.split('/').map((segment) => segment.trim()).filter(Boolean);
        if (segments.length <= 1) {
            roots.push({
                ...item,
                label: segments[0] || getMenuNodeLabel(item),
                displayLabel: segments[0] || getMenuNodeLabel(item)
            });
            return;
        }

        let siblings = roots;
        const parentSegments = [];
        segments.slice(0, -1).forEach((segment) => {
            parentSegments.push(segment);
            let submenu = siblings.find((candidate) =>
                candidate.type === 'submenu' && candidate.displayLabel === segment
            );
            if (!submenu) {
                submenu = {
                    type: 'submenu',
                    label: segment,
                    displayLabel: segment,
                    path: parentSegments.join('/'),
                    children: []
                };
                siblings.push(submenu);
            }
            submenu.children ||= [];
            siblings = submenu.children;
        });

        const leafLabel = segments[segments.length - 1];
        siblings.push({
            ...item,
            label: leafLabel,
            displayLabel: leafLabel
        });
    });

    return roots;
}

/**
 * Resolve a menu command into the exact SDK invocation. Dynamic entries need
 * both GUID and subGuid; static entries may use their command path.
 */
export function getMenuCommandInvocation(node = {}) {
    if (!isMenuCommandExecutable(node)) return null;

    const address = typeof node.guid === 'string' && node.guid.trim()
        ? node.guid
        : typeof node.path === 'string' && node.path.trim()
            ? node.path
            : '';

    if (!address) return null;

    return {
        address,
        options: node.subGuid ? { subGuid: node.subGuid } : undefined
    };
}
