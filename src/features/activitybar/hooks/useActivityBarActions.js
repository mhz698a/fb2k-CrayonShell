import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { createActionDispatcher } from '../actions/actionDispatcher.js';
import { activityBarActionRegistry } from '../actions/index.js';

export function useActivityBarActions(context, onError) {
    useSyncExternalStore(
        activityBarActionRegistry.subscribe,
        activityBarActionRegistry.getRevision,
        activityBarActionRegistry.getRevision
    );

    const dispatcher = useMemo(
        () => createActionDispatcher(activityBarActionRegistry, { onError }),
        [onError]
    );

    useSyncExternalStore(
        dispatcher.subscribe,
        dispatcher.getRevision,
        dispatcher.getRevision
    );

    const dispatch = useCallback(
        (actionId, payload) => dispatcher.execute(actionId, context, payload),
        [dispatcher, context]
    );

    const getActionState = useCallback(
        (actionId) => dispatcher.getState(actionId, context),
        [dispatcher, context]
    );

    const getCatalog = useCallback(
        () => dispatcher.getCatalog(context),
        [dispatcher, context]
    );

    return useMemo(() => ({
        dispatch,
        getActionState,
        getCatalog
    }), [dispatch, getActionState, getCatalog]);
}
