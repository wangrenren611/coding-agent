export const COLORS = {
  user: 'cyan',
  assistant: 'green',
  tool: 'yellow',
  system: 'red',
  muted: 'gray',
  info: 'blue',
  warning: 'yellow',
} as const;

export const ICONS = {
  user: '>',
  assistant: '*',
  tool: '-',
  result: '|',
  success: 'ok',
  error: 'err',
  running: '~',
} as const;

export const LIMITS = {
  maxMessages: 200,
  streamFlushMs: 33,
} as const;
