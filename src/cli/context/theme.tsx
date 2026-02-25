/** @jsxImportSource @opentui/react */
/**
 * Theme context - 主题管理 (React 版本)
 */
import { useState, useCallback, useMemo } from 'react';
import { createSimpleContext } from './helper';

export interface ThemeColors {
    // 背景
    background: string;
    backgroundPanel: string;
    backgroundElement: string;
    backgroundMenu: string;

    // 文本
    text: string;
    textMuted: string;

    // 边框
    border: string;
    borderActive: string;

    // 状态
    primary: string;
    secondary: string;
    accent: string;
    success: string;
    warning: string;
    error: string;

    // Diff
    diffAdded: string;
    diffRemoved: string;
    diffAddedBg: string;
    diffRemovedBg: string;
}

const darkTheme: ThemeColors = {
    background: '#000000',
    backgroundPanel: '#0b0b0b',
    backgroundElement: '#121212',
    backgroundMenu: '#1a1a1a',

    text: '#e4e4e4',
    textMuted: '#808080',

    border: '#2a2a2a',
    borderActive: '#fab283',

    primary: '#6cb6eb',
    secondary: '#a0c9ea',
    accent: '#fab283',
    success: '#8fb573',
    warning: '#f5a97f',
    error: '#f87070',

    diffAdded: '#8fb573',
    diffRemoved: '#f87070',
    diffAddedBg: '#1a2a1a',
    diffRemovedBg: '#2a1a1a',
};

const lightTheme: ThemeColors = {
    background: '#ffffff',
    backgroundPanel: '#f5f5f5',
    backgroundElement: '#ebebeb',
    backgroundMenu: '#e0e0e0',

    text: '#1a1a1a',
    textMuted: '#666666',

    border: '#d4d4d4',
    borderActive: '#d4841e',

    primary: '#1976d2',
    secondary: '#42a5f5',
    accent: '#d4841e',
    success: '#2e7d32',
    warning: '#ed6c02',
    error: '#d32f2f',

    diffAdded: '#2e7d32',
    diffRemoved: '#d32f2f',
    diffAddedBg: '#e8f5e9',
    diffRemovedBg: '#ffebee',
};

export type ThemeMode = 'dark' | 'light';

interface ThemeContextValue {
    theme: ThemeColors;
    mode: ThemeMode;
    setMode: (mode: ThemeMode) => void;
    toggle: () => void;
}

export const { Provider: ThemeProvider, use: useTheme } = createSimpleContext<ThemeContextValue>('Theme', () => {
    const [mode, setMode] = useState<ThemeMode>('dark');

    const theme = useMemo(() => {
        return mode === 'dark' ? darkTheme : lightTheme;
    }, [mode]);

    const toggle = useCallback(() => {
        setMode((m) => (m === 'dark' ? 'light' : 'dark'));
    }, []);

    return useMemo(
        () => ({
            theme,
            mode,
            setMode,
            toggle,
        }),
        [theme, mode, toggle]
    );
});

export type ThemeContext = ReturnType<typeof useTheme>;
