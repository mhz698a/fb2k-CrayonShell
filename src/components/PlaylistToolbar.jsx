export default function PlaylistToolbar({
    playlists,
    activePlaylistGuid,
    filter,
    summary,
    onFilterChange,
    onPlaylistChange,
    contentView,
    propertiesVisible,
    onToggleProperties,
    onExecuteAction
}) {
    return (
        <header className="playlist-toolbar">
            <div className="playlist-heading">
                <strong>Playlist</strong>
                <span id="PlaylistSummary">{summary}</span>
            </div>

            <button
                id="MediaViewToggle"
                className="toolbar-action"
                type="button"
                aria-label={contentView === 'playlist' ? 'Mostrar visor de video' : 'Mostrar playlist'}
                aria-pressed={contentView === 'video'}
                title={contentView === 'playlist' ? 'Mostrar visor de video' : 'Mostrar playlist'}
                onClick={() => onExecuteAction('ui.toggleContentView')}
            >
                {contentView === 'playlist' ? 'Video' : 'Playlist'}
            </button>

            <select
                id="PlaylistPicker"
                aria-label="Seleccionar playlist"
                value={activePlaylistGuid}
                disabled={playlists.length === 0}
                onChange={(event) => onPlaylistChange(event.target.value)}
            >
                {playlists.map((playlist) => (
                    <option key={playlist.guid} value={playlist.guid}>
                        {playlist.name + ' (' + playlist.trackCount + ')'}
                    </option>
                ))}
            </select>

            <input
                id="PlaylistFilter"
                type="search"
                placeholder="Filtrar pistas…"
                aria-label="Filtrar pistas"
                value={filter}
                onChange={(event) => onFilterChange(event.target.value)}
            />

            <button
                id="PlaylistRefresh"
                type="button"
                title="Actualizar playlist"
                aria-label="Actualizar playlist"
                onClick={() => onExecuteAction('playlist.refresh')}
            >
                ↻
            </button>

            <button
                id="PropertiesToggle"
                className={'toolbar-action properties-toolbar-action'
                    + (propertiesVisible ? ' is-active' : '')}
                type="button"
                aria-label={propertiesVisible ? 'Ocultar propiedades' : 'Mostrar propiedades'}
                aria-pressed={propertiesVisible}
                title={propertiesVisible ? 'Ocultar propiedades' : 'Mostrar propiedades'}
                onClick={onToggleProperties}
            >
                Propiedades
            </button>

            <button
                id="MediaDiagnostics"
                className="toolbar-action diagnostics-toolbar-action"
                type="button"
                title="Abrir diagnóstico multimedia"
                aria-label="Abrir diagnóstico multimedia"
                onClick={() => onExecuteAction('diagnostics.open')}
            >
                Diagnóstico
            </button>
        </header>
    );
}
