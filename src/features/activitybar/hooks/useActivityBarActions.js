import { useCallback, useMemo } from 'react';
import { createActionDispatcher } from '../actions/actionDispatcher.js';
import { activityBarActionRegistry } from '../actions/index.js';

export function useActivityBarActions(context, onError) {
    const dispatcher = useMemo(
        () => createActionDispatcher(activityBarActionRegistry, { onError }),
        [onError]
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
