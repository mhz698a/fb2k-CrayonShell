import { useEffect, useState } from 'react';
import {
    getPlaybackControllerState,
    playbackController,
    startPlaybackController,
    subscribePlaybackControllerState
} from '../features/playback/playbackController.js';

/**
 * React adapter for the application-wide playback controller.
 * Mount once near the App root; child controls can receive this snapshot/actions.
 */
export function usePlaybackController() {
    const [state, setState] = useState(() => getPlaybackControllerState());

    useEffect(() => {
        const unsubscribe = subscribePlaybackControllerState(setState);
        const release = startPlaybackController();
        setState(getPlaybackControllerState());

        return () => {
            unsubscribe();
            release();
        };
    }, []);

    return {
        ...state,
        actions: playbackController
    };
}
