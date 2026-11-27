# Waveform — etapa 3: seekbar visual e interacción

La etapa 3 conecta el controlador de reproducción con una primera interfaz de waveform dentro de CrayonShell.

## Ubicación

La seekbar se monta debajo de `PlaylistToolbar` en la vista Playlist. No aparece en la vista de video y no modifica el panel de propiedades ni los controles nativos de foobar2000.

## Visualización

- `WaveformSeekbar.jsx` dibuja los picos Peak de los segmentos disponibles en un canvas.
- Cada segmento aparece tan pronto como el motor lo decodifica o lo recupera de la caché; los huecos permanecen vacíos hasta que terminan de procesarse.
- Los segmentos se conservan en memoria mientras la pista permanece activa. Un cambio de identidad limpia inmediatamente los segmentos anteriores.
- La posición del cursor procede de `PlaybackClock.position()`. El canvas anima el cursor mientras se reproduce o durante una operación de seek; detenido o pausado, no mantiene un ciclo de dibujo continuo.
- Los tiempos actual y total usan `mm:ss`, o `h:mm:ss` para pistas de una hora o más.
- La etiqueta de estado informa el progreso por segmentos y los errores del motor.

## Interacción

- Arrastrar el waveform permite previsualizar la posición sin enviar solicitudes al host durante cada movimiento.
- Al soltar el puntero se realiza un único `player.seek(target)` y después el controlador sincroniza de nuevo el PlaybackClock.
- Se respeta `canSeek` del SDK. Cuando el host informa que la pista no permite búsqueda, el control queda deshabilitado.
- El teclado permite desplazamientos de 5 segundos, 15 segundos con Shift, 10 % con PageUp/PageDown y saltos Home/End.
- La posición se limita al intervalo de la pista.

## Fuentes compatibles

El análisis PCM automático se limita a archivos locales de audio con ruta Windows y extensión reconocida por el controlador. Primero se resuelve la ruta nativa del handle o de `absolutePath`; si el SDK solo entrega un URI `file://`, se convierte a una ruta local Windows validada. No se intenta decodificar video ni flujos remotos como si fueran archivos de audio locales. Los formatos no admitidos dejan la zona de waveform sin datos y no bloquean la reproducción.

## Prueba en foobar2000

1. Carga CrayonShell dentro de foobar2000.
2. Reproduce un archivo local de audio compatible.
3. Confirma que la seekbar aparece debajo de `PlaylistToolbar` y que se dibujan segmentos progresivamente.
4. Deja reproducir y comprueba que el cursor se desplaza suavemente y el tiempo actual avanza.
5. Arrastra el waveform a una zona posterior y suelta. La reproducción debe saltar a esa posición.
6. Usa las flechas izquierda/derecha, PageUp/PageDown, Home y End cuando la pista admita seek.
7. Pausa y reanuda; el cursor debe detenerse y continuar sin reiniciar la waveform.
8. Cambia de canción. Los picos de la pista anterior deben desaparecer y el nuevo waveform debe empezar a llenarse.
9. Cambia a la vista de video. La seekbar se desmonta y libera el controlador.
10. Reproduce un archivo de video o una fuente no local desde la vista Playlist. No debe iniciarse la decodificación PCM de waveform para esa fuente.

## Límites

- La política LRU, el límite total de disco y la limpieza automática de archivos huérfanos siguen pendientes.
- La seekbar es una primera implementación funcional; no incluye todavía preferencias de altura, estilo de pico ni densidad.
- La disponibilidad real de `audio.decodePcm()` y shared buffers depende de la versión instalada del runtime de WebView2/foobar2000. El motor informa el error en la interfaz sin interferir con la reproducción.
