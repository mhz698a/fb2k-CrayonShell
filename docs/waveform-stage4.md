# Waveform — etapa 4: inventario, limpieza y presupuesto de caché

La etapa 4 administra el almacenamiento persistente creado por las etapas anteriores. No modifica PCM, decodificación, segmentación, PlaybackClock ni el seek.

## Arquitectura

- waveformCacheManager.js: inventario global reconstruible, reconciliación de archivos, presupuesto y evicción LRU.
- waveformCache.js: agrega al manifiesto el tamaño exacto de cada segmento y lastAccessAt. Actualiza el índice global después de cada escritura.
- waveformEngine.js: ejecuta mantenimiento al abrir una pista y protege su identidad mientras está activa.

Los manifiestos individuales siguen siendo la fuente de verdad. El archivo index.wfi es una vista derivada: si falta o está dañado, el administrador lo reconstruye enumerando manifiestos y segmentos reales. No se usa el índice para validar ni recuperar PCM.

## Ubicación y formato

    <perfil foobar2000>\CrayonShell\WaveformCache\v1\
        index.wfi
        <track-key>.wfm
        <track-key>.000000.wfs
        <track-key>.000001.wfs

Campos nuevos de cada manifiesto:

- lastAccessAt: última apertura/lectura reciente de la caché.
- segmentBytes: tamaño en bytes de cada archivo de segmento.

Los manifiestos anteriores que no contienen segmentBytes siguen siendo compatibles; el inventario consulta file.getInfo() para obtener sus tamaños reales.

## Reconciliación

Al inicializar el administrador y durante mantenimientos periódicos:

1. Enumera *.wfm y *.wfs mediante file.list().
2. Valida la versión, la identidad, la duración, la segmentación y los índices declarados por cada manifiesto.
3. Construye un inventario de segmentos que realmente existen y calcula el tamaño por pista.
4. Detecta segmentos sin manifiesto, segmentos no referenciados y grupos con manifiestos inválidos.
5. Elimina los huérfanos con file.deleteAsync(), en lotes de 64 rutas.
6. Escribe index.wfi de forma atómica y aplica el presupuesto.

Las rutas de la pista activa están protegidas durante la reconciliación. La limpieza usa moveToTrash: false: son datos regenerables de caché y no deben ocupar la Papelera de reciclaje. El borrado ocurre en el worker de la API nativa; el resultado se confirma mediante file:opProgress y file:opComplete, con timeout para evitar listeners colgados.

## Presupuesto y LRU

- Presupuesto predeterminado: **1 GiB**.
- Mantenimiento completo: al inicializar y, después, como máximo cada 15 minutos.
- Los cambios de manifiesto actualizan el tamaño y la fecha de acceso en el índice.
- Cuando se supera el presupuesto, elimina primero las pistas menos utilizadas.
- Nunca elimina la identidad de la pista activa.
- Si la pista activa por sí sola supera el presupuesto, se conserva y el diagnóstico informa overBudget: true. Las pistas inactivas se eliminan primero.

El límite es configurable al crear el motor mediante cacheMaxBytes o cacheManagerOptions.maxBytes. La interfaz para cambiarlo está disponible en Administración de caché waveform.

## Diagnóstico y mantenimiento manual

En DevTools, consulta el estado de la caché:

    window.__crayonshellWaveformStage2.status().cache

El resultado informa usedBytes, maxBytes, availableBytes, overBudget, cachedTracks, cachedSegments y el tamaño/fecha de acceso por pista.

Para forzar reconciliación y aplicación del presupuesto:

    await window.__crayonshellWaveformStage2.maintainCache({ force: true })

Para borrar todas las cachés inactivas y conservar la que se está reproduciendo:

    await window.__crayonshellWaveformStage2.clearInactiveCache()

## Límites conocidos

- La interfaz de Ajustes permite cambiar el presupuesto y ejecutar mantenimiento; la última versión de esta configuración se aplica al iniciar el controlador waveform.
- El índice global es local a una instancia del panel. No existe un bloqueo interproceso para dos ventanas de CrayonShell escribiendo simultáneamente en el mismo perfil; por eso el índice es reconstruible y los manifiestos siguen siendo la autoridad.
- La protección de pista activa aplica a la instancia actual del motor. No coordina dos instancias independientes.
- El botón de administración de caché está en la parte inferior de ActivityBar.
- La eliminación física de una caché no es reversible; solo afecta a waveform regenerable y no toca los archivos multimedia originales.
