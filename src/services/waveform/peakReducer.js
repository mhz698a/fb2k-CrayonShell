const MAX_PEAK = 1;

export function reducePcmChannelsToPeaks(channels, bucketCount) {
    if (!Array.isArray(channels) || channels.length === 0) {
        throw new TypeError('Se requiere al menos un canal PCM.');
    }

    if (!Number.isInteger(bucketCount) || bucketCount < 1) {
        throw new RangeError('bucketCount debe ser un entero positivo.');
    }

    const frameCount = channels[0]?.length;
    if (!Number.isInteger(frameCount) || frameCount < 1) {
        throw new RangeError('Los canales PCM deben contener al menos una muestra.');
    }

    for (const channel of channels) {
        if (!(channel instanceof Float32Array) || channel.length !== frameCount) {
            throw new TypeError('Todos los canales deben ser Float32Array del mismo tamaño.');
        }
    }

    const peaks = new Float32Array(bucketCount);

    for (let frame = 0; frame < frameCount; frame += 1) {
        const bucket = Math.min(
            bucketCount - 1,
            Math.floor((frame * bucketCount) / frameCount)
        );
        let peak = peaks[bucket];

        for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
            const sample = channels[channelIndex][frame];
            if (!Number.isFinite(sample)) continue;
            peak = Math.max(peak, Math.abs(sample));
        }

        peaks[bucket] = Math.min(MAX_PEAK, peak);
    }

    return peaks;
}

export function copyPcmChannels(pcm) {
    if (!pcm || pcm.available === false
        || !Number.isInteger(pcm.channels) || pcm.channels < 1
        || !Number.isInteger(pcm.frames) || pcm.frames < 1
        || typeof pcm.getChannelView !== 'function') {
        throw new TypeError('El buffer PCM no contiene muestras utilizables.');
    }

    const channels = [];
    for (let channelIndex = 0; channelIndex < pcm.channels; channelIndex += 1) {
        const view = pcm.getChannelView(channelIndex);
        if (!(view instanceof Float32Array) || view.length !== pcm.frames) {
            throw new TypeError('El SDK devolvió una vista de canal PCM inválida.');
        }
        // PcmBuffer views are read-only shared memory. Copy before releasing them
        // and transfer only these owned buffers to the Worker.
        channels.push(new Float32Array(view));
    }

    return channels;
}

let nextWorkerRequestId = 1;

export async function reducePcmToPeaksInWorker(pcm, bucketCount, options = {}) {
    if (!Number.isInteger(bucketCount) || bucketCount < 1) {
        throw new RangeError('bucketCount debe ser un entero positivo.');
    }

    let channels;
    try {
        channels = copyPcmChannels(pcm);
    } finally {
        // Release the native shared buffer as soon as independent copies exist.
        pcm?.release?.();
    }

    const workerFactory = options.workerFactory || (() => {
        if (typeof Worker !== 'function') {
            throw new Error('Web Workers no están disponibles en este WebView2.');
        }
        return new Worker(new URL('./peakReducer.worker.js', import.meta.url), {
            type: 'module'
        });
    });

    const worker = workerFactory();
    const requestId = nextWorkerRequestId++;
    const signal = options.signal;
    const transferList = channels.map(channel => channel.buffer);

    return new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
            worker.onmessage = null;
            worker.onerror = null;
            signal?.removeEventListener('abort', onAbort);
            worker.terminate?.();
        };
        const settle = (callback, value) => {
            if (settled) return;
            settled = true;
            cleanup();
            callback(value);
        };
        const onAbort = () => {
            settle(reject, new DOMException('La reducción de picos fue cancelada.', 'AbortError'));
        };

        if (signal?.aborted) {
            settle(reject, new DOMException('La reducción de picos fue cancelada.', 'AbortError'));
            return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });

        worker.onmessage = event => {
            const message = event?.data;
            if (!message || message.requestId !== requestId) return;
            if (message.success !== true) {
                settle(reject, new Error(message.error || 'Falló la reducción de muestras PCM.'));
                return;
            }
            if (!(message.peaks instanceof ArrayBuffer)
                || message.peaks.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
                settle(reject, new Error('El Worker devolvió un bloque de picos inválido.'));
                return;
            }
            settle(resolve, new Float32Array(message.peaks));
        };
        worker.onerror = event => {
            settle(reject, new Error(event?.message || 'Falló el Worker de waveform.'));
        };

        try {
            worker.postMessage({
                type: 'reduce-pcm',
                requestId,
                bucketCount,
                channels: transferList
            }, transferList);
        } catch (error) {
            settle(reject, error);
        }
    });
}
