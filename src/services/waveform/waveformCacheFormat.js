const MAGIC = [0x43, 0x53, 0x57, 0x53]; // CSWS
const VERSION = 1;
const HEADER_BYTES = 48;

function requireFinite(value, name, minimum = 0) {
    if (!Number.isFinite(value) || value < minimum) {
        throw new TypeError(name + ' no es un número válido.');
    }
}

export function encodeWaveformSegment(segment) {
    const {
        trackKey, index, start, end, frames, sampleRate, channels, peaks
    } = segment || {};

    if (typeof trackKey !== 'string' || !/^[a-f0-9]{16}$/.test(trackKey)) {
        throw new TypeError('trackKey no es válido.');
    }
    if (!Number.isInteger(index) || index < 0) {
        throw new RangeError('El índice del segmento no es válido.');
    }
    requireFinite(start, 'start');
    requireFinite(end, 'end');
    if (end <= start || !Number.isInteger(frames) || frames < 1
        || !Number.isInteger(sampleRate) || sampleRate < 1
        || !Number.isInteger(channels) || channels < 1 || channels > 255) {
        throw new RangeError('Los metadatos del segmento no son válidos.');
    }
    if (!(peaks instanceof Float32Array) || peaks.length < 1 || peaks.length > 65535) {
        throw new TypeError('El segmento debe contener un Float32Array de picos.');
    }

    const totalBytes = HEADER_BYTES + trackKey.length + peaks.length * 4;
    const bytes = new Uint8Array(totalBytes);
    bytes.set(MAGIC, 0);
    const view = new DataView(bytes.buffer);
    view.setUint16(4, VERSION, true);
    view.setUint16(6, HEADER_BYTES, true);
    view.setUint32(8, trackKey.length, true);
    view.setUint32(12, index, true);
    view.setFloat64(16, start, true);
    view.setFloat64(24, end, true);
    view.setUint32(32, frames, true);
    view.setUint32(36, sampleRate, true);
    view.setUint16(40, channels, true);
    view.setUint16(42, peaks.length, true);
    view.setUint32(44, totalBytes, true);

    const keyBytes = new TextEncoder().encode(trackKey);
    bytes.set(keyBytes, HEADER_BYTES);
    const peakOffset = HEADER_BYTES + keyBytes.length;
    for (let i = 0; i < peaks.length; i += 1) {
        const peak = peaks[i];
        if (!Number.isFinite(peak) || peak < 0 || peak > 1) {
            throw new RangeError('El pico ' + i + ' está fuera del rango lineal 0..1.');
        }
        view.setFloat32(peakOffset + i * 4, peak, true);
    }
    return bytes;
}

export function decodeWaveformSegment(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.byteLength < HEADER_BYTES) {
        throw new Error('El archivo de segmento está incompleto.');
    }
    if (!MAGIC.every((value, index) => bytes[index] === value)) {
        throw new Error('La firma del segmento waveform no coincide.');
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint16(4, true);
    const headerBytes = view.getUint16(6, true);
    const keyLength = view.getUint32(8, true);
    const index = view.getUint32(12, true);
    const start = view.getFloat64(16, true);
    const end = view.getFloat64(24, true);
    const frames = view.getUint32(32, true);
    const sampleRate = view.getUint32(36, true);
    const channels = view.getUint16(40, true);
    const peakCount = view.getUint16(42, true);
    const declaredBytes = view.getUint32(44, true);
    const expectedBytes = HEADER_BYTES + keyLength + peakCount * 4;

    if (version !== VERSION || headerBytes !== HEADER_BYTES
        || keyLength !== 16 || peakCount < 1
        || declaredBytes !== expectedBytes || bytes.byteLength !== expectedBytes
        || !Number.isFinite(start) || !Number.isFinite(end) || end <= start
        || frames < 1 || sampleRate < 1 || channels < 1) {
        throw new Error('La cabecera del segmento waveform no es válida.');
    }

    const trackKey = new TextDecoder('utf-8', { fatal: true })
        .decode(bytes.subarray(HEADER_BYTES, HEADER_BYTES + keyLength));
    if (!/^[a-f0-9]{16}$/.test(trackKey)) {
        throw new Error('La identidad del segmento waveform no es válida.');
    }

    const peaks = new Float32Array(peakCount);
    const peakOffset = HEADER_BYTES + keyLength;
    for (let i = 0; i < peakCount; i += 1) {
        const peak = view.getFloat32(peakOffset + i * 4, true);
        if (!Number.isFinite(peak) || peak < 0 || peak > 1) {
            throw new Error('El archivo contiene un pico lineal inválido.');
        }
        peaks[i] = peak;
    }

    return { trackKey, index, start, end, frames, sampleRate, channels, peaks };
}
