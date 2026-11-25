import { useEffect, useMemo, useRef, useState } from 'react';
import { FA4_ICON_NAMES } from '../../features/activitybar/icons/fa4Catalog.js';

function FaIcon({ name, className = '' }) {
    return (
        <i
            className={['fa', 'fa-' + name, className].filter(Boolean).join(' ')}
            aria-hidden="true"
        />
    );
}

function getActionMap(catalog) {
    return new Map(catalog.map((action) => [action.id, action]));
}

export default function ActivityBarManagerDialog({
    open,
    buttons,
    actionCatalog,
    onClose,
    onAddButton,
    onRemoveButton,
    onUpdateButton,
    onMoveButton,
    onRestoreDefaults,
    onExportConfig,
    onImportConfig
}) {
    const dialogRef = useRef(null);
    const fileInputRef = useRef(null);
    const [actionToAdd, setActionToAdd] = useState('');
    const [iconTargetId, setIconTargetId] = useState('');
    const [iconSearch, setIconSearch] = useState('');
    const [importMessage, setImportMessage] = useState('');
    const [draggedButtonId, setDraggedButtonId] = useState('');

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;

        if (open && !dialog.open) dialog.showModal();
        else if (!open && dialog.open) dialog.close();
    }, [open]);

    const actionMap = useMemo(() => getActionMap(actionCatalog), [actionCatalog]);
    const pinnedActionIds = useMemo(
        () => new Set(buttons.map((button) => button.actionId)),
        [buttons]
    );
    const availableActions = useMemo(
        () => actionCatalog.filter((action) => (
            action.id !== 'activitybar.manage'
            && action.available
            && !pinnedActionIds.has(action.id)
        )),
        [actionCatalog, pinnedActionIds]
    );
    const filteredIcons = useMemo(() => {
        const query = iconSearch.trim().toLocaleLowerCase();
        return FA4_ICON_NAMES
            .filter((name) => !query || name.includes(query))
            .slice(0, 96);
    }, [iconSearch]);

    useEffect(() => {
        if (!availableActions.some((action) => action.id === actionToAdd)) {
            setActionToAdd(availableActions[0]?.id || '');
        }
    }, [availableActions, actionToAdd]);

    function handleAddAction() {
        const action = actionCatalog.find((entry) => entry.id === actionToAdd);
        if (!action) return;
        onAddButton(action);
    }

    function handleDragStart(event, buttonId) {
        setDraggedButtonId(buttonId);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', buttonId);
    }

    function handleDrop(event, targetIndex) {
        event.preventDefault();
        const buttonId = event.dataTransfer.getData('text/plain') || draggedButtonId;
        if (buttonId) onMoveButton(buttonId, targetIndex);
        setDraggedButtonId('');
    }

    function handleExport() {
        const json = onExportConfig();
        const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'crayonshell-activitybar.json';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.URL.revokeObjectURL(url);
    }

    async function handleImportFile(event) {
        const file = event.currentTarget.files?.[0];
        if (!file) return;

        const input = event.currentTarget;
        try {
            const json = await file.text();
            onImportConfig(json);
            setImportMessage('Configuración importada correctamente.');
        } catch (error) {
            setImportMessage(error?.message || 'No se pudo importar la configuración.');
        } finally {
            input.value = '';
        }
    }

    const editingButton = buttons.find((button) => button.id === iconTargetId);

    return (
        <dialog
            ref={dialogRef}
            className="activitybar-manager-dialog"
            aria-labelledby="ActivityBarManagerTitle"
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
            onClose={onClose}
        >
            <div className="activitybar-manager">
                <header className="activitybar-manager-heading">
                    <div>
                        <strong id="ActivityBarManagerTitle">Administrar ActivityBar</strong>
                        <span>Organiza los accesos directos y selecciona sus iconos.</span>
                    </div>
                    <button
                        className="activitybar-manager-close"
                        type="button"
                        aria-label="Cerrar administrador"
                        onClick={onClose}
                    >
                        ×
                    </button>
                </header>

                <section className="activitybar-manager-section">
                    <div className="activitybar-manager-section-heading">
                        <strong>Botones de la barra</strong>
                        <span>{buttons.length} configurados</span>
                    </div>

                    {buttons.length === 0 ? (
                        <div className="activitybar-manager-empty">
                            No hay botones configurados. Añade una acción del catálogo para comenzar.
                        </div>
                    ) : (
                        <div className="activitybar-manager-list">
                            {buttons.map((button, index) => {
                                const action = actionMap.get(button.actionId);
                                const unavailable = !action || !action.available;

                                return (
                                    <div
                                        key={button.id}
                                        className={
                                            'activitybar-manager-item'
                                            + (draggedButtonId === button.id ? ' is-dragging' : '')
                                        }
                                        onDragEnd={() => setDraggedButtonId('')}
                                        onDragOver={(event) => event.preventDefault()}
                                        onDrop={(event) => handleDrop(event, index)}
                                    >
                                        <button
                                            className="activitybar-manager-grip"
                                            type="button"
                                            title="Arrastra para reordenar"
                                            aria-label={'Arrastrar ' + button.label}
                                            tabIndex={-1}
                                            draggable="true"
                                            onDragStart={(event) => handleDragStart(event, button.id)}
                                        >
                                            <FaIcon name="arrows"/>
                                        </button>

                                        <div className="activitybar-manager-preview">
                                            <FaIcon name={button.icon}/>
                                        </div>

                                        <div className="activitybar-manager-item-main">
                                            <input
                                                className="activitybar-manager-label"
                                                type="text"
                                                maxLength={48}
                                                aria-label={'Nombre del botón ' + (index + 1)}
                                                value={button.label}
                                                onChange={(event) => onUpdateButton(button.id, {
                                                    label: event.target.value
                                                })}
                                            />
                                            <span
                                                className={unavailable ? 'is-unavailable' : ''}
                                                title={action?.description || button.actionId}
                                            >
                                                {action?.category || 'Acción no registrada'}
                                                {' · '}
                                                {button.actionId}
                                            </span>
                                        </div>

                                        <div className="activitybar-manager-item-actions">
                                            <button
                                                type="button"
                                                title="Seleccionar icono"
                                                aria-label={'Cambiar icono de ' + button.label}
                                                aria-pressed={iconTargetId === button.id}
                                                onClick={() => {
                                                    setIconTargetId((current) => current === button.id ? '' : button.id);
                                                    setIconSearch('');
                                                }}
                                            >
                                                <FaIcon name="picture-o"/>
                                            </button>
                                            <button
                                                type="button"
                                                title="Subir"
                                                aria-label={'Subir ' + button.label}
                                                disabled={index === 0}
                                                onClick={() => onMoveButton(button.id, index - 1)}
                                            >
                                                <FaIcon name="arrow-up"/>
                                            </button>
                                            <button
                                                type="button"
                                                title="Bajar"
                                                aria-label={'Bajar ' + button.label}
                                                disabled={index === buttons.length - 1}
                                                onClick={() => onMoveButton(button.id, index + 1)}
                                            >
                                                <FaIcon name="arrow-down"/>
                                            </button>
                                            <button
                                                className="is-danger"
                                                type="button"
                                                title="Quitar de ActivityBar"
                                                aria-label={'Quitar ' + button.label}
                                                onClick={() => {
                                                    onRemoveButton(button.id);
                                                    if (iconTargetId === button.id) setIconTargetId('');
                                                }}
                                            >
                                                <FaIcon name="trash"/>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {editingButton && (
                        <div className="activitybar-manager-icon-picker">
                            <div className="activitybar-manager-icon-picker-heading">
                                <strong>Icono para: {editingButton.label}</strong>
                                <button type="button" onClick={() => setIconTargetId('')}>
                                    Cerrar
                                </button>
                            </div>
                            <input
                                type="search"
                                value={iconSearch}
                                placeholder="Buscar iconos Font Awesome 4…"
                                aria-label="Buscar iconos Font Awesome 4"
                                onChange={(event) => setIconSearch(event.target.value)}
                            />
                            <div className="activitybar-manager-icon-grid">
                                {filteredIcons.map((name) => (
                                    <button
                                        key={name}
                                        type="button"
                                        className={editingButton.icon === name ? 'is-selected' : ''}
                                        title={'fa-' + name}
                                        aria-label={'Seleccionar icono ' + name}
                                        aria-pressed={editingButton.icon === name}
                                        onClick={() => {
                                            onUpdateButton(editingButton.id, { icon: name });
                                            setIconTargetId('');
                                        }}
                                    >
                                        <FaIcon name={name}/>
                                        <span>{name}</span>
                                    </button>
                                ))}
                            </div>
                            <div className="activitybar-manager-icon-count">
                                {filteredIcons.length === 0
                                    ? 'No se encontraron iconos.'
                                    : 'Mostrando ' + filteredIcons.length + ' de '
                                        + FA4_ICON_NAMES.filter((name) => (
                                            !iconSearch.trim()
                                            || name.includes(iconSearch.trim().toLocaleLowerCase())
                                        )).length + ' coincidencias. Escribe para filtrar.'}
                            </div>
                        </div>
                    )}
                </section>

                <section className="activitybar-manager-section activitybar-manager-add">
                    <div className="activitybar-manager-section-heading">
                        <strong>Añadir botón</strong>
                        <span>Acciones registradas en CrayonShell</span>
                    </div>
                    <div className="activitybar-manager-add-row">
                        <select
                            value={actionToAdd}
                            disabled={availableActions.length === 0}
                            aria-label="Acción que se añadirá a ActivityBar"
                            onChange={(event) => setActionToAdd(event.target.value)}
                        >
                            {availableActions.length === 0 ? (
                                <option value="">No hay más acciones disponibles</option>
                            ) : availableActions.map((action) => (
                                <option key={action.id} value={action.id}>
                                    {action.category} · {action.label}
                                </option>
                            ))}
                        </select>
                        <button
                            type="button"
                            className="activitybar-manager-primary"
                            disabled={!actionToAdd}
                            onClick={handleAddAction}
                        >
                            <FaIcon name="plus"/> Añadir
                        </button>
                    </div>
                    <p className="activitybar-manager-note">
                        Solo se pueden añadir acciones registradas. Las funciones nuevas se incorporan
                        al catálogo desde su módulo, no desde archivos de configuración.
                    </p>
                </section>

                <section className="activitybar-manager-section">
                    <div className="activitybar-manager-section-heading">
                        <strong>Configuración</strong>
                        <span>Versión 1</span>
                    </div>
                    <div className="activitybar-manager-config-actions">
                        <button type="button" onClick={onRestoreDefaults}>
                            <FaIcon name="undo"/> Restaurar predeterminados
                        </button>
                        <button type="button" onClick={handleExport}>
                            <FaIcon name="download"/> Exportar JSON
                        </button>
                        <button type="button" onClick={() => fileInputRef.current?.click()}>
                            <FaIcon name="upload"/> Importar JSON
                        </button>
                        <input
                            ref={fileInputRef}
                            className="activitybar-manager-file-input"
                            type="file"
                            accept=".json,application/json"
                            onChange={handleImportFile}
                        />
                    </div>
                    {importMessage && (
                        <p className="activitybar-manager-import-message" role="status">
                            {importMessage}
                        </p>
                    )}
                </section>

                <footer className="activitybar-manager-footer">
                    <span>El botón de administración permanece fijo en la parte inferior de ActivityBar.</span>
                    <button type="button" onClick={onClose}>Listo</button>
                </footer>
            </div>
        </dialog>
    );
}
