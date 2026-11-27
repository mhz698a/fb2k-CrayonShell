# Waveform — etapa 3: seekbar inferior en una sola fila

La etapa 3 conecta el controlador con una barra de reproducción compacta, ubicada fuera y debajo de `.cui-container`. Ocupa todo el ancho de la ventana y permanece disponible en las vistas Playlist y Video.

## Disposición

La seekbar se monta como hermana de `.cui-container`, dentro de `.app-shell`, por lo que queda debajo de toda el área de trabajo: ActivityBar, sidebar, panel principal e inspector de propiedades. No muestra título ni artista.

De izquierda a derecha:

1. Tiempo transcurrido de la pista que está reproduciéndose.
2. Waveform seekbar, que ocupa todo el espacio horizontal restante.
3. Tiempo restante y duración total, en el formato `−restante / total`.

La altura del canvas se controla desde la variable CSS global:

```css
:root {
    --waveform-seekbar-height: 25px;
}
```

Cambia `34px` por el alto requerido. Por ejemplo, `42px` aumenta los picos y `26px` los reduce. La fila añade 10 px de espacio vertical para su alineación y padding.

## Waveform de audio y video

El motor utiliza `audio.decodePcm()` con el decodificador de entrada de foobar2000. Para archivos de video locales comunes (MP4, MKV, MOV, AVI, WebM, WMV, MPEG, TS, M2TS, entre otros) intenta extraer y analizar el audio que exponga el decodificador.

- Si el contenedor de video tiene una pista de audio compatible, se dibuja su waveform progresivamente.
- Si el video no contiene audio, el códec no se puede decodificar o el decoder de entrada no está disponible, la zona de picos queda vacía y se informa el estado en el tooltip del canvas.
- Las fuentes remotas o rutas no locales no se envían al decoder PCM local.
- La ausencia de PCM no deshabilita la búsqueda. La interacción usa el estado de reproducción `canSeek` y la duración del `PlaybackClock`/pista actual, no la identidad o el éxito del waveform.
- Si `audio.decodePcm()` no existe en la versión instalada del SDK, el controlador usa un motor vacío y conserva el seek nativo.

Un video sin pista de audio no puede producir una waveform de audio. La barra, sin embargo, continúa funcionando como seekbar cuando foobar2000 informa que esa pista admite búsqueda.

## Visualización

- `WaveformSeekbar.jsx` dibuja picos Peak de segmentos disponibles en canvas.
- Cada segmento aparece cuando termina su decodificación o lectura de caché; los huecos permanecen vacíos.
- El cursor consulta `PlaybackClock.position()` y se anima durante la reproducción, arrastre o seek.
- Si no hay waveform, se dibuja la línea temporal base y el cursor; el área sigue siendo interactiva cuando `canSeek` está habilitado.
- Los tiempos actual, restante y total usan `mm:ss`, o `h:mm:ss` para duraciones de una hora o más.
- El arrastre realiza una sola llamada `player.seek()` al soltar; el teclado permite flechas, Shift + flechas, PageUp/PageDown y Home/End.

## Prueba en foobar2000

1. Reproduce un archivo local FLAC o WAV. Confirma que la fila aparece debajo de toda la interfaz, ocupa el ancho completo de la ventana y el waveform se llena por segmentos.
2. Comprueba que a la izquierda avanza el tiempo actual y a la derecha se muestran el restante y la duración total.
3. Arrastra el centro de la fila y verifica que la reproducción salta al soltar.
4. Prueba el teclado, pausa y reanudación.
5. Reproduce un video local con audio (por ejemplo MP4 o MKV) y confirma que se analiza el audio del contenedor.
6. Reproduce un video sin pista de audio o con un códec no compatible. El waveform puede quedar vacío, pero el seek debe seguir funcionando si `canSeek` es verdadero.
7. Prueba una fuente remota sin PCM local; la búsqueda debe seguir disponible cuando el host la permita.
8. Cambia entre Playlist y Video: la fila permanece montada y no recrea el controlador.
9. Cambia de canción y confirma que los picos de la pista anterior desaparecen.

## Límites

- La política LRU, el presupuesto total de disco y la limpieza automática de archivos huérfanos siguen pendientes.
- No hay todavía preferencias de altura o estilo en los ajustes de CrayonShell; el alto se modifica mediante `--waveform-seekbar-height` en `src/styles/main.css`.
- Los formatos de video que no tengan un decoder de entrada compatible en foobar2000 no producirán PCM, pero no bloquean el seek.
