#!/usr/bin/env node
/** @jsxImportSource @opentui/react */
/**
 * QPSCode CLI 入口
 */
import React from "react";
import { createRoot } from "@opentui/react";
import { createCliRenderer, clearEnvCache } from "@opentui/core";
import { App } from "./app";
import { RouteProvider } from "./context/route";
import { AgentProvider } from "./context/agent";
import { ThemeProvider } from "./context/theme";
import { applyCliTerminalBackground, applyCliViewportPolicy } from "./terminal";

export interface CLIOptions {
  onExit?: () => Promise<void>;
}

/**
 * 启动 TUI 应用
 */
export async function startCLI(options: CLIOptions = {}): Promise<void> {
  return new Promise((resolve) => {
    void (async () => {
      let resolved = false;
      const restoreTerminalBackground = await applyCliTerminalBackground();
      const restoreViewport = applyCliViewportPolicy();

      // OpenTUI renderer options can be overridden by env vars.
      // Force terminal mode here to avoid host shell/profile pollution.
      process.env.OTUI_USE_ALTERNATE_SCREEN = "true";
      process.env.OTUI_USE_CONSOLE = "false";
      process.env.OTUI_NO_NATIVE_RENDER = "false";
      process.env.OTUI_OVERRIDE_STDOUT = "false";
      process.env.OTUI_SHOW_STATS = "false";
      process.env.OTUI_DEBUG = "false";
      process.env.OTUI_DUMP_CAPTURES = "false";
      clearEnvCache();

      const doResolve = async () => {
        if (resolved) return;
        resolved = true;
        restoreViewport();
        restoreTerminalBackground();
        await options.onExit?.();
        resolve();
      };

      try {
        // 创建 CLI 渲染器，exitOnCtrlC 让渲染器自动处理 Ctrl+C
        const renderer = await createCliRenderer({
          stdin: process.stdin,
          stdout: process.stdout,
          remote: false,
          targetFps: 60,
          exitOnCtrlC: true,
          useAlternateScreen: false,
          experimental_splitHeight: 0,
          useMouse: true,
          autoFocus: true,
          useConsole: false,
          openConsoleOnError: false,
          backgroundColor: "#000000",
          onDestroy: () => {
            void doResolve();
          },
        });
        renderer.disableStdoutInterception();

        const hardClearScrollback =
          !["0", "false", "off", "no"].includes(
            (process.env.QPSCLI_HARD_CLEAR_SCROLLBACK || "on").toLowerCase()
          );
        if (hardClearScrollback && process.stdout.isTTY) {
          const clearScrollbackFrame = async () => {
            process.stdout.write("\x1b[3J");
          };
          renderer.setFrameCallback(clearScrollbackFrame);
          renderer.on("destroy", () => {
            renderer.removeFrameCallback(clearScrollbackFrame);
          });
        }

        // 创建 React root 并渲染
        const root = createRoot(renderer);
        root.render(
          <ThemeProvider>
            <RouteProvider>
              <AgentProvider>
                <App />
              </AgentProvider>
            </RouteProvider>
          </ThemeProvider>
        );
      } catch (error) {
        console.error("Failed to start CLI:", error);
        await doResolve();
      }
    })();
  });
}

// 导出所有必要的组件和类型
export { App } from "./app";
export * from "./context";
export * from "./components";
export * from "./routes";
