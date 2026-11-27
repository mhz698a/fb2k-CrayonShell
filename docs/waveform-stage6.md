# Waveform — etapa 6: validación integral y cierre

La etapa 6 corresponde a la validación de aceptación del sistema construido en las etapas 0–5. No introduce otro motor ni cambia la política de caché; comprueba que las piezas integradas sigan funcionando juntas.

## Validación automatizada

Windows CI ejecuta:

- `npm test`: 158 pruebas aprobadas, 0 fallidas.
- `npm run build`: compilación de producción y verificación de artefactos.
- Cobertura de decodificación PCM, reducción de picos, persistencia segmentada, cancelación, scheduler, sincronización con PlaybackClock, seek, fallback sin PCM, inventario reconstruible, reconciliación, evicción LRU, protección de pista activa, configuración persistente y limpieza.

Resultado del HEAD validado de etapa 5: **CI aprobado**.

## Validación manual

El usuario confirmó que completó las pruebas manuales de la administración de caché de la etapa 5 y que los resultados fueron correctos. También había confirmado previamente el funcionamiento del inventario, mantenimiento y limpieza de la etapa 4, así como la disposición y comportamiento general de la seekbar.

La validación manual se realizó en foobar2000, no solo en el SDK simulado de CI.

## Criterio de cierre

- Las 158 pruebas automatizadas pasan.
- La compilación de producción termina correctamente.
- El usuario confirma que las pruebas funcionales manuales de la administración de caché concluyeron correctamente.
- No queda una corrección funcional reportada para las etapas 0–5.

Con esos criterios cumplidos, se considera concluida la etapa 6 y cerrada la implementación de Waveform Seekbar dentro del alcance de este PR.

## Pendiente fuera del cierre

La extracción PCM desde todos los códecs/contenedores de video depende de los decodificadores instalados en foobar2000. La compatibilidad de cada combinación de contenedor y códec no puede garantizarse únicamente con las pruebas automatizadas. Esto no bloquea el cierre de la administración de caché ni de la seekbar de audio validada.
