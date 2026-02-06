/**
 * cli-tui Theme Configuration
 * OpenTUI-compatible theme with enhanced colors and styles
 */
import { execSync } from 'node:child_process';

// ==================== Colors ====================

export type ThemeMode = 'light' | 'dark';

const detectThemeMode = (): ThemeMode => {
  const forced = (process.env.CLI_TUI_THEME || '').toLowerCase();
  if (forced === 'light' || forced === 'dark') {
    return forced;
  }

  const backgroundHints = [
    process.env.TERM_BACKGROUND,
    process.env.TERMINAL_BACKGROUND,
    process.env.TERM_THEME,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (backgroundHints.includes('light')) return 'light';
  if (backgroundHints.includes('dark')) return 'dark';

  const colorfgbg = process.env.COLORFGBG;
  if (colorfgbg) {
    const lastSegment = colorfgbg.split(';').at(-1);
    const bgCode = Number(lastSegment);
    if (Number.isFinite(bgCode)) {
      // 7/15 are common light backgrounds; >=10 is usually bright.
      if (bgCode === 7 || bgCode === 15 || bgCode >= 10) {
        return 'light';
      }
      return 'dark';
    }
  }

  if (process.platform === 'darwin') {
    try {
      const output = execSync('defaults read -g AppleInterfaceStyle', {
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
      }).trim().toLowerCase();
      if (output.includes('dark')) return 'dark';
      return 'light';
    } catch {
      // On macOS, this command throws in light mode.
      return 'light';
    }
  }

  return 'dark';
};

export const THEME_MODE: ThemeMode = detectThemeMode();
const isLight = THEME_MODE === 'light';

export const COLORS = {
  // Base colors
  primary: isLight ? '#2563eb' : '#6366f1',
  secondary: isLight ? '#0f766e' : '#8b5cf6',
  accent: isLight ? '#0891b2' : '#06b6d4',

  // Semantic colors
  user: isLight ? '#047857' : '#10b981',
  assistant: isLight ? '#0f172a' : '#e5e7eb',
  tool: isLight ? '#b45309' : '#f59e0b',
  system: isLight ? '#b91c1c' : '#ef4444',
  info: isLight ? '#1d4ed8' : '#60a5fa',
  warning: isLight ? '#b45309' : '#eab308',
  success: isLight ? '#15803d' : '#22c55e',
  error: isLight ? '#b91c1c' : '#dc2626',

  // Text colors
  text: isLight ? '#0f172a' : '#f8fafc',
  textMuted: isLight ? '#334155' : '#94a3b8',

  // Neutral colors
  muted: isLight ? '#475569' : '#64748b',
  border: isLight ? '#94a3b8' : '#334155',
  background: isLight ? '#f8fafc' : '#0f172a',
  surface: isLight ? '#eef2f7' : '#111827',

  // Diff colors
  diffAdd: isLight ? '#15803d' : '#22c55e',
  diffRemove: isLight ? '#b91c1c' : '#ef4444',
  diffHeader: isLight ? '#475569' : '#64748b',
} as const;

// ==================== Icons (Unicode) ====================

export const ICONS = {
  user: '●',
  assistant: '◆',
  tool: '⚙',
  result: '→',
  success: '✓',
  error: '✗',
  running: '⟳',
  diff: '±',
  info: 'ⓘ',
  warning: '⚠',
  thinking: '⋯',
  edit: '✎',
  folder: '📁',
  file: '📄',
  search: '🔍',
} as const;

// ==================== Display Constants ====================

export const DISPLAY = {
  maxPreviewLen: 50,
  maxResultLen: 80,
  maxSafeDepth: 2,
  minViewHeight: 6,
  minContentWidth: 20,
  scrollbarWidth: 1,
  maxStreamLines: 5,
  messageGapLines: 2,
  maxMessageLines: 1000, // Maximum lines per message before truncation
} as const;

// ==================== Layout ====================

export const LAYOUT = {
  inputHeight: 3,
  statusBarHeight: 1,
  helpHeight: 2,
  minTerminalWidth: 60,
  minTerminalHeight: 20,
} as const;

// ==================== Animation ====================

export const ANIMATION = {
  cursorBlinkMs: 500,
  streamUpdateMs: 33, // ~30fps
  spinnerFrameMs: 100,
} as const;

// ==================== Limits ====================

export const LIMITS = {
  maxMessages: 200,
  maxHistorySize: 200,
  streamFlushMs: 33,
} as const;

// ==================== Key Bindings ====================

export const KEY_BINDINGS = {
  exit: 'Ctrl+C',
  submit: 'Enter',
  newline: 'Shift+Enter',
  historyPrev: 'Ctrl+P / ↑',
  historyNext: 'Ctrl+N / ↓',
  scrollUp: 'PageUp / Ctrl+U',
  scrollDown: 'PageDown / Ctrl+D',
  scrollToTop: 'Home',
  scrollToBottom: 'End',
  closeOverlay: 'Esc',
  openHelp: 'Ctrl+H',
  openModels: 'Ctrl+M',
  openCommand: 'Ctrl+P',
} as const;

// ==================== Spinner Frames ====================

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

// ==================== Help Text ====================

export const HELP_TEXT = [
  'Keyboard Shortcuts:',
  '  Ctrl+C      Exit',
  '  Enter       Send message',
  '  Esc         Close overlay',
  '  PageUp/Down Scroll messages',
  '  Ctrl+H      Show help',
] as const;
