import { encodeWaveformSegment, decodeWaveformSegment } from './waveformCacheFormat.js';

const FORMAT = 'CrayonShellWaveformCache';
const VERSION = 1;
const DEFAULT_ROOT = 'CrayonShell\\WaveformCache\\v1';
const MAX_PATH_CHARS = 259;

function assertSuccess(response, operation) {
    if (response?.success === false) {
        const error = new Error(response.error || operation + ' falló.');
        error.code = response.code;
        throw error;
    }
    return response;
}

function joinWindowsPath(base, child) {
    const normalized = String(base || '').replace(/[\\/]+$/, '');
    if (!/^[A-Za-z]:\\/i.test(normalized) && !/^\\\\[^\\]+\\[^\\]+/.test(normalized)) {
        throw new Error('El perfil de foobar2000 no devolvió una ruta absoluta de Windows.');
    }
    const result = normalized + '\\' + child.replace(/^[\\/]+/, '').replace(/[\\/]/g, '\\');
    if (result.length > MAX_PATH_CHARS) {
        throw new Error('La ruta de caché waveform excede el límite Win32 de 259 caracteres.');
    }
    return result;
}

function isValidManifest(value, identity, configuration) {
    return Boolean(value
        && value.format === FORMAT
        && value.version === VERSION
        && value.key === identity.key
        && value.identity === identity.serialized
        && Math.abs(Number(value.duration) - configuration.duration) < 0.001
        && Number(value.segmentSeconds) === configuration.segmentSeconds
        && Number(value.resolution) === configuration.resolution
        && Array.isArray(value.segments)
        && value.segments.every(index => Number.isInteger(index) && index >= 0));
}

export class WaveformCache {
    constructor({ sdk, identity, root, duration, segmentSeconds, resolution, manifest }) {
        this.sdk = sdk;
        this.identity = identity;
        this.root = root;
        this.duration = duration;
        this.segmentSeconds = segmentSeconds;
        this.resolution = resolution;
        this.manifestPath = joinWindowsPath(root, identity.key + '.wfm');
        this.manifest = manifest;
        this.writeTail = Promise.resolve();
    }

    static async open({ sdk, identity, duration, segmentSeconds, resolution = 4096, root = DEFAULT_ROOT }) {
        if (!sdk?.file || typeof sdk.file.readBinary !== 'function'
            || typeof sdk.file.writeBinary !== 'function'
            || typeof sdk.file.write !== 'function'
            || typeof sdk.misc?.getProfilePath !== 'function') {
            throw new Error('El SDK no dispone de las APIs necesarias para la caché waveform.');
        }
        if (!identity?.key || !identity?.serialized) {
            throw new TypeError('La identidad de la pista waveform no es válida.');
        }
        if (!Number.isFinite(duration) || duration <= 0
            || !Number.isFinite(segmentSeconds) || segmentSeconds <= 0
            || !Number.isInteger(resolution) || resolution < 64) {
            throw new RangeError('La configuración de caché waveform no es válida.');
        }

        const profile = assertSuccess(
            await sdk.misc.getProfilePath(),
            'No se pudo consultar el perfil de foobar2000'
        );
        const rootPath = joinWindowsPath(profile?.path, root);
        assertSuccess(await sdk.file.mkdir(rootPath), 'No se pudo crear el directorio de caché waveform');

        const cache = new WaveformCache({
            sdk, identity, root: rootPath, duration, segmentSeconds, resolution,
            manifest: null
        });
        await cache._openManifest();
        return cache;
    }

    getCompletedIndexes() {
        return this.manifest.segments.slice().sort((a, b) => a - b);
    }

    getSegmentPath(index) {
        if (!Number.isInteger(index) || index < 0) {
            throw new RangeError('El índice de caché waveform no es válido.');
        }
        const fileName = this.identity.key + '.' + String(index).padStart(6, '0') + '.wfs';
        return joinWindowsPath(this.root, fileName);
    }

    async readSegment(index) {
        if (!this.manifest.segments.includes(index)) return null;
        const path = this.getSegmentPath(index);
        try {
            const exists = assertSuccess(
                await this.sdk.file.exists(path),
                'No se pudo comprobar el segmento waveform'
            );
            if (!exists?.exists || !exists?.isFile) {
                await this._forgetSegment(index);
                return null;
            }

            const bytes = await this.sdk.file.readBinary(path);
            const segment = decodeWaveformSegment(bytes);
            const expectedStart = index * this.segmentSeconds;
            const expectedEnd = Math.min(this.duration, expectedStart + this.segmentSeconds);
            if (segment.trackKey !== this.identity.key || segment.index !== index
                || Math.abs(segment.start - expectedStart) > 0.001
                || Math.abs(segment.end - expectedEnd) > 0.001) {
                throw new Error('La identidad o el rango del segmento no coincide con la caché.');
            }
            return { ...segment, cached: true };
        } catch {
            // A corrupt, incomplete or missing segment is a cache miss, never audio data.
            await this._forgetSegment(index);
            return null;
        }
    }

    async saveSegment(segment) {
        if (!segment || !Number.isInteger(segment.index)
            || segment.index < 0 || segment.index >= Math.ceil(this.duration / this.segmentSeconds)) {
            throw new RangeError('El segmento no pertenece al intervalo de esta pista.');
        }
        const expectedStart = segment.index * this.segmentSeconds;
        const expectedEnd = Math.min(this.duration, expectedStart + this.segmentSeconds);
        if (Math.abs(segment.start - expectedStart) > 0.001
            || Math.abs(segment.end - expectedEnd) > 0.001) {
            throw new RangeError('El rango temporal del segmento no coincide con su índice.');
        }
        const payload = {
            ...segment,
            trackKey: this.identity.key
        };
        const bytes = encodeWaveformSegment(payload);
        const path = this.getSegmentPath(segment.index);

        const operation = async () => {
            assertSuccess(
                await this.sdk.file.writeBinary(path, bytes, { atomic: true }),
                'No se pudo guardar el segmento waveform'
            );
            const next = new Set(this.manifest.segments);
            next.add(segment.index);
            this.manifest = {
                ...this.manifest,
                segments: Array.from(next).sort((a, b) => a - b),
                updatedAt: Date.now()
            };
            await this._writeManifest();
        };

        this.writeTail = this.writeTail.then(operation, operation);
        return this.writeTail;
    }

    async _openManifest() {
        const exists = assertSuccess(
            await this.sdk.file.exists(this.manifestPath),
            'No se pudo comprobar el índice de caché waveform'
        );
        if (exists?.exists && exists?.isFile) {
            try {
                const response = assertSuccess(
                    await this.sdk.file.read(this.manifestPath),
                    'No se pudo leer el índice de caché waveform'
                );
                const parsed = JSON.parse(response?.content || '');
                if (parsed?.key === this.identity.key
                    && parsed?.identity !== this.identity.serialized) {
                    throw new Error('Colisión de identidad en la caché waveform; se rechazó el archivo existente.');
                }
                if (isValidManifest(parsed, this.identity, {
                    duration: this.duration,
                    segmentSeconds: this.segmentSeconds,
                    resolution: this.resolution
                })) {
                    this.manifest = parsed;
                    return;
                }
            } catch (error) {
                if (String(error?.message || '').includes('Colisión de identidad')) throw error;
                // Invalid metadata is discarded; individual segment payloads are never trusted without it.
            }
        }

        this.manifest = {
            format: FORMAT,
            version: VERSION,
            key: this.identity.key,
            identity: this.identity.serialized,
            duration: this.duration,
            segmentSeconds: this.segmentSeconds,
            resolution: this.resolution,
            segments: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        await this._writeManifest();
    }

    async _writeManifest() {
        assertSuccess(
            await this.sdk.file.write(
                this.manifestPath,
                JSON.stringify(this.manifest),
                { atomic: true }
            ),
            'No se pudo actualizar el índice de caché waveform'
        );
    }

    async _forgetSegment(index) {
        if (!this.manifest.segments.includes(index)) return;
        this.manifest = {
            ...this.manifest,
            segments: this.manifest.segments.filter(value => value !== index),
            updatedAt: Date.now()
        };
        try {
            await this._writeManifest();
        } catch {
            // A failed manifest rewrite leaves the old entry; the next read revalidates it.
        }
    }
}
