# CrayonShell — auditoría de ajustes persistentes

## Objetivo y alcance

Esta auditoría identifica los ajustes que CrayonShell persiste actualmente y establece qué módulos serán propietarios de ellos dentro del sistema global de respaldo.

La implementación inicial conserva los mecanismos de almacenamiento existentes. El registro centralizado no sustituye todavía a `localStorage`, no cambia la carga de preferencias y no introduce una migración de datos.

## Inventario confirmado

Se identificaron **11 claves persistentes de configuración o estado de interfaz**, agrupadas en seis proveedores lógicos.

| Proveedor | Clave | Contenido | Tratamiento previsto |
|---|---|---|---|
| `core.ui` | `crayonshell.sidebar.width.v1` | Ancho del Sidebar, en píxeles. Rango actual: 240–520; predeterminado: 320. | Portable |
| `core.ui` | `crayonshell.sidebar.collapsed.v1` | Visibilidad contraída del Sidebar, almacenada como booleano textual. | Portable |
| `core.ui` | `crayonshell.sidebar.view.v1` | Vista activa del Sidebar: `library` o `yearbook`. | Portable |
| `core.ui` | `crayonshell.sidebar.refacetsHeight.v1` | Proporción vertical de ReFacets. Rango actual: 30–85; predeterminado: 68. | Portable |
| `activitybar` | `crayonshell.activitybar.config.v1` | Versión de esquema y lista ordenada de accesos, acciones, etiquetas e iconos. | Portable; validar IDs de acciones |
| `externalTools` | `crayonshell.externalTools.v1` | Ejecutable Python, scripts y rutas de herramientas externas. | Dependiente del equipo |
| `yearbook.explorer` | `crayonshell.yearbookExplorer.expanded.v1` | Ruta raíz y lista de carpetas expandidas. | Portable con normalización de rutas |
| `spectrum` | `crayonshell.spectrum.settings.v1` | FFT, bandas, FPS, frecuencias, canales, sensibilidad, decaimiento y colores. | Portable |
| `refacets` | `crayonshell.refacets.presentation.v1` | Visibilidad de encabezado/pie y conteos por columna. | Portable |
| `refacets` | `crayonshell.refacets.columnSplit.v1` | Proporción de ancho entre Years y Subfolders. Rango actual: 25–75; predeterminado: 50. | Portable |
| `refacets` | `crayonshell.refacets.selection.v1` | Selecciones persistidas de años y subcarpetas. | Estado de interfaz restaurable |

### Detalle por proveedor

#### Core UI

Actualmente la persistencia está distribuida entre `src/App.jsx` y `src/components/Sidebar.jsx`.

- `sidebar.width`: solo acepta valores numéricos finitos dentro de 240–520.
- `sidebar.collapsed`: usa los textos `true` y `false`; si no existe el valor se inicia contraído.
- `sidebar.view`: acepta `yearbook`; cualquier otro valor se interpreta como `library`.
- `sidebar.refacetsHeight`: se limita al rango 30–85.

#### ActivityBar

El almacenamiento está aislado en `src/features/activitybar/config/storage.js`.

- Esquema actual: versión 1.
- Máximo actual: 80 botones.
- Cada botón contiene `id`, `actionId`, `label` e `icon`.
- Las acciones son referencias al catálogo de código; el respaldo no debe incluir ni ejecutar funciones.
- CrayonShell ya dispone de importación/exportación JSON propia para ActivityBar en su administrador. El respaldo global deberá reutilizar el mismo esquema/normalizador y evitar crear una segunda implementación incompatible.

#### External Tools

El almacenamiento y normalización están en `src/features/activitybar/config/externalTools.js`.

Campos actuales:

- `pythonExecutable`
- `frameEtudeScript`
- `catchEtudeScript`
- `anuarySignatureScript`
- `numHandScript`
- `smbYearScript`
- `galleryAnuaryScript`
- `internalBasePath`
- `recycleBinPath`

Son rutas y nombres de ejecutables dependientes de cada equipo. Deben incluirse en el respaldo, pero la importación tendrá que identificarlos para que el usuario pueda revisarlos. No son credenciales.

#### Yearbook Explorer

El almacenamiento se realiza desde `src/components/yearbook/YearbookExplorerPanel.jsx`.

La clave contiene:

- `rootPath`: ruta absoluta de la raíz configurada.
- `paths`: hasta 500 rutas absolutas de nodos expandidos.

**Dependencia importante:** las rutas expandidas se restauran actualmente solo cuando `rootPath` coincide exactamente. Para que el respaldo funcione entre equipos con distintas letras de unidad o directorios, la exportación global debe convertir los nodos expandidos a rutas relativas respecto a la raíz y la importación debe reconstruir las rutas con la nueva raíz. No se debe copiar este valor absoluto sin transformación.

#### ReFacets

La persistencia está distribuida entre `src/components/refacets/ReFacetsPanel.jsx` y `src/hooks/useLibraryFacets.js`.

- Presentación: `showHeader`, `showFooter`, `yearsCount`, `subfoldersCount`.
- Splitter Years/Subfolders: valor porcentual entre 25 y 75.
- Selección: arreglos `years` y `subfolders` con valores de texto.

La selección es estado de interfaz que el usuario puede querer recuperar, por lo que se incluye en el respaldo completo aunque no sea una preferencia visual estricta.

#### Spectrum

La configuración se encuentra dentro de `src/components/audio/SpectrumVisualizer.jsx`.

Incluye tamaño FFT, bandas, FPS, frecuencia mínima/máxima, salida, escala, canales, limitación en segundo plano, sensibilidad, decaimiento y colores. El módulo ya normaliza estos valores contra rangos y opciones admitidas.

## Datos que no deben formar parte del respaldo de ajustes

| Dato | Clave o ubicación | Motivo |
|---|---|---|
| Historial de diagnóstico multimedia | `crayonshell.mediaPlaybackProbe.logs.v1` | Registros operativos; no son configuración. |
| Filtro actual de playlist | Estado React de `App.jsx` | Temporal y no persistido. |
| Vista de contenido Playlist/Video | Estado React de `App.jsx` | No se persiste como preferencia. |
| Nodo seleccionado de Yearbook | Estado React de `YearbookExplorerPanel.jsx` | Selección temporal; las carpetas expandidas sí se respaldan. |
| Cachés de directorios, solicitudes pendientes y datos de reproducción | Estado en memoria de los módulos | Estado de ejecución. |
| Funciones del catálogo ActivityBar | Registro de acciones en código | El archivo solo puede contener referencias declarativas a acciones. |

No se deben incluir credenciales, tokens, contraseñas ni datos secretos. La auditoría no identificó credenciales dentro de las claves de configuración enumeradas.

## Contrato de proveedor

Cada módulo será responsable de sus ajustes mediante un proveedor registrado con:

- `id`: identificador estable y único.
- `label` y `description`: metadatos para la interfaz.
- `version`: versión independiente del esquema del proveedor.
- `readSettings()`: lectura del estado persistido actual.
- `validateSettings(value)`: validación y normalización sin escribir datos.
- `applySettings(value, context)`: aplicación de datos previamente validados.

El registro no depende de `localStorage`. Los proveedores pueden implementar adaptadores para almacenamiento web o mecanismos proporcionados por el host.

## Consideraciones para las etapas siguientes

1. La exportación global debe recopilar los proveedores registrados, no enumerar todas las claves de `localStorage`.
2. El importador debe validar todos los proveedores antes de aplicar cualquiera de ellos.
3. La importación debe conservar una copia del estado actual para poder revertir una aplicación fallida.
4. Las rutas de External Tools y Yearbook deben marcarse como dependientes del equipo.
5. Las rutas expandidas de Yearbook deben exportarse como rutas relativas a su raíz.
6. Los IDs de acciones desconocidos de ActivityBar no deben convertirse en código ni ejecutarse; deben validarse y reportarse como referencias no disponibles.
7. La importación/exportación existente de ActivityBar debe converger en el formato global sin romper su flujo actual.

## Etapa 2 — Exportación global

Se incorporó un exportador común sin interfaz gráfica ni acceso directo a un origen concreto.

### Formato

- `format`: `crayonshell-settings`.
- `formatVersion`: versión del contenedor global, actualmente 1.
- `exportedAt`: fecha ISO 8601.
- `application`: nombre, versión del paquete y runtime de origen.
- `providers`: objeto indexado por ID estable; cada entrada contiene su versión independiente y los ajustes normalizados.

### Proveedores registrados

| ID | Área | Contenido |
|---|---|---|
| `core.ui` | Interfaz general | Sidebar y altura de ReFacets |
| `activitybar` | ActivityBar | Accesos configurables |
| `external-tools` | Herramientas externas | Ejecutables y rutas |
| `yearbook.explorer` | Yearbook Explorer | Rutas expandidas relativas a la raíz |
| `refacets` | ReFacets | Presentación, divisor y filtros seleccionados |
| `spectrum` | Spectrum | Parámetros FFT y apariencia |

Las seis áreas se registran durante el arranque de CrayonShell. La función de bootstrap es idempotente para tolerar una reevaluación del módulo durante desarrollo.

### Reglas de exportación

- El exportador consulta únicamente los proveedores registrados; no enumera todo `localStorage`.
- Cada proveedor valida y normaliza los datos antes de agregarlos.
- La serialización rechaza valores no JSON, referencias circulares, números no finitos, objetos de clases y propiedades peligrosas.
- Yearbook exporta las carpetas expandidas como segmentos relativos; no transporta las rutas absolutas de Windows en ese proveedor. La raíz sigue siendo responsabilidad de External Tools.
- External Tools conserva rutas explícitas porque forman parte de la configuración, pero continúan clasificadas como dependientes del equipo.
- Los datos de diagnóstico y los estados en memoria no se incorporan.

### Resultado de las etapas 1 y 2

- Inventario documentado: 11 claves y seis proveedores funcionales.
- Registro centralizado con contrato de lectura, validación y aplicación.
- Seis proveedores reales conectados al almacenamiento actual.
- Exportador JSON global versionado, independiente de Vite y WebView2.
- Pruebas de registro, normalización, exportación, serialización y transformación de rutas.
- Sin interfaz de importación/exportación todavía; corresponde a una etapa posterior.
- La implementación de importación y la aplicación coordinada de ajustes quedan para la etapa 3.
