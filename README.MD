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

6. Abre en el navegador la dirección local que Vite muestra en la terminal, normalmente http://localhost:5173.

En desarrollo, si no existe window.fb2k, CrayonShell activa automáticamente un puente de demostración. Puedes probar el filtro, cambiar la selección, hacer doble clic para reproducir una pista simulada, ocultar el panel lateral y redimensionarlo. Los datos de demostración no modifican foobar2000.

Al guardar un archivo JSX o CSS, Vite actualiza la vista del navegador sin tener que reiniciar el servidor. Detén el servidor con Ctrl+C.

## Probar en foobar2000

El servidor de desarrollo sirve para aprender y modificar la interfaz. La integración real requiere compilar los archivos:

~~~powershell
npm run build
~~~

La salida de producción se escribe fuera del repositorio, en la carpeta configurada en vite.config.js. Actualmente es:

~~~text
../fb2k-CrayonShell-Build/
~~~

La entrada que debes cargar desde foo_ui_webview2 es:

~~~text
../fb2k-CrayonShell-Build/index.html
~~~

La raíz del repositorio contiene dos entradas con propósitos diferentes:

- index.html: entrada del servidor de desarrollo de Vite.
- webview.html: plantilla HTML estática que se genera como index.html en la salida de producción.

La compilación genera un JavaScript IIFE clásico, un CSS separado y la página index.html. El IIFE permite cargar el script como archivo clásico desde el HTML local de WebView2, sin depender de imports ES modules. No edites manualmente los archivos generados.

Al finalizar, npm run build comprueba explícitamente que existan index.html, crayonshell.iife.js y crayonshell.css en la carpeta de salida. Si falta cualquiera, el comando termina con error en lugar de dar la compilación por válida.

Cada vez que cambies el código y quieras comprobarlo dentro de foobar2000, vuelve a ejecutar npm run build y recarga la página en el panel.

## Estructura del proyecto

~~~text
fb2k-CrayonShell/
├── index.html                 # Entrada del servidor de desarrollo
├── webview.html              # Plantilla HTML de producción
├── scripts/
│   └── verify-build.mjs       # Comprueba los archivos de salida
├── src/
│   ├── components/
│   │   ├── PlaylistStatus.jsx
│   │   ├── PlaylistTable.jsx
│   │   ├── PlaylistToolbar.jsx
│   │   └── Sidebar.jsx
│   ├── hooks/
│   │   └── usePlaylist.js     # Estado y operaciones de la playlist
│   ├── services/
│   │   ├── foobarApi.js       # Puente real con foo_ui_webview2
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
