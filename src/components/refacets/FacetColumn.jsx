export default function FacetColumn({
    title,
    items,
    selectedValues,
    onSelect,
    onClear,
    onContextMenu,
    emptyMessage,
    showCount = true,
    showHeader = true
}) {
    const selected = new Set(selectedValues);
    const selectedCount = selectedValues.length;
    const column = title === 'Years' ? 'year' : 'subfolder';
    const openMenu = (event, item = null) => {
        event.preventDefault();
        onContextMenu?.(event, column, item?.value || selectedValues[0] || null);
    };

    return (
        <section
            className="facet-column"
            aria-label={title}
            onContextMenu={(event) => {
                if (event.target.closest('.facet-item')) return;
                openMenu(event);
            }}
        >
            {showHeader && (
                <header className="facet-column-heading" onContextMenu={openMenu}>
                    <strong>{title}</strong>
                    {showCount && <span>{items.length.toLocaleString('es-MX')}</span>}
                    {selectedCount > 0 && (
                        <button
                            type="button"
                            className="facet-clear-button"
                            title={'Limpiar selección de ' + title}
                            aria-label={'Limpiar selección de ' + title}
                            onClick={onClear}
                        >
                            ×
                        </button>
                    )}
                </header>
            )}

            <div className="facet-items" role="listbox" aria-label={title} aria-multiselectable="true">
                {items.length === 0 ? (
                    <div className="facet-empty">{emptyMessage}</div>
                ) : items.map((item) => {
                    const isSelected = selected.has(item.value);
                    return (
                        <button
                            key={item.value}
                            type="button"
                            className={'facet-item' + (isSelected ? ' is-selected' : '')}
                            role="option"
                            aria-selected={isSelected}
                            title={item.label}
                            onClick={(event) => onSelect(
                                item.value,
                                event.ctrlKey || event.metaKey
                            )}
                            onContextMenu={(event) => openMenu(event, item)}
                        >
                            <span className="facet-item-label">{item.label}</span>
                            {showCount && (
                                <span className="facet-item-count">
                                    {item.count.toLocaleString('es-MX')}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
