# Playback Controller — Etapa 1

## Objetivo

Centralizar el estado y las operaciones de reproducción de CrayonShell mediante la API pública `fb.player` de `foo-webview-sdk`. Esta etapa no agrega controles visuales; prepara el contrato que consumirán Playback Bar y StatusBar.

## Arquitectura

- `src/features/playback/playbackController.js`: controlador independiente de React, suscripciones nativas, snapshot inicial y acciones.
- `src/hooks/usePlaybackController.js`: adaptador React que expone el estado y las acciones del controlador.
- `src/App.jsx`: monta el hook en la raíz para mantener un único controlador activo durante la vida de la interfaz.
- `src/features/playback/playbackController.test.js`: pruebas unitarias con un SDK simulado.

## Estado publicado

- `connectionState`: `disconnected`, `connecting`, `ready`, `degraded` o `unavailable`.
- `available` e `initialized`.
- `playbackState`: `playing`, `paused`, `stopped` o `opening`.
- Pista actual y ruta (`currentTrack`, `currentTrackPath`).
- Playback Order (`order.index`, `order.name`, `orderKnown`).
- Stop after current y su indicador de disponibilidad.
- Volumen lineal, volumen en dB, mute y disponibilidad de la lectura.
- Acciones pendientes, errores parciales de inicialización y último error de acción.

## Acciones preparadas

- `play()`, `pause()`, `playPause()`, `previous()`, `stopPlayback()`, `next()`, `playRandom()`.
- `setPlaybackOrder(order)`.
- `setStopAfterCurrent(enabled)`, `toggleStopAfterCurrent()`.
- `setVolume(volume)`, `setMuted(muted)`, `toggleMute()`, `volumeUp()`, `volumeDown()`.
- `refresh()` para volver a consultar el snapshot nativo.

Las órdenes admitidas por este contrato inicial son `default`, `repeat`, `repeat-track` y `random`. Los modos Shuffle adicionales del host no se incluyen en el selector de cuatro alternativas planeado.

## Sincronización y ciclo de vida

1. El controlador registra los eventos antes de consultar el snapshot inicial.
2. Lee en paralelo estado, pista, orden, Stop after current y volumen.
3. Cada campo mantiene una revisión independiente. Si llega un evento mientras su lectura inicial está pendiente, el resultado antiguo de ese campo se descarta.
4. Un fallo de lectura no bloquea los demás campos; el estado pasa a `degraded` y conserva el detalle del fallo.
5. El hook de React usa referencias de inicio para evitar detener las suscripciones mientras permanezca algún consumidor montado.
6. La última liberación retira todos los listeners.

Eventos utilizados:

- `playback:stateChanged`
- `playback:paused`
- `playback:stopped`
- `playback:starting`
- `playback:trackChanged`
- `playback:volumeChanged`
- `playback:orderChanged`
- `playback:stopAfterCurrentChanged`

## Decisiones de integración

- El controlador invoca directamente los métodos públicos `fb.player`; no introduce comandos de Bridge nuevos.
- Las acciones son independientes de la interfaz y se pueden probar con un SDK falso.
- El controlador no altera la playlist, selección, DSP Auto Preset ni PlaybackClock.
- La distribución visual de los controles se realizará en etapas posteriores. Todos los controles de transporte (Play/Pause, Previous, Stop, Next, Play Random, Stop after current y Playback Order) permanecerán agrupados a la izquierda de una misma Playback Bar; el control de volumen irá al extremo derecho de esa misma fila.

## Validación

- `npm test`
- `npm run build`
- Prueba manual dentro de foobar2000/WebView2 para confirmar el snapshot y la recepción de eventos nativos.
