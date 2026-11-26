import { useEffect, useRef, useState } from 'react';
import { invoke } from '../services/foobarApi.js';
import { TRACK_PROPERTY_FORMATS } from '../services/trackProperties.js';

export function useTrackProperties(playlistGuid, itemIndex, enabled = true) {
    const [properties, setProperties] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const requestIdRef = useRef(0);

    useEffect(() => {
        const requestId = ++requestIdRef.current;

        if (!enabled || !playlistGuid || !Number.isInteger(itemIndex) || itemIndex < 0) {
            setProperties(null);
            setLoading(false);
            setError('');
            return undefined;
        }

        let active = true;
        setProperties(null);
        setLoading(true);
        setError('');

        invoke('playlist.getTracks', {
            playlistGuid,
            start: itemIndex,
            count: 1,
            formats: TRACK_PROPERTY_FORMATS
        }).then((result) => {
            if (!active || requestId !== requestIdRef.current) return;

            const track = Array.isArray(result.tracks)
                ? result.tracks.find((item) => Number(item.index) === itemIndex)
                : null;

            if (!track) {
                throw new Error('La pista seleccionada ya no existe en la playlist.');
            }

            setProperties({
                index: itemIndex,
                path: track.path ? String(track.path) : '',
                handle: track.handle ? String(track.handle) : '',
                formats: track.formats && typeof track.formats === 'object'
                    ? track.formats
                    : {}
            });
        }).catch((failure) => {
            if (!active || requestId !== requestIdRef.current) return;
            setError(failure?.message || 'No se pudieron leer las propiedades de la pista.');
        }).finally(() => {
            if (!active || requestId !== requestIdRef.current) return;
            setLoading(false);
        });

        return () => {
            active = false;
        };
    }, [playlistGuid, itemIndex, enabled]);

    return { properties, loading, error };
}
