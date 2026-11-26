import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import 'font-awesome/css/font-awesome.min.css';
import './styles/main.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
    throw new Error('No se encontró el elemento raíz de CrayonShell.');
}

createRoot(rootElement).render(<App />);

// Stage-0 diagnostics are loaded only in Vite development and are tree-shaken
// from production. They do not change the player's transport state.
if (import.meta.env.DEV && typeof window !== 'undefined') {
    import('./services/waveform/stage0Probe.js')
        .then((probe) => {
            Object.defineProperty(window, '__crayonshellWaveformStage0', {
                configurable: true,
                enumerable: false,
                writable: false,
                value: Object.freeze({
                    decode: probe.runWaveformStage0Probe,
                    cancel: probe.runWaveformCancellationProbe,
                    inspect: probe.inspectWaveformStage0Probe,
                    clear: probe.clearWaveformStage0Probe
                })
            });
            console.info('[CrayonShell] Waveform stage-0 diagnostics ready.');
        })
        .catch((error) => {
            console.error('[CrayonShell] Could not load waveform stage-0 diagnostics.', error);
        });
}
