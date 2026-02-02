/**
 * CLI Constants
 */

// ============================================================================
// UI Constants
// ============================================================================

export const MAX_DISPLAYED_MESSAGES = 20;
export const MAX_TOOL_ARGS_PREVIEW = 50;
export const MAX_TOOL_OUTPUT_PREVIEW = 200;
export const SPINNER_INTERVAL_MS = 80;
export const INITIAL_DELAY_MS = 100;

// ============================================================================
// Icons
// ============================================================================

export const ICONS = {
  USER: '👨',
  INPUT: '❯',
  ASSISTANT: '●',
  SYSTEM: '⚠️',
  TOOL: '⚡',
  TOOL_CALLING: '⏳',
  TOOL_SUCCESS: '✅',
  TOOL_ERROR: '❌',
  CHECK: '✓',
  ERROR: '✗',
  SPINNER_FRAMES: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
} as const;

// ============================================================================
// Colors
// ============================================================================

export const COLORS = {
  PRIMARY: 'cyan',
  SECONDARY: 'green',
  ACCENT: 'yellowBright',
  ERROR: 'red',
  WARNING: 'yellow',
  INFO: 'blue',
  DIM: 'gray',
} as const;

// ============================================================================
// Messages
// ============================================================================

export const MESSAGES = {
  LOADING: 'Loading...',
  READY: 'Ready',
  THINKING: 'Thinking...',
  NO_MESSAGES: 'No messages yet. Start chatting!',
  TOOL_EXECUTING: 'Executing',
} as const;
