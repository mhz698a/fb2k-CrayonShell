export default function ActivityBar({ sidebarCollapsed, sidebarAction, onExecuteAction }) {
    const sidebarLabel = sidebarCollapsed
        ? 'Mostrar panel izquierdo'
        : 'Ocultar panel izquierdo';

    return (
        <nav className="activitybar" aria-label="Barra de actividad">
            <div className="activitybar-actions">
                <button
                    id="ActivityBarSidebarToggle"
                    className="activitybar-button"
                    type="button"
                    aria-controls="LeftSidebar"
                    aria-expanded={!sidebarCollapsed}
                    aria-pressed={Boolean(sidebarAction?.active)}
                    aria-label={sidebarLabel}
                    title={sidebarAction?.available === false
                        ? sidebarAction.unavailableReason || sidebarLabel
                        : sidebarLabel}
                    disabled={sidebarAction?.available === false}
                    onClick={() => onExecuteAction('ui.toggleSidebar')}
                >
                    <svg
                        className="activitybar-button-icon"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        focusable="false"
                    >
                        <rect x="3.25" y="4.25" width="17.5" height="15.5" rx="1.75" />
                        <path d="M9 4.5v15" />
                        {sidebarCollapsed
                            ? <path d="m13.5 9 3 3-3 3" />
                            : <path d="m16.5 9-3 3 3 3" />}
                    </svg>
                </button>
            </div>
        </nav>
    );
}
