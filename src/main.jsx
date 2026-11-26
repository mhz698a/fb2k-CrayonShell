import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import 'font-awesome/css/font-awesome.min.css';
import './styles/main.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
    throw new Error('No se encontró el elemento raíz de CrayonShell.');
}

createRoot(rootElement).render(<App />);

// Waveform diagnostics are development-only. They are not part of production
// and do not call playback controls or change the active playback position.
if (import.meta.env.DEV && typeof window !== 'undefined') {
    Promise.all([
        import('./services/waveform/stage0Probe.js'),
        import('./services/waveform/waveformEngine.js'),
        import('./services/fooSdk.js')
    ]).then(([stage0, stage1, sdkModule]) => {
        Object.defineProperty(window, '__crayonshellWaveformStage0', {
            configurable: true,
            enumerable: false,
            writable: false,
            value: Object.freeze({
                decode: stage0.runWaveformStage0Probe,
                cancel: stage0.runWaveformCancellationProbe,
                inspect: stage0.inspectWaveformStage0Probe,
                clear: stage0.clearWaveformStage0Probe
            })
        });

        let engine = null;
        let segmentLog = [];

        async function resolveCurrentTrack(sdk, explicitTrack) {
            if (explicitTrack) return explicitTrack;
            const response = await sdk.player.getCurrentTrack();
            if (response?.success === false) {
                throw new Error(response.error || 'No se pudo consultar la pista actual.');
            }
            if (!response?.found || !response.track) {
                throw new Error('No hay una pista cargada en foobar2000.');
            }
            return response.track;
        }

        async function resolvePosition(sdk, explicitPosition) {
            if (Number.isFinite(Number(explicitPosition))) return Number(explicitPosition);
            try {
                const response = await sdk.player.getPosition();
                return response?.success === true && Number.isFinite(response.position)
                    ? response.position
                    : 0;
            } catch {
                return 0;
            }
        }

        async function startWaveformEngine(options = {}) {
            const sdk = options.sdk || sdkModule.getFooSdk();
            const track = await resolveCurrentTrack(sdk, options.track);
            const position = await resolvePosition(sdk, options.positionSeconds);

            if (!engine) {
                engine = new stage1.WaveformEngine({
                    sdk,
                    resolution: options.resolution || 4096,
                    segmentDurationOptions: options.segmentDurationOptions,
                    onSegment(segment) {
                        const entry = {
                            index: segment.index,
                            start: segment.start,
                            end: segment.end,
                            peaks: segment.peaks.length,
                            cached: segment.cached === true,
                            splitDepth: segment.splitDepth || 0
                        };
                        segmentLog.push(entry);
                        if (segmentLog.length > 500) segmentLog = segmentLog.slice(-500);
                        console.info('[CrayonShell Waveform] segment ready', entry);
                    },
                    onState(state) {
                        console.debug('[CrayonShell Waveform] state', state);
                    },
                    onError(error, context) {
                        console.error('[CrayonShell Waveform] segment failed', context, error);
                    }
                });
            }

            const result = await engine.setTrack(track, position);
            return {
                ...result,
                snapshot: engine.getSnapshot(),
                recentSegments: segmentLog.slice(-20)
            };
        }

        Object.defineProperty(window, '__crayonshellWaveformStage1', {
            configurable: true,
            enumerable: false,
            writable: false,
            value: Object.freeze({
                start: startWaveformEngine,
                setAnalysisPosition(positionSeconds) {
                    engine?.setPosition(positionSeconds);
                    return engine?.getSnapshot() || null;
                },
                status() {
                    return {
                        snapshot: engine?.getSnapshot() || null,
                        recentSegments: segmentLog.slice(-20)
                    };
                },
                retryFailed() {
                    engine?.retryFailed();
                    return engine?.getSnapshot() || null;
                },
                stop() {
                    engine?.dispose();
                    engine = null;
                    segmentLog = [];
                    return { stopped: true };
                }
            })
        });

        console.info('[CrayonShell] Waveform stage-0 and stage-1 diagnostics ready.');
    }).catch((error) => {
        console.error('[CrayonShell] Could not load waveform diagnostics.', error);
    });
}
