/**
 * cli-tui Theme Configuration
 * OpenTUI-compatible theme with enhanced colors and styles
 */

// ==================== Colors ====================

export const COLORS = {
  // Base colors
  primary: '#6366f1',      // Indigo
  secondary: '#8b5cf6',    // Violet
  accent: '#06b6d4',       // Cyan

  // Semantic colors
  user: '#10b981',         // Emerald green
  assistant: '#f8fafc',    // Slate white
  tool: '#f59e0b',         // Amber
  system: '#ef4444',       // Red
  info: '#3b82f6',         // Blue
  warning: '#eab308',      // Yellow
  success: '#22c55e',      // Green
  error: '#dc2626',        // Red

  // Neutral colors
  muted: '#64748b',        // Slate gray
  border: '#334155',       // Border gray
  background: '#0f172a',   // Dark background

  // Diff colors
  diffAdd: '#22c55e',
  diffRemove: '#ef4444',
  diffHeader: '#64748b',
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
