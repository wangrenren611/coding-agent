import type { SlashCommand } from "../types";

export function parseSlashCommand(input: string): SlashCommand | null {
  if (!input.startsWith("/")) return null;

  const [rawName, rawArg] = input.trim().split(/\s+/, 2);
  const name = rawName.slice(1).toLowerCase();

  switch (name) {
    case "help":
      return { type: "help" };
    case "clear":
      return { type: "clear" };
    case "pause":
      return { type: "pause" };
    case "resume":
      return { type: "resume" };
    case "reset":
      return { type: "reset" };
    case "abort":
      return { type: "abort" };
    case "exit":
    case "quit":
      return { type: "exit" };
    case "prune": {
      const keepLast = rawArg ? Number(rawArg) : undefined;
      return { type: "prune", keepLast: Number.isFinite(keepLast) ? keepLast : undefined };
    }
    default:
      return null;
  }
}

export function buildHelpText(): string {
  return [
    "Slash Commands:",
    "/help           Show command help",
    "/clear          Clear current screen list (keep current agent session)",
    "/pause          Pause output refresh (good for terminal native scroll)",
    "/resume         Resume output refresh",
    "/reset          Reset list and create a new agent session",
    "/abort          Abort current running task",
    "/prune [n]      Keep only latest n messages (default 20)",
    "/exit           Exit CLI",
    "Hotkeys: Ctrl+S pause output, Ctrl+Q resume output, Esc abort running task",
  ].join("\n");
}
