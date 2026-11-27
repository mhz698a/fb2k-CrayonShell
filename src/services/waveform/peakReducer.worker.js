import { reducePcmChannelsToPeaks } from './peakReducer.js';

self.addEventListener('message', event => {
    const message = event?.data;
    if (message?.type !== 'reduce-pcm') return;

    const { requestId, bucketCount, channels: channelBuffers } = message;

    try {
        if (!Array.isArray(channelBuffers) || channelBuffers.length === 0) {
            throw new Error('El Worker recibió una lista de canales vacía.');
        }

        const channels = channelBuffers.map(buffer => {
            if (!(buffer instanceof ArrayBuffer)
                || buffer.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
                throw new Error('El Worker recibió un buffer de canal inválido.');
            }
            return new Float32Array(buffer);
        });

        const peaks = reducePcmChannelsToPeaks(channels, bucketCount);
        self.postMessage({
            requestId,
            success: true,
            peaks: peaks.buffer
        }, [peaks.buffer]);
    } catch (error) {
        self.postMessage({
            requestId,
            success: false,
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
