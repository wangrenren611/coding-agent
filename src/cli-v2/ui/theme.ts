export const COLORS = {
  user: 'gray',
  assistant: 'white',
  tool: 'green',
  system: 'red',
  muted: 'gray',
  info: 'blue',
  warning: 'yellow',
  diff: 'magenta',
  diffAdd: 'green',
  diffRemove: 'red',
} as const;

export const ICONS = {
  user: '>',
  assistant: '●',
  tool: '●',
  result: '|',
  success: 'ok',
  error: 'err',
  running: '~',
  diff: '±',
} as const;

export const LIMITS = {
  maxMessages: 200,
  streamFlushMs: 33,
} as const;

export const DISPLAY = {
  maxPreviewLen: 50,
  maxResultLen: 80,
  maxSafeDepth: 2,
  minViewHeight: 6,
  minContentWidth: 20,
  scrollbarWidth: 1,
  maxStreamLines: 5,
} as const;

export const SCROLL = {
  pageStep: 'viewHeight',
} as const;
