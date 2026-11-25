export const ACTIVITY_BAR_CONFIG_VERSION = 1;

export function createDefaultActivityBarConfig() {
    return {
        version: ACTIVITY_BAR_CONFIG_VERSION,
        buttons: [
            {
                id: 'ui.toggleSidebar',
                actionId: 'ui.toggleSidebar',
                label: 'Biblioteca',
                icon: 'columns'
            },
            {
                id: 'legacy.yearbookExplorer',
                actionId: 'legacy.yearbookExplorer',
                label: 'Yearbook Explorer',
                icon: 'calendar'
            }
        ]
    };
}
