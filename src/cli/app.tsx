/** @jsxImportSource @opentui/react */
/**
 * 主应用组件 (React 版本)
 */
import React from 'react';
import { useRoute } from './context/route';
import { useTheme } from './context/theme';
import { Home } from './routes';

export function App() {
    const route = useRoute();
    const { theme } = useTheme();

    return (
        <box
            width="100%"
            height="100%"
            flexGrow={1}
            padding={0}
            margin={0}
            backgroundColor={theme.background}
            flexDirection="column"
        >
            {route.data.type === 'home' && <Home />}
        </box>
    );
}
