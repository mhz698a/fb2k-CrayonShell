# Waveform — etapa 1: motor progresivo y caché por segmentos

La etapa 1 añade el motor que utiliza la decodificación PCM validada en la etapa 0. Todavía no dibuja la seekbar ni se conecta automáticamente a los eventos de reproducción; esa integración se mantiene separada.

## Arquitectura implementada

- \`waveformIdentity.js\`: identifica archivos locales por ruta, subsong, duración, tamaño y fecha de modificación.
- \`waveformDecoder.js\`: decodifica rangos con \`audio.decodePcm()\`, calcula picos Peak lineales en un Worker y divide recursivamente un rango si el host lo devuelve truncado.
- \`waveformCacheFormat.js\`: codifica/valida el formato binario versionado de cada segmento.
- \`waveformCache.js\`: conserva un archivo de segmento independiente y un manifiesto actualizado atómicamente.
- \`waveformScheduler.js\`: permite una sola decodificación activa, prioriza el segmento actual y los siguientes, y cancela trabajo distante u obsoleto.
- \`waveformEngine.js\`: une identidad, caché, decoder y scheduler.

## Probar en foobar2000

Carga CrayonShell desde Vite en el panel WebView2, reproduce una pista local y abre DevTools.

Inicia el motor sobre la pista cargada:

\`\`\`javascript
await window.__crayonshellWaveformStage1.start()
\`\`\`

La respuesta informa la duración, el tamaño calculado de segmento, el número total de segmentos y los segmentos que ya aparecen en el manifiesto.

Consulta el estado y los últimos segmentos terminados:

\`\`\`javascript
window.__crayonshellWaveformStage1.status()
\`\`\`

En la consola aparecen entradas \`[CrayonShell Waveform] segment ready\`. Cada entrada indica:

- índice y rango temporal del segmento;
- cantidad de picos generados;
- \`cached: true\` cuando se recuperó del disco;
- profundidad de división si el rango original se devolvió truncado.

## Probar la prioridad después de un seek

Esta llamada cambia únicamente la posición de prioridad del análisis. No mueve la reproducción de foobar2000:

\`\`\`javascript
window.__crayonshellWaveformStage1.setAnalysisPosition(120)
\`\`\`

El scheduler cancela el decode activo si está a más de un segmento de la nueva región y comienza por el segmento solicitado.

## Probar cancelación al cambiar de canción

1. Inicia el motor con una pista larga.
2. Mientras se procesan segmentos, cambia la canción desde foobar2000.
3. Ejecuta otra vez:

\`\`\`javascript
await window.__crayonshellWaveformStage1.start()
\`\`\`

La segunda llamada lee la pista que ahora está cargada y sustituye el trabajo anterior. Los segmentos guardados de la pista anterior permanecen en su caché.

La integración con los eventos de reproducción y el PlaybackClock llegará en la etapa de integración; este diagnóstico cambia el motor manualmente para poder observar la cancelación sin alterar el reproductor.

## Probar la recuperación de caché

1. Deja que el motor genere varios segmentos.
2. Detén el motor:

\`\`\`javascript
window.__crayonshellWaveformStage1.stop()
\`\`\`

3. Inicia otra vez con la misma pista:

\`\`\`javascript
await window.__crayonshellWaveformStage1.start()
\`\`\`

Los segmentos ya guardados se anuncian con \`cached: true\`. Los huecos continúan decodificándose.

## Control adicional

Reintenta segmentos que hayan fallado:

\`\`\`javascript
window.__crayonshellWaveformStage1.retryFailed()
\`\`\`

Detén y libera el motor:

\`\`\`javascript
window.__crayonshellWaveformStage1.stop()
\`\`\`

## Formato y ubicación

La caché vive en el perfil nativo:

\`\`\`text
<perfil foobar2000>\\CrayonShell\\WaveformCache\\v1\\
    <track-key>.wfm
    <track-key>.000000.wfs
    <track-key>.000001.wfs
    <track-key>.000002.wfs
\`\`\`

Cada \`.wfs\` contiene identidad, índice, rango temporal, metadatos PCM y picos lineales Float32. El manifiesto \`.wfm\` enumera únicamente los segmentos que terminaron de escribirse. El archivo de segmento se escribe primero de forma atómica; después se actualiza el manifiesto también de forma atómica. Así, un cierre entre ambas operaciones puede dejar un archivo huérfano, pero nunca un manifiesto que declare completo un segmento que todavía no se guardó.

La identidad incluye la ruta normalizada, el subsong, la duración, el tamaño y la fecha de modificación del archivo. La versión y configuración de resolución/segmentación se validan al abrir el manifiesto.

## Límites de esta etapa

- La caché todavía no tiene presupuesto LRU ni limpieza automática; se implementará antes de considerarla terminada.
- No se muestra todavía la seekbar ni el cursor de reproducción.
- El motor no se suscribe automáticamente a playback:trackChanged; la integración con PlaybackClock y eventos vendrá después.
- La persistencia ya fue comprobada manualmente en la etapa 0; la etapa 1 añade recuperación de múltiples segmentos independientes.
- La división adaptativa cubre el caso de PCM truncado, pero los formatos que continúen fallando hasta el límite de división quedan marcados como error para permitir reintento.
