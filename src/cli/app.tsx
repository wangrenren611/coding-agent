/** @jsxImportSource @opentui/react */
/**
 * 主应用组件 (React 版本)
 */
import React from 'react';
import { useRoute } from './context/route';
import { useTheme } from './context/theme';
import { Home } from './routes';

export interface AppProps {
    // 不再需要 provider 参数，agent context 会自动从环境变量创建
}

export function App(_props: AppProps) {
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
