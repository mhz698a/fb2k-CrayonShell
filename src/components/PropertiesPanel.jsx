import { TRACK_PROPERTY_GROUPS } from '../services/trackProperties.js';
import {
    formatFileSize,
    formatWindowsTimestamp
} from '../services/windowsFileMetadataFormat.js';

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
    error,
    fileMetadata,
    fileMetadataLoading,
    fileMetadataError
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
                                ['Tamaño', formatFileSize(fileMetadata?.fileSizeBytes)],
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
                        <h3>Fechas de Windows</h3>
                        {fileMetadataLoading && (
                            <div className="properties-loading">Leyendo fechas y tamaño del archivo…</div>
                        )}
                        {fileMetadataError && (
                            <div className="properties-error" role="status">{fileMetadataError}</div>
                        )}
                        <dl>
                            {[
                                ['Creación', 'creationTime'],
                                ['Último acceso', 'lastAccessTime'],
                                ['Última modificación (mtime)', 'lastWriteTime'],
                                ['Cambio NTFS (ctime)', 'changeTime']
                            ].map(([label, key]) => {
                                const timestamp = fileMetadata?.timestamps?.[key];
                                const formatted = formatWindowsTimestamp(timestamp);
                                return (
                                    <div className="properties-row" key={key}>
                                        <dt>{label}</dt>
                                        <dd title={formatted}>{formatted}</dd>
                                    </div>
                                );
                            })}
                        </dl>
                        <p className="properties-pending-note">
                            ctime muestra ChangeTime de Windows/NTFS, no la fecha de creación.
                            Es de solo lectura. mtime corresponde a LastWriteTime.
                        </p>
                    </section>
                </div>
            )}
        </aside>
    );
}
