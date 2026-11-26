const HASH_MASK = 0xffffffffffffffffn;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

function normalizePath(path) {
    return String(path || '').replace(/\//g, '\\').replace(/\\+/g, '\\').toLowerCase();
}

function hashIdentity(value) {
    let hash = FNV_OFFSET;
    for (const byte of new TextEncoder().encode(value)) {
        hash ^= BigInt(byte);
        hash = (hash * FNV_PRIME) & HASH_MASK;
    }
    return hash.toString(16).padStart(16, '0');
}

export function buildWaveformTrackIdentity(track, fileInfo = null) {
    if (!track || typeof track !== 'object') {
        throw new TypeError('La pista de waveform no es válida.');
    }

    const absolutePath = String(track.absolutePath || '').trim();
    if (!/^(?:[a-z]:\\|\\\\[^\\]+\\[^\\]+)/i.test(absolutePath)) {
        throw new Error('El waveform persistente requiere una ruta local absoluta de Windows.');
    }

    const duration = Number(track.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error('La pista no tiene una duración válida para generar waveform.');
    }

    const subsong = Number.isInteger(track.subsong) && track.subsong >= 0
        ? track.subsong
        : 0;
    const size = Number.isSafeInteger(fileInfo?.size) && fileInfo.size >= 0
        ? fileInfo.size
        : Number.isSafeInteger(track.fileSize) && track.fileSize >= 0
            ? track.fileSize
            : null;
    const modified = Number.isSafeInteger(fileInfo?.modified) && fileInfo.modified >= 0
        ? fileInfo.modified
        : null;

    const identity = {
        path: normalizePath(absolutePath),
        subsong,
        durationMilliseconds: Math.round(duration * 1000),
        size,
        modified
    };
    const serialized = JSON.stringify(identity);

    return Object.freeze({
        key: hashIdentity(serialized),
        serialized,
        absolutePath,
        decodePath: String(track.handle || absolutePath),
        duration,
        sampleRate: Number.isInteger(track.sampleRate) && track.sampleRate > 0
            ? track.sampleRate
            : 48000,
        channels: Number.isInteger(track.channels) && track.channels > 0
            ? track.channels
            : 2,
        fileSize: size,
        modified,
        subsong
    });
}

export function chooseWaveformSegmentDuration(track, options = {}) {
    const targetBytes = Number(options.targetPcmBytes ?? 12 * 1024 * 1024);
    const minimumSeconds = Number(options.minimumSeconds ?? 1);
    const maximumSeconds = Number(options.maximumSeconds ?? 10);
    const sampleRate = Number(track?.sampleRate) || 48000;
    const channels = Number(track?.channels) || 2;

    if (!Number.isFinite(targetBytes) || targetBytes <= 0
        || !Number.isFinite(minimumSeconds) || minimumSeconds <= 0
        || !Number.isFinite(maximumSeconds) || maximumSeconds < minimumSeconds) {
        throw new RangeError('La configuración de segmentación no es válida.');
    }

    const bytesPerSecond = sampleRate * channels * Float32Array.BYTES_PER_ELEMENT;
    const estimatedSeconds = Math.floor(targetBytes / bytesPerSecond);
    return Math.max(minimumSeconds, Math.min(maximumSeconds, estimatedSeconds || minimumSeconds));
}

export function getWaveformSegmentRange(index, duration, segmentSeconds) {
    if (!Number.isInteger(index) || index < 0
        || !Number.isFinite(duration) || duration <= 0
        || !Number.isFinite(segmentSeconds) || segmentSeconds <= 0) {
        throw new RangeError('El rango del segmento waveform no es válido.');
    }
    const start = index * segmentSeconds;
    if (start >= duration) return null;
    return {
        index,
        start,
        end: Math.min(duration, start + segmentSeconds)
    };
}

export function getWaveformBucketCount(segmentDuration, trackDuration, resolution = 4096) {
    if (!Number.isFinite(segmentDuration) || segmentDuration <= 0
        || !Number.isFinite(trackDuration) || trackDuration <= 0
        || !Number.isInteger(resolution) || resolution < 64) {
        throw new RangeError('La resolución del waveform no es válida.');
    }
    return Math.max(1, Math.min(resolution, Math.ceil(resolution * segmentDuration / trackDuration)));
}
