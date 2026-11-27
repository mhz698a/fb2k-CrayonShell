const INDEX_FORMAT = 'CrayonShellWaveformCacheIndex';
const INDEX_VERSION = 1;
const DEFAULT_ROOT = 'CrayonShell\\WaveformCache\\v1';
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;
const DEFAULT_MAINTENANCE_INTERVAL_MS = 15 * 60 * 1000;
const DELETE_BATCH_SIZE = 64;
const DELETE_TIMEOUT_MS = 30_000;
const KEY_PATTERN = /^[a-f0-9]{16}$/i;

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
    const result = normalized + '\\' + String(child || '').replace(/^[\\/]+/, '').replace(/[\\/]/g, '\\');
    if (result.length > 259) {
        throw new Error('La ruta de caché waveform excede el límite Win32 de 259 caracteres.');
    }
    return result;
}

function getFileNames(response) {
    return Array.isArray(response?.files)
        ? response.files
        : Array.isArray(response?.items)
            ? response.items
            : [];
}

function getKeyFromManifestName(name) {
    const match = String(name || '').match(/^([a-f0-9]{16})\.wfm$/i);
    return match ? match[1].toLowerCase() : null;
}

function getSegmentName(key, index) {
    return key + '.' + String(index).padStart(6, '0') + '.wfs';
}

function getSegmentKey(name) {
    const match = String(name || '').match(/^([a-f0-9]{16})\.(\d{6})\.wfs$/i);
    return match ? match[1].toLowerCase() : null;
}

function isValidManifest(manifest, fileKey) {
    if (!manifest || manifest.format !== 'CrayonShellWaveformCache'
        || manifest.version !== 1 || String(manifest.key || '').toLowerCase() !== fileKey
        || typeof manifest.identity !== 'string' || !manifest.identity
        || !Number.isFinite(Number(manifest.duration)) || Number(manifest.duration) <= 0
        || !Number.isFinite(Number(manifest.segmentSeconds)) || Number(manifest.segmentSeconds) <= 0
        || !Number.isInteger(manifest.resolution) || manifest.resolution < 64
        || !Array.isArray(manifest.segments)) {
        return false;
    }

    const maximumSegments = Math.ceil(manifest.duration / manifest.segmentSeconds);
    const unique = new Set();
    for (const index of manifest.segments) {
        if (!Number.isInteger(index) || index < 0 || index >= maximumSegments || unique.has(index)) {
            return false;
        }
        unique.add(index);
    }
    return true;
}

function getManifestSegmentBytes(manifest, index) {
    const value = Number(manifest?.segmentBytes?.[String(index)]);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function sumEntryBytes(entries) {
    return entries.reduce((total, entry) => total + Math.max(0, Number(entry.sizeBytes) || 0), 0);
}

function normalizeUnsubscribe(sdk, eventName, handler, returned) {
    if (typeof returned === 'function') return returned;
    if (typeof sdk.off === 'function') {
        return () => sdk.off(eventName, handler);
    }
    return () => undefined;
}

/**
 * Rebuildable inventory and LRU policy for persistent waveform files.
 *
 * Per-track manifests remain authoritative. The global index is a disposable
 * summary rebuilt from those manifests and the files actually present.
 */
export class WaveformCacheManager {
    constructor(options = {}) {
        this.sdk = options.sdk;
        this.root = options.root || DEFAULT_ROOT;
        this.maxBytes = Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0
            ? options.maxBytes
            : DEFAULT_MAX_BYTES;
        this.maintenanceIntervalMs = Number.isFinite(options.maintenanceIntervalMs)
            ? Math.max(0, options.maintenanceIntervalMs)
            : DEFAULT_MAINTENANCE_INTERVAL_MS;
        this.deleteTimeoutMs = Number.isFinite(options.deleteTimeoutMs)
            ? Math.max(1000, options.deleteTimeoutMs)
            : DELETE_TIMEOUT_MS;
        this.now = options.now || Date.now;
        this.onError = options.onError || (() => undefined);

        this.rootPath = null;
        this.indexPath = null;
        this.entries = new Map();
        this.activeTrackKey = null;
        this.initialized = false;
        this.lastMaintenanceAt = 0;
        this.operationTail = Promise.resolve();
        this.maintenancePromise = null;
    }

    setActiveTrackKey(key) {
        this.activeTrackKey = KEY_PATTERN.test(String(key || ''))
            ? String(key).toLowerCase()
            : null;
    }

    getSnapshot() {
        const entries = Array.from(this.entries.values())
            .sort((a, b) => b.lastAccessAt - a.lastAccessAt)
            .map(entry => ({
                key: entry.key,
                sizeBytes: entry.sizeBytes,
                segmentCount: entry.segmentCount,
                lastAccessAt: entry.lastAccessAt,
                updatedAt: entry.updatedAt
            }));
        const usedBytes = sumEntryBytes(entries);
        return {
            initialized: this.initialized,
            root: this.rootPath,
            maxBytes: this.maxBytes,
            usedBytes,
            availableBytes: Math.max(0, this.maxBytes - usedBytes),
            overBudget: usedBytes > this.maxBytes,
            cachedTracks: entries.length,
            cachedSegments: entries.reduce((total, entry) => total + entry.segmentCount, 0),
            activeTrackKey: this.activeTrackKey,
            lastMaintenanceAt: this.lastMaintenanceAt,
            entries
        };
    }

    async initialize(options = {}) {
        if (options.activeTrackKey !== undefined) this.setActiveTrackKey(options.activeTrackKey);
        if (this.initialized) return this.getSnapshot();

        return this._enqueue(async () => {
            if (this.initialized) return this.getSnapshot();
            if (!this.sdk?.file?.list || !this.sdk.file.getInfo
                || !this.sdk.file.write || !this.sdk.file.deleteAsync
                || typeof this.sdk.on !== 'function'
                || typeof this.sdk.misc?.getProfilePath !== 'function') {
                throw new Error('El SDK no dispone de las APIs necesarias para administrar la caché waveform.');
            }

            const profile = assertSuccess(
                await this.sdk.misc.getProfilePath(),
                'No se pudo consultar el perfil de foobar2000'
            );
            this.rootPath = joinWindowsPath(profile?.path, this.root);
            this.indexPath = joinWindowsPath(this.rootPath, 'index.wfi');
            assertSuccess(
                await this.sdk.file.mkdir(this.rootPath),
                'No se pudo crear el directorio de caché waveform'
            );

            await this._reconcile();
            this.initialized = true;
            this.lastMaintenanceAt = this.now();
            await this._writeIndex();
            await this._deleteOrphans(this._reconcileOrphans || []);
            this._reconcileOrphans = [];
            await this._evictToBudget();
            return this.getSnapshot();
        });
    }

    async maintain(options = {}) {
        if (options.activeTrackKey !== undefined) this.setActiveTrackKey(options.activeTrackKey);
        await this.initialize();
        if (!options.force
            && this.now() - this.lastMaintenanceAt < this.maintenanceIntervalMs) {
            return this.getSnapshot();
        }

        if (this.maintenancePromise) return this.maintenancePromise;
        this.maintenancePromise = this._enqueue(async () => {
            await this._reconcile();
            await this._writeIndex();
            await this._deleteOrphans(this._reconcileOrphans || []);
            this._reconcileOrphans = [];
            await this._evictToBudget();
            this.lastMaintenanceAt = this.now();
            await this._writeIndex();
            return this.getSnapshot();
        }).finally(() => {
            this.maintenancePromise = null;
        });
        return this.maintenancePromise;
    }

    async recordCache({ manifest, manifestPath, rootPath } = {}) {
        if (!manifest || !KEY_PATTERN.test(String(manifest.key || ''))) return this.getSnapshot();
        await this.initialize();
        return this._enqueue(async () => {
            const entry = await this._buildEntry(manifest, manifestPath, rootPath || this.rootPath);
            this.entries.set(entry.key, entry);
            await this._writeIndex();
            await this._evictToBudget();
            return this.getSnapshot();
        });
    }

    async _buildEntry(manifest, manifestPath, rootPath) {
        const key = String(manifest.key).toLowerCase();
        const indexes = Array.from(new Set(manifest.segments || [])).sort((a, b) => a - b);
        const segments = [];
        for (const index of indexes) {
            const path = joinWindowsPath(rootPath, getSegmentName(key, index));
            let sizeBytes = getManifestSegmentBytes(manifest, index);
            if (typeof this.sdk.file.getInfo === 'function') {
                const info = assertSuccess(
                    await this.sdk.file.getInfo(path),
                    'No se pudo consultar el tamaño de un segmento waveform'
                );
                if (info?.exists !== true || info?.isFile !== true) continue;
                if (sizeBytes === null || sizeBytes !== Number(info.size)) {
                    sizeBytes = Number(info.size) || 0;
                }
            }
            segments.push({ index, sizeBytes: sizeBytes ?? 0 });
        }

        let manifestBytes = 0;
        if (manifestPath && typeof this.sdk.file.getInfo === 'function') {
            const info = assertSuccess(
                await this.sdk.file.getInfo(manifestPath),
                'No se pudo consultar el tamaño del manifiesto waveform'
            );
            if (info?.exists === true && info?.isFile === true) {
                manifestBytes = Number(info.size) || 0;
            }
        }

        return {
            key,
            identity: manifest.identity,
            manifestPath: manifestPath || joinWindowsPath(rootPath, key + '.wfm'),
            segments,
            segmentCount: segments.length,
            sizeBytes: manifestBytes + segments.reduce((total, segment) => total + segment.sizeBytes, 0),
            lastAccessAt: Number(manifest.lastAccessAt || manifest.updatedAt || manifest.createdAt) || 0,
            updatedAt: Number(manifest.updatedAt) || 0
        };
    }

    async _reconcile() {
        const [manifestResponse, segmentResponse] = await Promise.all([
            this.sdk.file.list(this.rootPath, { pattern: '*.wfm' }),
            this.sdk.file.list(this.rootPath, { pattern: '*.wfs' })
        ]);
        assertSuccess(manifestResponse, 'No se pudo enumerar los manifiestos waveform');
        assertSuccess(segmentResponse, 'No se pudieron enumerar los segmentos waveform');

        const manifestNames = getFileNames(manifestResponse);
        const segmentNames = getFileNames(segmentResponse);
        const segmentNameSet = new Set(segmentNames.map(name => String(name).toLowerCase()));
        const referencedSegments = new Set();
        const nextEntries = new Map();
        const orphanPaths = [];

        for (const rawName of manifestNames) {
            const name = String(rawName);
            const key = getKeyFromManifestName(name);
            if (!key) continue;

            const manifestPath = joinWindowsPath(this.rootPath, name);
            let manifest = null;
            let valid = false;
            try {
                const response = assertSuccess(
                    await this.sdk.file.read(manifestPath),
                    'No se pudo leer un manifiesto waveform'
                );
                manifest = JSON.parse(response?.content || '');
                valid = isValidManifest(manifest, key);
            } catch {
                valid = false;
            }

            if (!valid) {
                if (key !== this.activeTrackKey) {
                    orphanPaths.push(manifestPath);
                    for (const segmentName of segmentNames) {
                        if (getSegmentKey(segmentName) === key) {
                            orphanPaths.push(joinWindowsPath(this.rootPath, segmentName));
                        }
                    }
                }
                continue;
            }

            const presentIndexes = [];
            for (const index of manifest.segments) {
                const segmentName = getSegmentName(key, index);
                if (!segmentNameSet.has(segmentName.toLowerCase())) continue;
                presentIndexes.push(index);
                referencedSegments.add(segmentName.toLowerCase());
            }

            const normalizedManifest = presentIndexes.length === manifest.segments.length
                ? manifest
                : { ...manifest, segments: presentIndexes };
            const entry = await this._buildEntry(normalizedManifest, manifestPath, this.rootPath);
            nextEntries.set(key, entry);
        }

        for (const segmentName of segmentNames) {
            const name = String(segmentName);
            const key = getSegmentKey(name);
            if (!key || referencedSegments.has(name.toLowerCase()) || key === this.activeTrackKey) continue;
            orphanPaths.push(joinWindowsPath(this.rootPath, name));
        }

        this.entries = nextEntries;
        this._reconcileOrphans = Array.from(new Set(orphanPaths));
    }

    async _writeIndex() {
        const entries = Array.from(this.entries.values())
            .sort((a, b) => a.key.localeCompare(b.key));
        const index = {
            format: INDEX_FORMAT,
            version: INDEX_VERSION,
            updatedAt: this.now(),
            maxBytes: this.maxBytes,
            totalBytes: sumEntryBytes(entries),
            entries: entries.map(entry => ({
                key: entry.key,
                identity: entry.identity,
                manifestPath: entry.manifestPath,
                segments: entry.segments,
                segmentCount: entry.segmentCount,
                sizeBytes: entry.sizeBytes,
                lastAccessAt: entry.lastAccessAt,
                updatedAt: entry.updatedAt
            }))
        };
        assertSuccess(
            await this.sdk.file.write(this.indexPath, JSON.stringify(index), { atomic: true }),
            'No se pudo actualizar el índice global de caché waveform'
        );
    }

    async _deleteOrphans(paths) {
        if (!paths.length) return { successCount: 0, failureCount: 0, skippedCount: 0 };
        return this._deletePaths(paths);
    }

    async _evictToBudget() {
        let usedBytes = sumEntryBytes(Array.from(this.entries.values()));
        if (usedBytes <= this.maxBytes) return;

        const candidates = Array.from(this.entries.values())
            .filter(entry => entry.key !== this.activeTrackKey)
            .sort((a, b) => a.lastAccessAt - b.lastAccessAt || a.key.localeCompare(b.key));

        for (const entry of candidates) {
            if (usedBytes <= this.maxBytes) break;
            const paths = [
                ...entry.segments.map(segment => joinWindowsPath(this.rootPath, getSegmentName(entry.key, segment.index))),
                entry.manifestPath
            ];
            const result = await this._deletePaths(paths);
            const deleted = new Set(result.deletedPaths.map(path => path.toLowerCase()));
            const remainingSegments = entry.segments.filter(segment =>
                !deleted.has(joinWindowsPath(this.rootPath, getSegmentName(entry.key, segment.index)).toLowerCase())
            );
            const manifestDeleted = deleted.has(entry.manifestPath.toLowerCase());

            if (manifestDeleted && remainingSegments.length === 0) {
                this.entries.delete(entry.key);
                usedBytes -= entry.sizeBytes;
            } else if (deleted.size > 0) {
                const remainingBytes = remainingSegments.reduce((total, segment) => total + segment.sizeBytes, 0);
                const nextEntry = {
                    ...entry,
                    segments: remainingSegments,
                    segmentCount: remainingSegments.length,
                    sizeBytes: remainingBytes + (manifestDeleted ? 0 : Math.max(0, entry.sizeBytes
                        - entry.segments.reduce((total, segment) => total + segment.sizeBytes, 0)))
                };
                this.entries.set(entry.key, nextEntry);
                usedBytes = sumEntryBytes(Array.from(this.entries.values()));
            }
            await this._writeIndex();
        }
    }

    async _deletePaths(paths) {
        const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
        const result = {
            requestedCount: uniquePaths.length,
            successCount: 0,
            failureCount: 0,
            skippedCount: 0,
            deletedPaths: []
        };

        for (let offset = 0; offset < uniquePaths.length; offset += DELETE_BATCH_SIZE) {
            const batch = uniquePaths.slice(offset, offset + DELETE_BATCH_SIZE);
            const batchResult = await this._deleteBatch(batch);
            result.successCount += batchResult.successCount;
            result.failureCount += batchResult.failureCount;
            result.skippedCount += batchResult.skippedCount;
            result.deletedPaths.push(...batchResult.deletedPaths);
        }
        return result;
    }

    async _deleteBatch(paths) {
        if (!paths.length) {
            return { successCount: 0, failureCount: 0, skippedCount: 0, deletedPaths: [] };
        }

        const progressBatches = [];
        const completionEvents = [];
        let expectedOperationId = null;
        let resolveCompletion;
        let rejectCompletion;
        let timeoutId = null;

        const completionPromise = new Promise((resolve, reject) => {
            resolveCompletion = resolve;
            rejectCompletion = reject;
        });
        const onProgress = payload => {
            if (!expectedOperationId || payload?.operationId === expectedOperationId) {
                progressBatches.push(payload);
            }
        };
        const onComplete = payload => {
            if (!expectedOperationId || payload?.operationId === expectedOperationId) {
                completionEvents.push(payload);
                if (expectedOperationId && payload?.operationId === expectedOperationId) {
                    resolveCompletion(payload);
                }
            }
        };

        const offProgress = normalizeUnsubscribe(
            this.sdk, 'file:opProgress', onProgress,
            this.sdk.on('file:opProgress', onProgress)
        );
        const offComplete = normalizeUnsubscribe(
            this.sdk, 'file:opComplete', onComplete,
            this.sdk.on('file:opComplete', onComplete)
        );

        try {
            const receipt = assertSuccess(
                await this.sdk.file.deleteAsync(paths, { moveToTrash: false }),
                'No se pudo iniciar la limpieza de caché waveform'
            );
            expectedOperationId = receipt?.operationId;
            if (!expectedOperationId) {
                throw new Error('La limpieza waveform no devolvió un identificador de operación.');
            }

            const earlyCompletion = completionEvents.find(
                payload => payload?.operationId === expectedOperationId
            );
            if (earlyCompletion) {
                resolveCompletion(earlyCompletion);
            } else {
                timeoutId = setTimeout(() => {
                    rejectCompletion(new Error('La limpieza de caché waveform no confirmó su finalización.'));
                }, this.deleteTimeoutMs);
            }

            const final = await completionPromise;
            const successfulPaths = progressBatches
                .filter(batch => batch?.operationId === expectedOperationId)
                .flatMap(batch => Array.isArray(batch.results) ? batch.results : [])
                .filter(item => item?.status === 'ok' && typeof item.source === 'string')
                .map(item => item.source.toLowerCase());
            return {
                successCount: Number(final.successCount) || 0,
                failureCount: Number(final.failureCount) || 0,
                skippedCount: Number(final.skippedCount) || 0,
                deletedPaths: successfulPaths
            };
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
            offProgress();
            offComplete();
        }
    }

    _enqueue(operation) {
        const next = this.operationTail.then(operation, operation);
        this.operationTail = next.catch(() => undefined);
        return next;
    }
}

export {
    DEFAULT_MAX_BYTES as DEFAULT_WAVEFORM_CACHE_MAX_BYTES,
    DEFAULT_ROOT as DEFAULT_WAVEFORM_CACHE_ROOT
};
