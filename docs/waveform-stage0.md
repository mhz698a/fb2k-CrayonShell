# Waveform — etapa 0: validación del runtime

Esta prueba técnica validó las capacidades reales de foo_ui_webview2. La persistencia del archivo de diagnóstico después de cerrar y volver a abrir foobar2000 ya fue comprobada manualmente.

## Qué verifica

- audio.getPcmDebugState() confirma shared buffers (environment12 y webview17).
- audio.decodePcm() decodifica un rango real de audio.
- Los picos Peak lineales se extraen de todos los canales PCM.
- Un Web Worker calcula la envolvente fuera del hilo principal.
- El buffer PCM compartido se libera después de crear las copias de trabajo.
- AbortSignal puede cancelar la decodificación y el procesamiento del Worker.
- file.writeBinary(..., { atomic: true }) persiste un archivo binario en el perfil.
- readBinary() permite verificar la lectura; inspect() comprueba el archivo tras reiniciar.
- Los buffers PCM truncados se rechazan y no se guardan.

## Worker en desarrollo y producción

La entrada de la aplicación registra el constructor importado desde
peakReducer.worker.js?worker&inline. Vite compila el worker junto con sus
dependencias y lo incorpora al bundle, por lo que la salida IIFE no necesita
resolver import.meta.url ni cargar un archivo worker adicional desde disco.

scripts/verify-build.mjs comprueba que el bundle de producción no conserve
referencias a import.meta.url ni a URLs de recursos Rolldown incompatibles
con IIFE. La misma ruta de creación del worker se utiliza desde Vite en
desarrollo y desde el bundle de producción.

## Ejecutar dentro de foobar2000

1. Abre WebView2 UI → Developer → Use development server y carga CrayonShell desde Vite.
2. Abre DevTools de esa instancia de WebView2.
3. Reproduce una pista local o proporciona explícitamente su ruta.
4. Ejecuta la prueba predeterminada de cinco segundos:

\`\`\`javascript
await window.__crayonshellWaveformStage0.decode()
\`\`\`

Prueba una ruta y rango concretos:

\`\`\`javascript
await window.__crayonshellWaveformStage0.decode({
    path: 'D:\\Music\\Album\\Track.flac',
    startSeconds: 30,
    durationSeconds: 5,
    bucketCount: 512
})
\`\`\`

El archivo de diagnóstico se escribe en:

\`\`\`text
<perfil foobar2000>\\CrayonShell\\WaveformCache\\_stage0\\pcm-decode-probe.wfc
\`\`\`

## Cancelación

Utiliza una pista larga y solicita cancelar un rango de hasta 120 segundos:

\`\`\`javascript
await window.__crayonshellWaveformStage0.cancel({
    startSeconds: 0,
    endSeconds: 120,
    abortAfterMs: 50
})
\`\`\`

El resultado esperado es outcome = cancelled. Si el decode termina antes del temporizador, informa completed-before-abort; esa ejecución no demuestra cancelación.

## Persistencia después de reiniciar foobar2000

1. Ejecuta decode() y confirma persistence.atomicWriteReadback = true.
2. Ejecuta inspect() y confirma found = true y matchesRequestedSegment = true.
3. Cierra completamente foobar2000.
4. Vuelve a abrirlo con el mismo perfil y carga CrayonShell desde Vite.
5. Ejecuta nuevamente inspect() con los mismos parámetros:

\`\`\`javascript
await window.__crayonshellWaveformStage0.inspect({
    path: 'D:\\Music\\Album\\Track.flac',
    startSeconds: 30,
    durationSeconds: 5,
    bucketCount: 512
})
\`\`\`

La persistencia real solo se considera verificada cuando el archivo continúa presente y coincide después del reinicio. Una lectura inmediata posterior a la escritura no sustituye esta prueba.

## Limpieza

\`\`\`javascript
await window.__crayonshellWaveformStage0.clear()
\`\`\`

Elimina solamente el archivo de diagnóstico de etapa 0. No modifica minibar.db ni otros datos del perfil.

## Límites de esta etapa

- pcm-decode-probe.wfc es una muestra técnica, no el formato definitivo de caché.
- Esta prueba analiza un solo rango. El motor progresivo, la cola prioritaria y la caché multi-segmento están implementados en la etapa 1; consulta docs/waveform-stage1.md.
- La prueba no cambia el estado de reproducción ni incorpora controles a la interfaz.
- Los diagnósticos se importan únicamente durante desarrollo; no deben formar parte del bundle de producción.
- decodePcm y shared buffers son APIs experimentales. Su compatibilidad requiere validación en la versión instalada de foobar2000/WebView2.
