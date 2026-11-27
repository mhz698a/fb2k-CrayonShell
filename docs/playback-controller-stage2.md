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

## Inicialización y sincronización incremental

- Al montar CrayonShell se hace una sola lectura completa de la playlist activa. La restauración de selección y foco no dispara una segunda lectura de contenido.
- Al iniciar, la selección prioriza la pista en reproducción si pertenece a la playlist activa; después usa la última pista enfocada persistida y, como último recurso, el foco nativo.
- La selección automática de la pista en reproducción queda protegida por identidad hasta que el usuario elige otra fila desde CrayonShell.
- Los eventos nativos de foco que contradicen esa selección protegida no pueden reemplazarla con un índice obsoleto; la protección sigue a la misma pista si la playlist se reordena y se libera si la pista desaparece.
- Los cambios manuales de selección liberan la protección y vuelven a sincronizar el foco normalmente.
- Los eventos de selección y foco actualizan el estado de navegación sin recargar los elementos.
- Los eventos de reproducción consultan únicamente el estado de reproducción y la pista actual. No vuelven a leer el contenido de la playlist.
- Los eventos de altas, bajas, reordenamientos y reemplazos ejecutan una reconciliación incremental: se consulta el identificador `handle` y se conserva cada fila que continúa presente, actualizando su índice.
- Solo las filas nuevas o sustituidas se hidratan mediante `playlist.getTracksAt` para recuperar sus formatos y metadatos.
- La reconciliación verifica `contentVersion` entre la lectura de identificadores y la hidratación. Si el contenido cambia durante el proceso, descarta esa instantánea y la vuelve a leer en lugar de mezclar versiones.
- El botón **Actualizar playlist** conserva la recarga completa explícita. La carga inicial y los eventos ordinarios no invocan esa operación completa.

## Fuera de alcance

- No se agrega todavía el botón Active Now Playing.
- No se cambia el modo de orden ni la playlist activa.
- No se agregan controles de reproducción ni se altera Waveform o DSP Auto Preset.

## Pruebas

`src/utils/trackIdentity.test.js` cubre rutas Windows, file URLs, UNC, subsongs, índice nativo prioritario, fallback entre playlists, handles duplicados y estado Stopped.

`src/utils/playlistReconciliation.test.js` cubre conservación de filas sin cambios, altas, bajas, sustituciones, handles repetidos, snapshots obsoletos y prioridad de selección inicial.


## Refactor de activación y restauración nativa

- La restauración al cambiar de playlist usa la ubicación exacta de `playback.getCurrentTrackIndex`: GUID de origen e índice de fila. No hace coincidencias por ruta/handle entre playlists para decidir la selección de activación.
- Antes de escribir, comprueba con `playlist.getActive` que el GUID solicitado sigue siendo la playlist activa.
- La selección y el foco nativos se escriben por separado y se leen de vuelta por separado; un resultado discrepante queda registrado en la consola con el prefijo `[CrayonShell][playlist-activation]`.
- La protección automática observa tanto `playlist:focusChanged` como `playlist:selectionChanged`. Si foobar2000 restaura una selección/foco anterior, ambos estados se vuelven a reconciliar con la pista protegida.
- El evento `playlist:activated` se resuelve primero por su `newIndex`; el indicador `isActive` queda como fallback para evitar elegir la playlist anterior si la lectura llega durante el despacho del evento.
- La selección manual desde CrayonShell libera la protección automática.
