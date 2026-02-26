/** @jsxImportSource @opentui/react */
/**
 * Route context - 路由管理
 */
import { useState, useCallback, useMemo } from 'react';
import { createSimpleContext } from './helper';

export type HomeRoute = {
    type: 'home';
    initialPrompt?: string;
};

export type SessionRoute = {
    type: 'session';
    sessionID: string;
    initialPrompt?: string;
};

export type Route = HomeRoute | SessionRoute;

interface RouteContextValue {
    data: Route;
    navigate: (route: Route) => void;
}

export const { Provider: RouteProvider, use: useRoute } = createSimpleContext<RouteContextValue>('Route', () => {
    const [route, setRoute] = useState<Route>({ type: 'home' });

    const navigate = useCallback((newRoute: Route) => {
        setRoute(newRoute);
    }, []);

    return useMemo(
        () => ({
            data: route,
            navigate,
        }),
        [route, navigate]
    );
});

export type RouteContext = ReturnType<typeof useRoute>;
