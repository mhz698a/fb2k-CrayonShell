import { TRACK_PROPERTY_GROUPS } from '../services/trackProperties.js';

function displayValue(value) {
    if (value === null || value === undefined) return '';
    const text = String(value).trim();
    return text && text !== '?' ? text : '';
}

function PropertySection({ title, fields, values }) {
    const rows = fields
        .map(([label, key]) => [label, displayValue(values?.[key])])
        .filter(([, value]) => value);

    if (rows.length === 0) return null;

    return (
        <section className="properties-section">
            <h3>{title}</h3>
            <dl>
                {rows.map(([label, value]) => (
                    <div className="properties-row" key={label}>
                        <dt>{label}</dt>
                        <dd title={value}>{value}</dd>
                    </div>
                ))}
            </dl>
        </section>
    );
}

export default function PropertiesPanel({
    selectedItem,
    properties,
    loading,
    error
}) {
    const values = properties?.formats || {};
    const path = properties?.path || selectedItem?.path || '';
    const title = displayValue(values.title)
        || displayValue(selectedItem?.title)
        || (path ? path.split(/[\\/]/).pop() : 'Pista seleccionada');

    return (
        <aside className="properties-panel" aria-label="Propiedades de la pista">
            <header className="properties-panel-heading">
                <div>
                    <strong>PROPIEDADES</strong>
                    <span>{selectedItem ? 'Pista seleccionada' : 'Sin selección'}</span>
                </div>
            </header>

            {!selectedItem && (
                <div className="properties-empty">
                    Selecciona una pista de la playlist para consultar sus propiedades
                </div>
            )}

            {selectedItem && (
                <div className="properties-panel-content">
                    <div className="properties-track-heading">
                        <strong title={title}>{title}</strong>
                        <span>{displayValue(values.artist) || displayValue(selectedItem.artist) || 'Artista desconocido'}</span>
                    </div>

                    {loading && <div className="properties-loading">Leyendo propiedades…</div>}
                    {error && <div className="properties-error" role="status">{error}</div>}

                    {TRACK_PROPERTY_GROUPS.map((group) => (
                        <PropertySection
                            key={group.id}
                            title={group.title}
                            fields={group.fields}
                            values={values}
                        />
                    ))}

                    <section className="properties-section">
                        <h3>Archivo</h3>
                        <dl>
                            {[
                                ['Ubicación', path],
                                ['Extensión', displayValue(values.extension)],
                                ['Identificador de pista', displayValue(properties?.handle)]
                            ].filter(([, value]) => value).map(([label, value]) => (
                                <div className="properties-row properties-row-stacked" key={label}>
                                    <dt>{label}</dt>
                                    <dd title={value}>{value}</dd>
                                </div>
                            ))}
                        </dl>
                    </section>

                    <section className="properties-section">
                        <h3>Fechas del archivo</h3>
                        <div className="properties-pending">
                            <strong>Servicio local pendiente de conexión</strong>
                            <span>
                                Las fechas de creación, último acceso y última modificación se leerán
                                desde Windows mediante foo_crayonshell_bridge. La edición se habilitará
                                después de completar el enlace autenticado con WebView2.
                            </span>
                        </div>
                    </section>
                </div>
            )}
        </aside>
    );
}
