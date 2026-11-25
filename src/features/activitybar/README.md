# ActivityBar action system

ActivityBar separates the rendered buttons from the operations they execute.

## Main pieces

- `actions/actionRegistry.js`: validates and stores action definitions. Each action has a stable ID, label, category, default icon, availability predicate, active-state predicate and executor.
- `actions/actionDispatcher.js`: resolves an action ID, checks availability, executes it and returns a structured result. Execution and availability errors are sent to the configured error handler.
- `actions/coreActions.js`: registers the initial CrayonShell actions.
- `actions/index.js`: exports the shared registry used by the application.
- `hooks/useActivityBarActions.js`: connects the registry and dispatcher to React.
- `components/activitybar/ActivityBar.jsx`: renders the current pinned control and delegates execution to the dispatcher.

## Registering an action

Feature modules can register actions without changing ActivityBar:

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

The returned function unregisters the action. IDs must be unique. Configuration stores action IDs and presentation preferences; it must never store executable JavaScript.

## Runtime context

`App.jsx` builds the execution context from current application state and callbacks. Do not import React state setters or component internals into action definitions. Use the context supplied to `execute`, `isAvailable` and `isActive`.

The initial actions are:

- `ui.toggleSidebar`
- `ui.toggleContentView`
- `playlist.refresh`
- `diagnostics.open`
- `activitybar.manage`

The manager action is registered but unavailable until its UI is supplied in the manager stage.

## Dispatcher result

Successful execution returns `{ ok: true, status: 'success', actionId, result }`.

An unavailable action returns `{ ok: false, status: 'unavailable', actionId, reason }` without invoking the executor.

Lookup, availability and execution errors return `status: 'error'` and are sent to the error handler. The application logs the failure and displays a dismissible alert.

## Sidebar lifecycle

ReFacets and Spectrum are initialized on first display. Their activation state is sticky: hiding the Sidebar changes only presentation and does not cancel Media Library subscriptions, repeat Library Viewer Selection synchronization, clear FFT data or stop the Spectrum animation loop. They are cleaned up when their React components are actually unmounted or when Spectrum settings require a new subscription.
