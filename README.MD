# fb2k-CrayonShell

Interfaz de foobar2000 construida con React y Vite, preparada para ejecutarse dentro de foo_ui_webview2.

## Requisitos

- Windows 10/11.
- Node.js 22.12 o posterior (o Node.js 20.19 o posterior).
- npm.
- foobar2000 con foo_ui_webview2 para probar la integración real.

## Primer arranque en VS Code

1. Abre la carpeta del repositorio en VS Code.
2. Abre Terminal → New Terminal.
3. Comprueba que Node y npm están disponibles:

~~~powershell
node --version
npm --version
~~~

4. Instala las dependencias:

~~~powershell
npm install
~~~

5. Inicia el servidor de desarrollo:

~~~powershell
npm run dev
~~~

6. Vite muestra `http://localhost:5173`. Abrir esa dirección en Chrome o Edge sirve para revisar únicamente la interfaz: el navegador externo no recibe el puente `window.fb` de foobar2000 y no puede ejecutar operaciones del reproductor ni las detecciones multimedia.

Para desarrollar con la integración real, mantén Vite ejecutándose y configura foobar2000:

1. Abre `File → Preferences → Display → WebView2 UI → Developer`.
2. Activa `Use development server (HMR hot reload)`.
3. Escribe `http://localhost:5173` en `URL`.
4. Pulsa `Apply`.

foobar2000 cargará Vite dentro de WebView2, inyectará el SDK y las detecciones podrán utilizar el puente real. Al guardar un archivo JSX o CSS, Vite actualizará la vista. Detén el servidor con Ctrl+C.

## Probar en foobar2000

El servidor de desarrollo sirve para aprender y modificar la interfaz. La integración real requiere compilar los archivos:

~~~powershell
npm run build
~~~

La salida de producción se escribe fuera del repositorio, en la carpeta configurada en vite.config.js. Actualmente es:

~~~text
../fb2k-CrayonShell-Build/
~~~

La carpeta `../fb2k-CrayonShell-Build/` contiene los archivos que se instalarán como plantilla. **No abras `index.html` directamente desde el disco ni lo cargues mediante `file://`**, porque ese origen no puede utilizar la Media API.

Para instalar la compilación:

1. En foobar2000 abre `File → Preferences → Display → WebView2 UI`.
2. Pulsa `Manage...` y crea una plantilla nueva (o abre la carpeta de una plantilla existente que no estés usando en otro proyecto).
3. Pulsa `Open...` para abrir su carpeta.
4. Copia dentro de esa carpeta todo el contenido de `../fb2k-CrayonShell-Build/`, incluyendo `index.html`, `crayonshell.iife.js` y `crayonshell.css`.
5. Selecciona esa plantilla y pulsa `Apply`.

WebView2 sirve las plantillas locales mediante el origen HTTPS local `https://foo-ui-webview2.local/`. Los archivos permanecen en el disco; no se instala un servidor HTTPS propio ni se necesita un certificado manual.

La raíz del repositorio contiene dos entradas con propósitos diferentes:

- index.html: entrada del servidor de desarrollo de Vite.
- webview.html: plantilla HTML estática que se genera como index.html en la salida de producción.

La compilación genera un JavaScript IIFE clásico, un CSS separado y la página index.html. El IIFE permite cargar el script como archivo clásico desde el HTML local de WebView2, sin depender de imports ES modules. No edites manualmente los archivos generados.

Al finalizar, npm run build comprueba explícitamente que existan index.html, crayonshell.iife.js y crayonshell.css en la carpeta de salida. Si falta cualquiera, el comando termina con error en lugar de dar la compilación por válida.

Cada vez que cambies el código y quieras comprobarlo dentro de foobar2000, vuelve a ejecutar npm run build y recarga la página en el panel.

### Fase 1: prueba de viabilidad de video

Esta rama añade un panel temporal llamado **Prueba multimedia · Fase 1**. No reemplaza ni desactiva `foo_mpv` o Artwork View.

1. Elige uno de estos dos modos: **Vite** (servidor activo y configurado en `WebView2 UI → Developer`) o **build** (archivos copiados a una plantilla instalada desde `WebView2 UI → Manage...`). No pruebes la integración abriendo la página en Chrome/Edge ni mediante `file://`.
2. Confirma que el panel muestre `Host foobar2000: Conectado` y un origen HTTP(S). En Vite, el origen será `http://localhost:5173`; en una plantilla local será `https://foo-ui-webview2.local`.
3. Reproduce en foobar2000 un archivo local MP4, MOV, MKV o WebM. El panel inspecciona automáticamente la pista activa al cargar y cada vez que recibe un cambio de pista. **Volver a inspeccionar** fuerza una nueva consulta.
4. Comprueba el contenedor detectado, la pista de video, el códec y sus dimensiones.
5. Pulsa **Iniciar seguimiento**. El video se presenta silenciado y sigue el reloj de foobar2000.
6. Sin usar controles propios del video, prueba pausar, reanudar, adelantar/retroceder desde foobar2000 y cambiar a otro archivo. Al cambiar de pista, el panel vuelve a inspeccionar la fuente y actualiza o libera el video.
7. Pulsa **Detener** para liberar el elemento, el reloj y las suscripciones.

`media.getContainerInfo` y `media.getStreamUrl` requieren un origen HTTP(S) confiable. `getStreamUrl` también requiere el runtime WebView2 con `ICoreWebView2_22`. El panel separa los errores de origen, puente, contenedor y decodificación real del elemento de video. La API multimedia es experimental.

## Estructura del proyecto

~~~text
fb2k-CrayonShell/
├── index.html                 # Entrada del servidor de desarrollo
├── webview.html              # Plantilla HTML de producción
├── scripts/
│   └── verify-build.mjs       # Comprueba los archivos de salida
├── src/
│   ├── components/
│   │   ├── MediaPlaybackProbe.jsx # Prueba temporal de video sincronizado
│   │   ├── PlaylistStatus.jsx
│   │   ├── PlaylistTable.jsx
│   │   ├── PlaylistToolbar.jsx
│   │   └── Sidebar.jsx
│   ├── hooks/
│   │   └── usePlaylist.js     # Estado y operaciones de la playlist
│   ├── services/
│   │   ├── foobarApi.js       # Puente existente de playlist
│   │   ├── mediaPlaybackProbe.js # Diagnóstico del SDK multimedia
│   │   ├── mockFb2k.js        # Datos ficticios para desarrollo
│   │   └── playlistFormats.js # Formatos de título de foobar2000
│   ├── styles/
│   │   └── main.css
│   ├── utils/
│   │   └── playlistDisplay.js
│   ├── App.jsx
│   └── main.jsx
├── package.json
└── vite.config.js
~~~

## Dónde hacer cada tipo de cambio

- **Distribución general de la interfaz:** src/App.jsx.
- **Panel lateral:** src/components/Sidebar.jsx.
- **Barra superior, selector y filtro:** src/components/PlaylistToolbar.jsx.
- **Filas, clic simple, doble clic y menú contextual:** src/components/PlaylistTable.jsx.
- **Estilos, colores, tamaños y espaciados:** src/styles/main.css.
- **Lectura de playlists, selección, reproducción y eventos:** src/hooks/usePlaylist.js.
- **Comunicación con foobar2000:** src/services/foobarApi.js.
- **Datos ficticios del navegador:** src/services/mockFb2k.js.

Evita modificar src/services/mockFb2k.js para implementar una función real del reproductor. Ese archivo solo permite practicar la interfaz fuera de foobar2000.

## React: conceptos para empezar

### 1. Componentes

Un componente es una función que devuelve una parte de la interfaz. Por ejemplo, PlaylistToolbar.jsx contiene la barra superior. App.jsx combina los componentes para construir la ventana completa.

Cuando quieras cambiar la barra superior, normalmente debes modificar PlaylistToolbar.jsx, no todo App.jsx.

### 2. JSX

JSX permite escribir una estructura parecida a HTML dentro de JavaScript. React la convierte en elementos de interfaz.

Hay diferencias importantes:

- Usa className en lugar de class.
- Usa onClick={miFuncion} para conectar eventos.
- Usa llaves { } para insertar valores de JavaScript.
- Cada elemento repetido de una lista necesita una propiedad key estable.

### 3. Props

Las props son los datos y funciones que un componente recibe de su componente padre. Por ejemplo, PlaylistToolbar recibe playlists y onRefresh. El componente no necesita conocer cómo se obtuvieron las playlists; solo muestra los datos y ejecuta la función recibida.

### 4. Estado con useState

El estado es información que puede cambiar y que debe actualizar la interfaz. Ejemplos: el texto del filtro, el ancho del panel lateral y la playlist activa.

Ejemplo mínimo:

~~~jsx
import { useState } from 'react';

export default function Contador() {
    const [cantidad, setCantidad] = useState(0);

    return (
        <button onClick={() => setCantidad(cantidad + 1)}>
            Pulsaciones: {cantidad}
        </button>
    );
}
~~~

Cuando setCantidad cambia el estado, React vuelve a representar el componente con el nuevo valor.

### 5. useEffect

useEffect permite conectar un componente con algo externo a React, como eventos de foobar2000. En CrayonShell se utiliza en usePlaylist.js para suscribirse a los eventos del reproductor y cancelar esas suscripciones cuando el componente deja de existir.

No uses useEffect para cada cálculo visual. Los valores que puedan calcularse directamente a partir de props o estado deben calcularse durante el renderizado.

### 6. Flujo recomendado para tus primeras correcciones

1. Cambia el texto del botón de actualización en PlaylistToolbar.jsx y guarda.
2. Modifica un color en src/styles/main.css y observa el cambio inmediato.
3. Cambia el texto de una fila en PlaylistTable.jsx.
4. Añade un estado local con useState en un componente pequeño.
5. Después modifica una operación del reproductor en usePlaylist.js.

Empieza por componentes visuales. Deja las llamadas de foobar2000 para cuando ya puedas distinguir entre interfaz, estado y comunicación con el reproductor.

## Recursos oficiales

- Aprende React, paso a paso: https://react.dev/learn
- Referencia de React: https://react.dev/reference/react
- Guía de Vite: https://vite.dev/guide/
- API de foo_ui_webview2: https://nereafantasia.github.io/foo_ui_webview2/

## Comandos habituales

~~~powershell
npm run dev
npm run build
npm run preview
~~~

- dev: servidor de desarrollo con recarga automática y puente simulado.
- build: genera y verifica index.html, el bundle IIFE y el CSS en la carpeta configurada en vite.config.js.
- preview: sirve localmente la compilación para revisar sus archivos.
