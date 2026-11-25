function FaIcon({ name }) {
    return <i className={'fa fa-' + name} aria-hidden="true" />;
}

export default function ActivityBar({
    buttons = [],
    actionCatalog = [],
    onExecuteAction,
    onOpenSettingsBackup
}) {
    const actionMap = new Map(actionCatalog.map((action) => [action.id, action]));
    const managerAction = actionMap.get('activitybar.manage');

    return (
        <nav className="activitybar" aria-label="Barra de actividad">
            <div className="activitybar-actions">
                {buttons.map((button) => {
                    const action = actionMap.get(button.actionId);
                    const available = Boolean(action?.available);
                    const running = Boolean(action?.running);

                    return (
                        <button
                            key={button.id}
                            id={'ActivityBarButton-' + button.id.replace(/[^a-zA-Z0-9_-]/g, '-')}
                            className={
                                'activitybar-button'
                                + (action?.active ? ' is-active' : '')
                                + (running ? ' is-running' : '')
                            }
                            type="button"
                            aria-label={button.label}
                            aria-pressed={Boolean(action?.active)}
                            aria-busy={running}
                            title={running
                                ? button.label + ' (en ejecución)'
                                : available
                                    ? button.label
                                    : (action?.unavailableReason || 'La acción ya no está registrada.')}
                            disabled={!available || running}
                            onClick={() => onExecuteAction(button.actionId)}
                        >
                            <FaIcon name={button.icon}/>
                        </button>
                    );
                })}
            </div>

            <div className="activitybar-bottom">
                <div className="activitybar-bottom-separator" />
                <button
                    id="SettingsBackup"
                    className="activitybar-button"
                    type="button"
                    aria-label="Respaldar y restaurar configuración"
                    aria-haspopup="dialog"
                    title="Respaldar y restaurar configuración"
                    onClick={() => onOpenSettingsBackup?.()}
                >
                    <FaIcon name="archive"/>
                </button>
                <button
                    id="ActivityBarManager"
                    className={
                        'activitybar-button'
                        + (managerAction?.active ? ' is-active' : '')
                    }
                    type="button"
                    aria-label="Administrar ActivityBar"
                    aria-pressed={Boolean(managerAction?.active)}
                    title={managerAction?.available
                        ? 'Administrar ActivityBar'
                        : (managerAction?.unavailableReason || 'Administrador no disponible')}
                    disabled={!managerAction?.available}
                    onClick={() => onExecuteAction('activitybar.manage')}
                >
                    <FaIcon name="cogs"/>
                </button>
            </div>
        </nav>
    );
}
