# Waveform — etapa 5: preferencias y administración de caché

La etapa 5 añade administración visible a la caché persistente de las etapas 0–4. El motor PCM, la segmentación, PlaybackClock y la seekbar permanecen sin cambios funcionales.

## Acceso

En la parte inferior de ActivityBar se agregó el botón **Administrar caché de waveform** (icono de base de datos). Abre un diálogo independiente de la playlist y del panel de propiedades.

## Presupuesto persistente

- Valor predeterminado: 1 GiB.
- Mínimo: 64 MiB.
- Máximo: 64 GiB.
- Unidad editable: MiB, en incrementos de 64 MiB.
- El valor se guarda en localStorage bajo `crayonshell.waveform.cache.settings.v1`.
- El proveedor `waveform.cache` forma parte del registro global y de los respaldos JSON de CrayonShell.
- El cambio de presupuesto se aplica inmediatamente al administrador activo y se persiste para las siguientes sesiones.

Al reducir el límite, la política LRU elimina primero las cachés inactivas menos utilizadas. La identidad de la pista activa permanece protegida incluso cuando ella sola supera el presupuesto. En ese caso, el diálogo muestra `overBudget`.

## Diagnóstico visual

El diálogo muestra:

- Bytes utilizados y disponibles dentro del límite.
- Pistas y segmentos almacenados.
- Porcentaje de utilización y límite efectivo.
- Fecha del último mantenimiento.
- Ruta de almacenamiento actual.
- Barra de utilización del presupuesto y aviso `overBudget`.
- Advertencia cuando el presupuesto se excede por una pista protegida.

El botón **Reconciliar** fuerza la reconstrucción del inventario desde los manifiestos y los archivos existentes, elimina huérfanos y aplica el presupuesto.

## Limpieza manual

La limpieza manual requiere una segunda confirmación. Conserva la pista activa y elimina permanentemente solo los manifiestos y segmentos inactivos de waveform. No modifica archivos multimedia originales.

Durante la eliminación, el diálogo refleja los eventos `file:opProgress` como archivos completados frente al total. El indicador es porcentual cuando el SDK reporta avance y permanece indeterminado durante la reconciliación o la espera de finalización. Al terminar informa pistas retiradas, archivos eliminados y operaciones fallidas u omitidas. La actividad se ejecuta mediante las operaciones asíncronas del SDK; la interfaz de reproducción no se bloquea.

## Arquitectura

- `features/waveform/waveformCacheSettings.js`: normalización, lectura y persistencia del presupuesto.
- `features/settings/providers/coreSettingsProviders.js`: proveedor `waveform.cache`, compatible con respaldo/restauración.
- `WaveformCacheManager.setMaxBytes()`: cambia el límite y ejecuta evicción LRU.
- `WaveformEngine.setCacheMaxBytes()`: puente entre el administrador y el motor.
- `WaveformPlaybackController.setCacheMaxBytes()`: API consumida por la interfaz.
- `WaveformSeekbar`: entrega una interfaz limitada para consultar y administrar la caché sin exponer el objeto interno del controlador.
- `WaveformCacheSettingsDialog.jsx`: controles, confirmación, resultados, estadísticas y avance de eliminación por lotes.

## Límites

- Los ajustes persistidos se cargan al crear el controlador waveform. La importación de un respaldo sigue requiriendo recargar CrayonShell, como los demás ajustes restaurados.
- No existe bloqueo interproceso para dos paneles WebView2 modificando simultáneamente el mismo perfil. El índice global sigue siendo reconstruible y los manifiestos individuales continúan siendo la fuente de verdad.
- El inventario corresponde al perfil de foobar2000 al que está conectado el panel actual.

## Validación

Las pruebas manuales de administración de caché en foobar2000 fueron completadas y reportadas como correctas. La validación automatizada de la etapa 6 registra 158 pruebas aprobadas y compilación de producción correcta.
