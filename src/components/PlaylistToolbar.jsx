export default function PlaylistToolbar({
    playlists,
    activePlaylistGuid,
    filter,
    onFilterChange,
    onPlaylistChange
}) {
    return (
        <header className="playlist-toolbar" aria-label="Controles de playlist">
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
        </header>
    );
}
