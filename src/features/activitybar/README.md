# ActivityBar

ActivityBar keeps the button layout, action catalog and action implementations independent. The visual bar only renders persisted button entries and dispatches their action IDs.

## Configuration

- `config/defaults.js`: initial button arrangement.
- `config/schema.js`: schema version 1, validation, sanitization and JSON import parsing.
- `config/storage.js`: `localStorage` persistence under `crayonshell.activitybar.config.v1`.
- `hooks/useActivityBarConfig.js`: React state and add/remove/edit/reorder/restore/import operations.

A persisted configuration stores only a version and button presentation data:

```json
{
  "version": 1,
  "buttons": [
    {
      "id": "ui.toggleSidebar",
      "actionId": "ui.toggleSidebar",
      "label": "Panel izquierdo",
      "icon": "columns"
    }
  ]
}
```

Executable code is never stored in the configuration. The administrator action is fixed at the bottom of ActivityBar and cannot be removed. It remains accessible even when all configurable buttons have been removed.

The manager supports:
- Add any currently available registered action.
- Remove a pinned action without unregistering its implementation.
- Edit its display label and Font Awesome 4 icon.
- Reorder using drag-and-drop or the up/down controls.
- Restore defaults.
- Import and export the versioned JSON configuration.

Unknown action IDs from older imports remain visible as unavailable entries and can be removed. Invalid icon names are replaced with `question-circle`. Invalid JSON or incompatible schema versions are rejected.

## Font Awesome 4

The application pins `font-awesome@4.7.0` as a local npm dependency. Its stylesheet and font files are bundled by Vite; no CDN or installed Windows font is required.

`icons/fa4Catalog.js` contains the icon-name catalog extracted from the upstream Font Awesome 4.7.0 LESS variables. The manager searches this catalog and only stores validated icon names.

## Actions

- `actions/actionRegistry.js`: action definitions, availability, active state, registration and subscriptions.
- `actions/actionDispatcher.js`: validated execution and structured results.
- `actions/coreActions.js`: initial CrayonShell action definitions.
- `actions/index.js`: shared registry instance.
- `hooks/useActivityBarActions.js`: subscribes React to runtime registration changes and exposes the dispatcher.

Feature modules can register actions without modifying the ActivityBar component:

```js
import { activityBarActionRegistry } from './actions/index.js';

const unregister = activityBarActionRegistry.register({
    id: 'files.openManager',
    label: 'Administrador de archivos',
    category: 'Herramientas',
    description: 'Abre el administrador de archivos.',
    defaultIcon: 'folder-open',
    isAvailable: (context) => ({
        available: typeof context.openFileManager === 'function',
        reason: 'El administrador de archivos no está disponible.'
    }),
    isActive: (context) => context.activeTool === 'files',
    execute: (context, payload) => context.openFileManager(payload)
});
```

The returned function unregisters the action. IDs must be unique. Registry changes notify React so an action registered after startup appears in the manager catalog without editing ActivityBar.

## Runtime context and initial actions

`App.jsx` builds the execution context from current application state and callbacks. Action implementations must use the context passed to `execute`, `isAvailable` and `isActive`; they must not import component state setters.

Initial actions:

- `ui.toggleSidebar`
- `ui.toggleContentView`
- `playlist.refresh`
- `diagnostics.open`
- `activitybar.manage`


## Phase 4 — native adapters for the legacy ActivityBar

Legacy actions are registered independently from the ActivityBar UI and use the typed `foo-webview-sdk` facade. They appear in the ActivityBar manager catalog and can be pinned, renamed, assigned a Font Awesome 4 icon, reordered or removed without changing their implementation.

Migrated actions:

- Foobar2000 context commands: Shazam, Edit Folder with mp3Tag and Explore Directory.
- Main-menu commands: Playback Rate, Tempo, IIR Filter and YouTube Source / Search on Site.
- Context service: Download with Omniget.
- Google Song Searcher: selection-aware popup with filename, title/artist, lyrics and release-date queries.
- Newgrounds: opens the selected track's page only when the filename ends in `(η)` and its title ends in `(ID: number)`.
- NumHand utilities menu: copy selected filenames, copy selected paths, explore the current track's folder and open the configured legacy recycle location.

These adapters use `menu.runContextCommand`, `menu.runMainMenuCommand`, `menu.popup`, `playlist.getSelectedTracks`, `clipboard.write` and `shell` methods from the SDK. They do not use Spider Monkey Panel globals such as `plman`, `ActiveXObject` or `window.CreatePopupMenu`. Native actions are unavailable in an external Chrome/Edge session without the foobar2000 bridge.

The following original buttons are not migrated in this increment: FrameEtude, CatchEtude, AnuarySignature, NumHand's Python launcher, the SMB year dialog, the Yearbook Explorer and GalleryAnuary's album-folder launcher. Their original implementations depend on Python/OneDrive paths hardcoded in the Spider Monkey Panel project, ActiveX process creation and filesystem enumeration. They need a separate configurable external-tool/path adapter; the legacy absolute paths are deliberately not copied into the React bundle.

## Sidebar lifecycle

ReFacets and Spectrum initialize on first display. Their activation state is sticky: hiding the Sidebar changes presentation only. It does not cancel Media Library subscriptions, repeat Library Viewer Selection synchronization, clear FFT data or stop the Spectrum animation loop. They are cleaned up when their React components are unmounted or when Spectrum settings require a new subscription.
