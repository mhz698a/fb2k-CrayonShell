export default function PlaylistToolbar({
    playlists,
    activePlaylistGuid,
    filter,
    summary,
    onFilterChange,
    onPlaylistChange,
    onRefresh,
    sidebarCollapsed,
    onToggleSidebar
}) {
    return (
        <header className="playlist-toolbar">
            <button
                id="SidebarToggle"
                className="sidebar-toggle"
                type="button"
                aria-controls="LeftSidebar"
                aria-expanded={!sidebarCollapsed}
                aria-label={sidebarCollapsed ? 'Mostrar panel lateral' : 'Ocultar panel lateral'}
                title={sidebarCollapsed ? 'Mostrar panel lateral' : 'Ocultar panel lateral'}
                onClick={onToggleSidebar}
            >
                ☰
            </button>

            <div className="playlist-heading">
                <strong>Playlist</strong>
                <span id="PlaylistSummary">{summary}</span>
            </div>

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
                onClick={onRefresh}
            >
                ↻
            </button>
        </header>
    );
}
