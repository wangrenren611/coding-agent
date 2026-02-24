/**
 * Terminal OSC helpers for background management.
 * This targets terminal-level padding/margins that are outside OpenTUI render cells.
 */

const OSC = "\x1b]";
const BEL = "\x07";
const ST = "\x1b\\";
const CSI = "\x1b[";

function parseOscColorResponse(text: string, code: "10" | "11"): string | null {
  const prefix = `${OSC}${code};`;
  const start = text.indexOf(prefix);
  if (start === -1) return null;

  const valueStart = start + prefix.length;
  const belEnd = text.indexOf(BEL, valueStart);
  const stEnd = text.indexOf(ST, valueStart);

  let end = -1;
  if (belEnd !== -1 && stEnd !== -1) {
    end = Math.min(belEnd, stEnd);
  } else {
    end = belEnd !== -1 ? belEnd : stEnd;
  }

  if (end === -1 || end <= valueStart) return null;
  return text.slice(valueStart, end);
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function parseTerminalColor(raw: string): RgbColor | null {
  const color = raw.trim();

  if (color.startsWith("rgb:")) {
    const parts = color.slice(4).split("/");
    if (parts.length !== 3) return null;
    const values = parts.map((part) => {
      if (!/^[0-9a-fA-F]+$/.test(part)) return NaN;
      const n = parseInt(part, 16);
      const max = Math.pow(16, part.length) - 1;
      return max > 0 ? (n / max) * 255 : NaN;
    });
    if (values.some((v) => !Number.isFinite(v))) return null;
    return { r: clampByte(values[0]), g: clampByte(values[1]), b: clampByte(values[2]) };
  }

  if (color.startsWith("#")) {
    const hex = color.slice(1);
    if (hex.length === 6 && /^[0-9a-fA-F]{6}$/.test(hex)) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
    if (hex.length === 3 && /^[0-9a-fA-F]{3}$/.test(hex)) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
      };
    }
    return null;
  }

  if (color.startsWith("rgb(") && color.endsWith(")")) {
    const parts = color
      .slice(4, -1)
      .split(",")
      .map((s) => Number.parseInt(s.trim(), 10));
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
    return { r: clampByte(parts[0]), g: clampByte(parts[1]), b: clampByte(parts[2]) };
  }

  return null;
}

function luminance(color: RgbColor): number {
  return (0.299 * color.r + 0.587 * color.g + 0.114 * color.b) / 255;
}

type ForceBlackMode = "off" | "auto" | "always";

function getForceBlackMode(value: string | undefined): ForceBlackMode {
  if (value === undefined) return "auto";
  const normalized = value.toLowerCase();
  if (["0", "false", "no", "off"].includes(normalized)) return "off";
  if (["1", "true", "yes", "on", "always", "force"].includes(normalized)) return "always";
  return "auto";
}

/**
 * Query terminal default background color via OSC 11.
 * Returns the raw payload (e.g. `rgb:ffff/ffff/ffff` or `#ffffff`) when available.
 */
export async function queryTerminalBackground(timeoutMs = 1000): Promise<string | null> {
  return queryTerminalColor("11", timeoutMs);
}

export async function queryTerminalForeground(timeoutMs = 1000): Promise<string | null> {
  return queryTerminalColor("10", timeoutMs);
}

async function queryTerminalColor(code: "10" | "11", timeoutMs = 1000): Promise<string | null> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
    return null;
  }

  return new Promise((resolve) => {
    const previousRawMode = Boolean((stdin as NodeJS.ReadStream & { isRaw?: boolean }).isRaw);
    let settled = false;
    let responseBuffer = "";

    const cleanup = () => {
      stdin.removeListener("data", onData);
      clearTimeout(timeout);
      try {
        stdin.setRawMode(previousRawMode);
      } catch {
        // ignore terminal mode restoration failures
      }
    };

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const onData = (data: Buffer | string) => {
      const text = typeof data === "string" ? data : data.toString("utf8");
      responseBuffer += text;
      if (responseBuffer.length > 4096) {
        responseBuffer = responseBuffer.slice(-2048);
      }
      const value = parseOscColorResponse(responseBuffer, code);
      if (value) {
        finish(value);
      }
    };

    const timeout = setTimeout(() => finish(null), timeoutMs);

    try {
      stdin.setRawMode(true);
      stdin.on("data", onData);
      stdout.write(`${OSC}${code};?${BEL}`);
    } catch {
      finish(null);
    }
  });
}

/**
 * Set terminal default background via OSC 11.
 */
export function setTerminalBackground(color: string): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`${OSC}11;${color}${BEL}`);
}

export function setTerminalForeground(color: string): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`${OSC}10;${color}${BEL}`);
}

/**
 * Reset terminal default background to profile default (xterm-compatible OSC 111).
 */
export function resetTerminalBackground(): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`${OSC}111${BEL}`);
}

export function resetTerminalForeground(): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`${OSC}110${BEL}`);
}

function writeCsi(sequence: string): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`${CSI}${sequence}`);
}

type ScrollbackMode = "off" | "on";
type ScrollbarMode = "keep" | "hide";
type AlternateMode = "off" | "on";

function getScrollbackMode(value: string | undefined): ScrollbackMode {
  if (!value) return "on";
  const normalized = value.toLowerCase();
  return ["0", "false", "no", "off"].includes(normalized) ? "off" : "on";
}

function getScrollbarMode(value: string | undefined): ScrollbarMode {
  if (!value) return "keep";
  const normalized = value.toLowerCase();
  return ["hide", "hidden", "off", "0", "false", "no"].includes(normalized)
    ? "hide"
    : "keep";
}

function getAlternateMode(value: string | undefined): AlternateMode {
  if (!value) return "on";
  const normalized = value.toLowerCase();
  return ["0", "false", "no", "off"].includes(normalized) ? "off" : "on";
}

/**
 * Best-effort terminal viewport policy:
 * - clear scrollback before entering full-screen TUI
 * - optionally hide xterm-compatible scrollbar (not supported by all terminals)
 * - enable alternate scroll mode while running
 */
export function applyCliViewportPolicy(): () => void {
  if (!process.stdout.isTTY) return () => void 0;

  const scrollback = getScrollbackMode(process.env.QPSCLI_CLEAR_SCROLLBACK);
  const scrollbar = getScrollbarMode(process.env.QPSCLI_SCROLLBAR);
  const alternate = getAlternateMode(process.env.QPSCLI_ALTERNATE_SCREEN);

  if (alternate === "on") {
    writeCsi("?1049h");
  }

  if (scrollback === "on") {
    writeCsi("3J");
    writeCsi("H");
    writeCsi("2J");
  }

  if (scrollbar === "hide") {
    writeCsi("?30l");
  }

  writeCsi("?1007h");

  return () => {
    writeCsi("?1007l");
    if (scrollbar === "hide") {
      writeCsi("?30h");
    }
    if (alternate === "on") {
      writeCsi("?1049l");
    }
  };
}

/**
 * Optionally force a black terminal background while CLI is running.
 * Enabled by default; disable with `QPSCLI_FORCE_BLACK_BG=false`.
 */
export async function applyCliTerminalBackground(): Promise<() => void> {
  const mode = getForceBlackMode(process.env.QPSCLI_FORCE_BLACK_BG);
  if (mode === "off") return () => void 0;
  const [originalBackground, originalForeground] = await Promise.all([
    queryTerminalBackground(),
    queryTerminalForeground(),
  ]);
  if (!originalBackground && mode === "auto") return () => void 0;

  setTerminalBackground("#000000");

  let forcedForeground = false;
  const parsedForeground = originalForeground ? parseTerminalColor(originalForeground) : null;
  const foregroundNeedsBoost = parsedForeground ? luminance(parsedForeground) < 0.45 : true;
  if (foregroundNeedsBoost) {
    setTerminalForeground("#d8d8d8");
    forcedForeground = true;
  }

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    if (forcedForeground) {
      if (originalForeground) {
        setTerminalForeground(originalForeground);
      } else {
        resetTerminalForeground();
      }
    }
    if (originalBackground) {
      setTerminalBackground(originalBackground);
    } else {
      resetTerminalBackground();
    }
  };

  const onProcessExit = () => {
    restore();
  };

  process.once("beforeExit", onProcessExit);
  process.once("exit", onProcessExit);

  return () => {
    process.off("beforeExit", onProcessExit);
    process.off("exit", onProcessExit);
    restore();
  };
}
