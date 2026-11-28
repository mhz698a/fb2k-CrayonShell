import { Component } from 'react';

function normalizeError(value, fallback) {
    if (value instanceof Error) return value;
    if (value && typeof value === 'object') {
        const message = value.message || value.reason || fallback;
        const error = new Error(String(message));
        if (value.stack) error.stack = String(value.stack);
        return error;
    }
    return new Error(String(value || fallback));
}

export default class AppErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error: normalizeError(error, 'Error desconocido de React.') };
    }

    componentDidMount() {
        window.addEventListener('error', this.handleWindowError);
        window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
    }

    componentWillUnmount() {
        window.removeEventListener('error', this.handleWindowError);
        window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
    }

    componentDidCatch(error, info) {
        console.error('[CrayonShell][runtime] React render failure', error, info?.componentStack || '');
    }

    handleWindowError = (event) => {
        const error = normalizeError(
            event.error,
            event.message || 'Se produjo un error JavaScript no controlado.'
        );
        this.captureRuntimeError(error);
    };

    handleUnhandledRejection = (event) => {
        const error = normalizeError(
            event.reason,
            'Se produjo una promesa rechazada sin controlar.'
        );
        this.captureRuntimeError(error);
    };

    captureRuntimeError(error) {
        console.error('[CrayonShell][runtime] Unhandled runtime failure', error);
        this.setState((state) => state.error ? null : { error });
    }

    render() {
        if (this.state.error) {
            const error = this.state.error;
            return (
                <main className="app-runtime-failure" role="alert">
                    <section className="app-runtime-failure-panel">
                        <h1>CrayonShell no pudo continuar</h1>
                        <p>Se produjo un error durante la ejecución de la interfaz.</p>
                        <strong>{error.message || 'Error desconocido'}</strong>
                        {error.stack && <pre>{error.stack}</pre>}
                        <button type="button" onClick={() => window.location.reload()}>
                            Recargar CrayonShell
                        </button>
                    </section>
                </main>
            );
        }

        return this.props.children;
    }
}
