# Waveform — etapa 1: motor progresivo y caché por segmentos

La etapa 1 añade el motor que utiliza la decodificación PCM validada en la etapa 0. Todavía no dibuja la seekbar. La integración automática con la reproducción se añadió en la etapa 2 y está documentada en `docs/waveform-stage2.md`.

## Arquitectura implementada

- `waveformIdentity.js`: identifica archivos locales por ruta, subsong, duración, tamaño y fecha de modificación.
- `waveformDecoder.js`: decodifica rangos con `audio.decodePcm()`, calcula picos Peak lineales en un Worker y divide recursivamente un rango si el host lo devuelve truncado.
- `waveformCacheFormat.js`: codifica/valida el formato binario versionado de cada segmento.
- `waveformCache.js`: conserva un archivo de segmento independiente y un manifiesto actualizado atómicamente.
- `waveformScheduler.js`: permite una sola decodificación activa, prioriza el segmento actual y los siguientes, y cancela trabajo distante u obsoleto.
- `waveformEngine.js`: une identidad, caché, decoder y scheduler.

## Diagnóstico manual del motor

Carga CrayonShell desde Vite en el panel WebView2, reproduce una pista local y abre DevTools.

Inicia el motor sobre la pista cargada:

```javascript
await window.__crayonshellWaveformStage1.start()
```

Consulta el estado y los últimos segmentos terminados:

```javascript
window.__crayonshellWaveformStage1.status()
```

La respuesta informa duración, tamaño calculado de segmento, número total de segmentos y los segmentos que aparecen en el manifiesto. Las entradas `[CrayonShell Waveform] segment ready` indican índice, rango temporal, cantidad de picos, `cached: true` cuando se recuperó del disco y profundidad de división cuando el rango tuvo que separarse.

## Prioridad manual después de un seek

Esta llamada cambia únicamente la posición de prioridad del análisis. No mueve la reproducción de foobar2000:

```javascript
window.__crayonshellWaveformStage1.setAnalysisPosition(120)
```

El scheduler cancela el decode activo si está a más de un segmento de la nueva región y comienza por el segmento solicitado.

## Cambio manual de canción

El diagnóstico independiente de etapa 1 requiere volver a ejecutar `start()` tras cambiar de canción:

```javascript
await window.__crayonshellWaveformStage1.start()
```

La integración automática se prueba ahora con `window.__crayonshellWaveformStage2`; en esa etapa ya no se necesita esta llamada manual al cambiar de canción.

## Recuperación de caché

1. Deja que el motor genere varios segmentos.
2. Detén el motor:
   ```javascript
   window.__crayonshellWaveformStage1.stop()
   ```
3. Inicia otra vez con la misma pista:
   ```javascript
   await window.__crayonshellWaveformStage1.start()
   ```

Los segmentos ya guardados se anuncian con `cached: true`. Los huecos continúan decodificándose.

## Control adicional

Reintenta segmentos que hayan fallado:

```javascript
window.__crayonshellWaveformStage1.retryFailed()
```

Detén y libera el motor:

```javascript
window.__crayonshellWaveformStage1.stop()
```

## Formato y ubicación

La caché vive en el perfil nativo:

```text
<perfil foobar2000>\CrayonShell\WaveformCache\v1\
    <track-key>.wfm
    <track-key>.000000.wfs
    <track-key>.000001.wfs
    <track-key>.000002.wfs
```

Cada `.wfs` contiene identidad, índice, rango temporal, metadatos PCM y picos lineales Float32. El manifiesto `.wfm` enumera únicamente los segmentos que terminaron de escribirse. El archivo de segmento se escribe primero de forma atómica; después se actualiza el manifiesto también de forma atómica. Así, un cierre entre ambas operaciones puede dejar un archivo huérfano, pero nunca un manifiesto que declare completo un segmento que todavía no se guardó.

La identidad incluye la ruta normalizada, el subsong, la duración, el tamaño y la fecha de modificación del archivo. La versión y configuración de resolución/segmentación se validan al abrir el manifiesto.

## Límites de la etapa 1

- La caché todavía no tiene presupuesto LRU ni limpieza automática; se implementará antes de considerarla terminada.
- No se muestra todavía la seekbar ni el cursor de reproducción.
- La integración con PlaybackClock y eventos automáticos se implementa en `docs/waveform-stage2.md`; el controlador todavía no se monta en la interfaz de producción.
- La persistencia de etapa 0 fue comprobada manualmente; la etapa 1 añade recuperación de múltiples segmentos independientes.
- La división adaptativa cubre el caso de PCM truncado, pero los formatos que continúen fallando hasta el límite de división quedan marcados como error para permitir reintento.
