/** @jsxImportSource @opentui/react */
/**
 * Home 路由 - 首页 (React 版本)
 */
import React, { useEffect, useRef, useMemo } from "react";
import { useRenderer } from "@opentui/react";
import { useTheme } from "../context/theme";
import { useAgent } from "../context/agent";
import { Prompt, type PromptRef } from "../components/prompt";
import { Message } from "../components/message";

export function Home() {
  const { theme } = useTheme();
  const agent = useAgent();
  const renderer = useRenderer();
  const promptRef = useRef<PromptRef>(null);

  useEffect(() => {
    promptRef.current?.focus();
  }, []);

  useEffect(() => {
    const normalizeRendererViewport = () => {
      if (renderer.experimental_splitHeight > 0) {
        renderer.experimental_splitHeight = 0;
      }
      if (renderer.useConsole) {
        renderer.useConsole = false;
      }
    };

    normalizeRendererViewport();
    const onResize = () => normalizeRendererViewport();
    renderer.on("resize", onResize);
    return () => {
      renderer.off("resize", onResize);
    };
  }, [renderer]);

  const messages = agent.state.messages;
  const hasMessages = messages.length > 0;

  // 获取当前日期
  const today = useMemo(
    () => new Date().toLocaleDateString(),
    []
  );

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      flexGrow={1}
      backgroundColor={theme.background}
    >
      {/* 顶栏 */}
      <box
        width="100%"
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={theme.backgroundPanel}
        border={["bottom"]}
        borderColor={theme.border}
        flexShrink={0}
      >
        <text fg={theme.accent}>
          <strong>QPSCode CLI</strong>
        </text>
        <text fg={theme.textMuted}>{today}</text>
      </box>

      {/* 主消息区 */}
      <box
        width="100%"
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        backgroundColor={theme.background}
      >
        <scrollbox
          width="100%"
          flexGrow={1}
          flexShrink={1}
          minHeight={0}
          stickyScroll={true}
          stickyStart="bottom"
          scrollX={false}
          rootOptions={{
            backgroundColor: theme.background,
          }}
          wrapperOptions={{
            backgroundColor: theme.background,
          }}
          viewportOptions={{
            backgroundColor: theme.background,
          }}
          contentOptions={{
            backgroundColor: theme.background,
          }}
          scrollbarOptions={{
            visible: false,
            showArrows: false,
          }}
          verticalScrollbarOptions={{
            visible: false,
            showArrows: false,
            trackOptions: {
              backgroundColor: theme.background,
              foregroundColor: theme.border,
            },
          }}
          horizontalScrollbarOptions={{
            visible: false,
            showArrows: false,
          }}
          backgroundColor={theme.background}
        >
          {!hasMessages ? (
            <box
              width="100%"
              flexGrow={1}
              justifyContent="center"
              alignItems="center"
              flexDirection="column"
              paddingTop={2}
            >
              <text fg={theme.textMuted}>Ready</text>
              <text fg={theme.textMuted}>Enter to send, Shift+Enter for newline, Esc to clear</text>
            </box>
          ) : (
            <box
              width="100%"
              height="100%"
              minHeight="100%"
              paddingLeft={0}
              paddingRight={0}
              paddingBottom={0}
              flexDirection="column"
            >
              {messages.map((message) => (
                <Message key={message.id} message={message} />
              ))}
            </box>
          )}
        </scrollbox>
      </box>

      {/* 错误栏 */}
      {agent.state.error && (
        <box
          width="100%"
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={theme.diffRemovedBg}
          border={["top", "bottom"]}
          borderColor={theme.error}
          flexShrink={0}
        >
          <text fg={theme.error}>
            <strong>Error: {agent.state.error}</strong>
          </text>
        </box>
      )}

      {/* 输入区 */}
      <box
        width="100%"
        paddingTop={0}
        paddingBottom={0}
        backgroundColor={theme.backgroundPanel}
        border={["top"]}
        borderColor={theme.border}
        minHeight={4}
        flexShrink={0}
      >
        <Prompt
          ref={promptRef}
          onSubmit={() => void 0}
        />
      </box>

      {/* 底栏 */}
      <box
        width="100%"
        flexDirection="row"
        justifyContent="space-between"
        backgroundColor={theme.backgroundPanel}
        border={["top"]}
        borderColor={theme.border}
        flexShrink={0}
      >
        <text fg={theme.textMuted}>cwd: {process.cwd()}</text>
        <text fg={theme.textMuted}>
          session: {agent.state.currentSessionId?.slice(0, 8) ?? "new"}
        </text>
      </box>
    </box>
  );
}
