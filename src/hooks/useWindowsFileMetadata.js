import { useEffect, useRef, useState } from 'react';
import { readWindowsFileMetadata } from '../services/windowsFileMetadata.js';

export function useWindowsFileMetadata(playlistIndex, itemIndex, enabled = true) {
    const [metadata, setMetadata] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const requestIdRef = useRef(0);

    useEffect(() => {
        const requestId = ++requestIdRef.current;

        if (!enabled || !Number.isInteger(playlistIndex) || playlistIndex < 0
            || !Number.isInteger(itemIndex) || itemIndex < 0) {
            setMetadata(null);
            setLoading(false);
            setError('');
            return undefined;
        }

        const controller = new AbortController();
        setMetadata(null);
        setLoading(true);
        setError('');

        readWindowsFileMetadata(playlistIndex, itemIndex, controller.signal)
            .then((result) => {
                if (requestId !== requestIdRef.current) return;
                setMetadata({
                    fileSizeBytes: Number.isSafeInteger(result.fileSizeBytes)
                        && result.fileSizeBytes >= 0
                        ? result.fileSizeBytes
                        : null,
                    timestamps: result.timestamps && typeof result.timestamps === 'object'
                        ? result.timestamps
                        : {}
                });
            })
            .catch((failure) => {
                if (controller.signal.aborted || requestId !== requestIdRef.current) return;
                setError(failure?.message || 'No se pudieron leer los metadatos de Windows.');
            })
            .finally(() => {
                if (requestId !== requestIdRef.current) return;
                setLoading(false);
            });

        return () => controller.abort();
    }, [playlistIndex, itemIndex, enabled]);

    return { metadata, loading, error };
}
