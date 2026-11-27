# Active Now Playing — Etapa 2

## Objetivo

Identificar la pista realmente cargada por foobar2000 dentro de la playlist activa de CrayonShell, aunque el índice nativo pertenezca a otra playlist, y centrar su fila en el viewport.

## Resolución de identidad

`src/utils/trackIdentity.js` implementa:

- Normalización de rutas Windows, separadores y mayúsculas/minúsculas.
- Conversión de URI `file://` a ruta local y decodificación de caracteres escapados.
- Normalización de rutas UNC.
- Comparación de sufijos subsong cuando ambos extremos los publican.
- Resolución con prioridad: índice nativo dentro de la playlist activa > handle coincidente > ruta normalizada.

El índice nativo se valida contra los elementos realmente cargados en la playlist. Cuando foobar2000 informa otra playlist, CrayonShell busca la pista actual por handle o ruta en la playlist activa.

## Integración

- `usePlaylist` consulta `playback.getCurrentTrack()` además del índice y el estado nativos.
- Una falla de `getCurrentTrack` no interrumpe la lectura de la playlist; el índice nativo sigue disponible como fallback.
- El resultado resuelto alimenta `playingItemIndex`, por lo que la fila usa el indicador `playing` existente.
- Al recibir `playlist:activated`, si la pista actual pertenece a la playlist activada, CrayonShell también la selecciona y establece el foco nativo sobre esa fila.
- La selección se sincroniza al regresar o activar una playlist; los cambios normales de canción no sobrescriben una selección manual que el usuario esté realizando en la playlist activa.
- Mantener la pista seleccionada y enfocada permite conservar la posición de la lista cuando la reproducción termina y el estado deja de ser `playing`.
- El mock de desarrollo expone la misma consulta para permitir validación en Vite.

## Seguimiento del viewport

- Cuando cambia la pista en reproducción, la fila se centra verticalmente en el viewport de la playlist.
- La activación de otra playlist centra la fila de la pista en reproducción y, si existe en esa playlist, la selecciona y enfoca.
- Los cambios de foco continúan usando el desplazamiento mínimo que mantiene visible la fila enfocada.
- El desplazamiento automático por sí solo no modifica el filtro ni la selección; la sincronización de selección ocurre únicamente al activar una playlist con la pista actual presente.
- Si el filtro oculta la pista actual, el seguimiento automático no cambia el filtro. La acción manual Active Now Playing de la Playback Bar se implementará en una etapa posterior.

## Fuera de alcance

- No se agrega todavía el botón Active Now Playing.
- No se cambia el modo de orden ni la playlist activa.
- No se agregan controles de reproducción ni se altera Waveform o DSP Auto Preset.

## Pruebas

`src/utils/trackIdentity.test.js` cubre rutas Windows, file URLs, UNC, subsongs, índice nativo prioritario, fallback entre playlists, handles duplicados y estado Stopped.
