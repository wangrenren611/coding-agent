import React, { useMemo, useRef } from "react";
import { Box, Text } from "ink";
import { Lexer, Parser } from "marked";
import TerminalRenderer from "marked-terminal";

interface MarkdownProps {
  content: string;
  maxWidth?: number;
  isStreaming?: boolean;
}

const DEFAULT_WIDTH = 80;
const MIN_WIDTH = 40;

function getRenderWidth(maxWidth?: number): number {
  const terminalWidth = process.stdout.columns || DEFAULT_WIDTH;
  const width = maxWidth ?? (terminalWidth - 8);
  return Math.max(MIN_WIDTH, width);
}

function sanitizeForTerminal(value: string): string {
  return value.replace(/\u0000/g, "");
}

// 缓存 Markdown 渲染器实例
let cachedRenderer: TerminalRenderer | null = null;
let cachedLexer: Lexer | null = null;
let cachedParser: Parser | null = null;
let cachedWidth: number = 0;

function getRenderer(width: number): { renderer: TerminalRenderer; lexer: Lexer; parser: Parser } {
  // 如果宽度变了，需要重新创建 renderer
  if (cachedWidth !== width || !cachedRenderer || !cachedLexer || !cachedParser) {
    cachedRenderer = new TerminalRenderer({
      width,
      reflowText: true,
      showSectionPrefix: true,
      tab: 2,
      unescape: true,
    });

    cachedLexer = new Lexer({
      gfm: true,
      breaks: false,
      mangle: false,
      headerIds: false,
    });

    cachedParser = new Parser({
      gfm: true,
      breaks: false,
      renderer: cachedRenderer,
    });

    cachedWidth = width;
  }

  return { renderer: cachedRenderer!, lexer: cachedLexer!, parser: cachedParser! };
}

function parseMarkdown(content: string, width: number): string {
  const { renderer, lexer, parser } = getRenderer(width);
  
  const tokens = lexer.lex(content);
  return parser.parse(tokens);
}

export function Markdown({ content, maxWidth, isStreaming }: MarkdownProps): React.JSX.Element {
  const rendered = useMemo(() => {
    const normalized = sanitizeForTerminal(content);
    if (!normalized.trim()) return "";

    try {
      return parseMarkdown(normalized, getRenderWidth(maxWidth)).trimEnd();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Markdown render error: ${message}\n${normalized}`;
    }
  }, [content, maxWidth]);

  const lines = useMemo(() => {
    return rendered.split("\n");
  }, [rendered]);

  // 使用 index 作为稳定的 key，不包含 line.length
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Text key={index}>{line}</Text>
      ))}
    </Box>
  );
}
