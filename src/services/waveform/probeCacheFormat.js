const MAGIC = [0x43, 0x53, 0x57, 0x50]; // CSWP
const VERSION = 1;
const HEADER_BYTES = 48;

function requireFiniteNumber(value, name, minimum = 0) {
    if (!Number.isFinite(value) || value < minimum) {
        throw new TypeError(`${name} debe ser un número finito válido.`);
    }
}

export function encodeWaveformProbe({ identity, start, end, frames, sampleRate, channels, peaks }) {
    if (typeof identity !== 'string' || !identity.trim()) {
        throw new TypeError('La identidad de prueba no es válida.');
    }
    requireFiniteNumber(start, 'start');
    requireFiniteNumber(end, 'end');
    requireFiniteNumber(frames, 'frames', 1);
    requireFiniteNumber(sampleRate, 'sampleRate', 1);
    requireFiniteNumber(channels, 'channels', 1);
    if (end <= start || !Number.isInteger(frames)
        || !Number.isInteger(sampleRate) || !Number.isInteger(channels)) {
        throw new RangeError('Los metadatos del bloque PCM son inconsistentes.');
    }
    if (!(peaks instanceof Float32Array) || peaks.length < 1) {
        throw new TypeError('Se requiere un arreglo Float32Array de picos.');
    }

    const encoder = new TextEncoder();
    const identityBytes = encoder.encode(identity);
    const byteLength = HEADER_BYTES + identityBytes.byteLength + peaks.length * 4;
    const bytes = new Uint8Array(byteLength);
    bytes.set(MAGIC, 0);

    const view = new DataView(bytes.buffer);
    view.setUint16(4, VERSION, true);
    view.setUint16(6, HEADER_BYTES, true);
    view.setUint32(8, identityBytes.byteLength, true);
    view.setUint32(12, peaks.length, true);
    view.setFloat64(16, start, true);
    view.setFloat64(24, end, true);
    view.setUint32(32, frames, true);
    view.setUint32(36, sampleRate, true);
    view.setUint16(40, channels, true);
    view.setUint16(42, 0, true);
    view.setUint32(44, byteLength, true);

    bytes.set(identityBytes, HEADER_BYTES);
    const peakOffset = HEADER_BYTES + identityBytes.byteLength;
    for (let index = 0; index < peaks.length; index += 1) {
        const peak = peaks[index];
        if (!Number.isFinite(peak) || peak < 0 || peak > 1) {
            throw new RangeError(`El pico ${index} está fuera del intervalo lineal 0..1.`);
        }
        view.setFloat32(peakOffset + index * 4, peak, true);
    }

    return bytes;
}

export function decodeWaveformProbe(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.byteLength < HEADER_BYTES) {
        throw new Error('El archivo de prueba de waveform está incompleto.');
    }
    if (!MAGIC.every((value, index) => bytes[index] === value)) {
        throw new Error('El archivo no tiene la firma CSWP.');
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint16(4, true);
    const headerBytes = view.getUint16(6, true);
    const identityLength = view.getUint32(8, true);
    const peakCount = view.getUint32(12, true);
    const start = view.getFloat64(16, true);
    const end = view.getFloat64(24, true);
    const frames = view.getUint32(32, true);
    const sampleRate = view.getUint32(36, true);
    const channels = view.getUint16(40, true);
    const declaredBytes = view.getUint32(44, true);
    const expectedBytes = HEADER_BYTES + identityLength + peakCount * 4;

    if (version !== VERSION || headerBytes !== HEADER_BYTES
        || peakCount < 1 || frames < 1 || sampleRate < 1 || channels < 1
        || declaredBytes !== expectedBytes || bytes.byteLength !== expectedBytes
        || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        throw new Error('El encabezado del archivo de prueba de waveform no es válido.');
    }

    const decoder = new TextDecoder('utf-8', { fatal: true });
    const identity = decoder.decode(bytes.subarray(HEADER_BYTES, HEADER_BYTES + identityLength));
    if (!identity) throw new Error('El archivo no contiene una identidad de pista.');

    const peaks = new Float32Array(peakCount);
    const peakOffset = HEADER_BYTES + identityLength;
    for (let index = 0; index < peakCount; index += 1) {
        const peak = view.getFloat32(peakOffset + index * 4, true);
        if (!Number.isFinite(peak) || peak < 0 || peak > 1) {
            throw new Error(`El archivo contiene un pico inválido en la posición ${index}.`);
        }
        peaks[index] = peak;
    }

    return { identity, start, end, frames, sampleRate, channels, peaks };
}

export function waveformProbeBytesEqual(left, right) {
    const a = left instanceof Uint8Array ? left : new Uint8Array(left);
    const b = right instanceof Uint8Array ? right : new Uint8Array(right);
    if (a.byteLength !== b.byteLength) return false;
    for (let index = 0; index < a.byteLength; index += 1) {
        if (a[index] !== b[index]) return false;
    }
    return true;
}
