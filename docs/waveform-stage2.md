# Waveform — etapa 2: integración con PlaybackClock y eventos de reproducción

La etapa 2 conecta el motor progresivo de la etapa 1 con el ciclo de reproducción real de foobar2000. No añade todavía la seekbar visual ni modifica los controles del reproductor.

## Responsabilidades

- `WaveformPlaybackController` crea y libera el motor y el `PlaybackClock` en un único ciclo de vida.
- Al iniciarse, se suscribe primero a los eventos y después consulta la pista cargada. Si llega un `playback:trackChanged` durante esa lectura inicial, el evento más reciente prevalece sobre la respuesta anterior.
- Cada `playback:trackChanged` cambia automáticamente la pista del motor; ya no es necesario volver a llamar manualmente a `start()` después de cambiar canción.
- `PlaybackClock` mantiene la posición estimada usando las actualizaciones de alta resolución, los seeks, los cambios de estado y los cambios de pista del SDK.
- Los eventos `playback:timeHighRes` avanzan la prioridad del scheduler únicamente al cruzar un límite de segmento. No se fuerza una replanificación en cada tick de aproximadamente 100 ms.
- Los cambios discontinuos de posición (`seek` y `resync`) actualizan la prioridad inmediatamente.
- Pausar o detener el transporte no elimina la waveform de la pista que continúa cargada. Un cambio de pista o la ausencia de pista local sí sustituye o limpia la waveform.
- `dispose()` quita todos los listeners y libera reloj y motor.

## API pública del controlador

```javascript
const controller = new WaveformPlaybackController({
    sdk,
    onSegment(segment) {},
    onUpdate(update) {},
    onError(error, context) {}
});

await controller.start();
controller.getPosition();
controller.getSnapshot();
await controller.resync();
controller.dispose();
```

El controlador no llama a `player.seek()` ni altera la reproducción. `getPosition()` devuelve la estimación del PlaybackClock para que la futura capa visual pueda leerla en cada `requestAnimationFrame` sin sondear el host.

## Prueba dentro de foobar2000

Carga CrayonShell desde Vite, abre DevTools y ejecuta:

```javascript
await window.__crayonshellWaveformStage2.start()
window.__crayonshellWaveformStage2.status()
window.__crayonshellWaveformStage2.position()
```

Con el controlador iniciado:

1. Cambia de canción desde foobar2000. La pista del motor debe cambiar automáticamente y cancelar cualquier análisis obsoleto.
2. Haz seek hacia otra zona de la canción. El scheduler debe priorizar el nuevo segmento.
3. Deja reproducir la pista. La prioridad debe avanzar al cruzar límites de segmento, sin registrar una llamada por cada tick de posición.
4. Pausa y reanuda. La waveform debe conservarse y el reloj debe reflejar el estado correcto.
5. Detén la reproducción. La waveform de la pista cargada se conserva.
6. Ejecuta `await window.__crayonshellWaveformStage2.resync()` para forzar una lectura coherente de estado y posición.
7. Libera la integración con `window.__crayonshellWaveformStage2.stop()`.

La consola registra segmentos mediante `[CrayonShell Waveform Stage 2]`. El método `status()` devuelve el estado del reloj, la posición estimada, la clave de pista, el estado del scheduler y los últimos segmentos procesados.

## Límites de esta etapa

- El controlador y sus diagnósticos quedan disponibles, pero todavía no se montan automáticamente en `App.jsx`. El montaje de producción se hará junto con la seekbar visual para no iniciar una decodificación PCM de fondo antes de que exista un consumidor.
- La seekbar aún no dibuja segmentos, cursor ni tiempos.
- La prioridad de reproducción solo cambia al cruzar segmentos o al producirse un seek/resync. La lectura fluida para el cursor debe usar `PlaybackClock.position()` directamente desde la futura capa visual.
- La política LRU y el presupuesto global de la caché continúan pendientes.


## Sincronización sin carreras

El controlador registra los listeners antes de leer la pista inicial. Si foobar2000 cambia de canción durante esa lectura, la respuesta inicial se descarta y prevalece el evento más reciente. Al recibir un cambio de pista, cancela y limpia de inmediato el análisis anterior antes de resolver la nueva pista local; un error o una fuente no local no deja visible la waveform anterior como si perteneciera a la pista nueva.
