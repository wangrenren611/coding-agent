import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { marked } from "marked";

// 配置 marked 使用 GitHub 风格
marked.setOptions({
  gfm: true,
  breaks: true,
});

interface MarkdownProps {
  content: string;
  maxWidth?: number;
  isStreaming?: boolean;
}

// 获取终端宽度
function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

// 渲染内联文本 - 返回文本数组用于拼接
function renderInlineText(tokens: marked.Token[]): string {
  return tokens.map((token) => {
    switch (token.type) {
      case "text":
        return (token as marked.Tokens.Text).text;
      case "strong":
        return renderInlineText((token as marked.Tokens.Strong).tokens);
      case "em":
        return renderInlineText((token as marked.Tokens.Em).tokens);
      case "codespan":
        return (token as marked.Tokens.Codespan).text;
      case "link":
        return (token as marked.Tokens.Link).text || (token as marked.Tokens.Link).href;
      case "del":
        return renderInlineText((token as marked.Tokens.Del).tokens);
      case "br":
        return " ";
      case "image":
        return `[${(token as marked.Tokens.Image).text || "image"}]`;
      default:
        return (token as any).raw || "";
    }
  }).join("");
}

// 渲染表格
function renderTable(table: marked.Tokens.Table, keyPrefix: string): React.ReactNode {
  const { header, rows } = table;

  // 计算每列的最大宽度
  const columnWidths = header.map((_, colIndex) => {
    let maxWidth = 0;
    for (const row of rows) {
      const len = row[colIndex]?.text?.length || 0;
      if (len > maxWidth) maxWidth = len;
    }
    const headerLen = header[colIndex]?.text?.length || 0;
    if (headerLen > maxWidth) maxWidth = headerLen;
    return Math.min(maxWidth + 2, 30); // 最大30字符
  });

  // 渲染单行
  const renderRow = (cells: marked.Tokens.TableCell[], isHeader: boolean, rowIdx: number) => (
    <Box key={`${keyPrefix}-row-${rowIdx}`} flexDirection="row">
      <Text color="gray">│</Text>
      {cells.map((cell, i) => (
        <Text key={`${keyPrefix}-cell-${rowIdx}-${i}`} {...(isHeader && { bold: true })}>
          {" " + (cell.text || "").padEnd(columnWidths[i] - 1).slice(0, columnWidths[i] - 1)}
        </Text>
      ))}
      <Text color="gray">│</Text>
    </Box>
  );

  // 渲染分隔线
  const renderSeparator = () => (
    <Box key={`${keyPrefix}-sep`} flexDirection="row">
      <Text color="gray">├</Text>
      {columnWidths.map((width, i) => (
        <Text key={`${keyPrefix}-sep-${i}`} color="gray">
          {"─".repeat(width)}
        </Text>
      ))}
      <Text color="gray">┤</Text>
    </Box>
  );

  // 渲染顶部边框
  const renderTopBorder = () => (
    <Box key={`${keyPrefix}-top`} flexDirection="row">
      <Text color="gray">┌</Text>
      {columnWidths.map((width, i) => (
        <Text key={`${keyPrefix}-top-${i}`} color="gray">
          {"─".repeat(width)}
        </Text>
      ))}
      <Text color="gray">┐</Text>
    </Box>
  );

  // 渲染底部边框
  const renderBottomBorder = () => (
    <Box key={`${keyPrefix}-bottom`} flexDirection="row">
      <Text color="gray">└</Text>
      {columnWidths.map((width, i) => (
        <Text key={`${keyPrefix}-bottom-${i}`} color="gray">
          {"─".repeat(width)}
        </Text>
      ))}
      <Text color="gray">┘</Text>
    </Box>
  );

  return (
    <Box key={keyPrefix} flexDirection="column" marginY={1}>
      {renderTopBorder()}
      {renderRow(header, true, -1)}
      {renderSeparator()}
      {rows.map((row, idx) => renderRow(row, false, idx))}
      {renderBottomBorder()}
    </Box>
  );
}

// 渲染列表项（支持嵌套）
function renderList(
  list: marked.Tokens.List,
  keyPrefix: string,
  depth: number = 0
): React.ReactNode {
  const indent = "  ".repeat(depth);

  return (
    <Box key={keyPrefix} flexDirection="column" marginY={0}>
      {list.items.map((item, itemIdx) => {
        const prefix = list.ordered ? `${itemIdx + 1}. ` : "• ";
        const itemKey = `${keyPrefix}-item-${itemIdx}`;

        // 检查列表项内容
        const content: React.ReactNode[] = [];
        let hasNestedList = false;

        for (let i = 0; i < item.tokens.length; i++) {
          const token = item.tokens[i];

          if (token.type === "list") {
            hasNestedList = true;
            content.push(
              renderList(token as marked.Tokens.List, `${itemKey}-nested-${i}`, depth + 1)
            );
          } else if (token.type === "text" || token.type === "paragraph") {
            const textToken = token as marked.Tokens.Text | marked.Tokens.Paragraph;
            content.push(
              <Text key={`${itemKey}-text-${i}`}>
                {indent + prefix + renderInlineText(textToken.tokens || [])}
              </Text>
            );
          } else {
            // 其他类型的 token 作为块级元素
            const block = renderBlockToken(token, `${itemKey}-block-${i}`, depth + 1);
            if (block) content.push(block);
          }
        }

        return (
          <Box key={itemKey} flexDirection="column">
            {!hasNestedList && content.length === 0 && (
              <Text>{indent}{prefix}</Text>
            )}
            {content}
          </Box>
        );
      })}
    </Box>
  );
}

// 渲染代码块
function renderCodeBlock(code: marked.Tokens.Code, keyPrefix: string): React.ReactNode {
  const lines = code.text.split("\n");
  const lang = code.lang || "";
  const maxWidth = getTerminalWidth() - 6;

  return (
    <Box key={keyPrefix} flexDirection="column" marginY={1}>
      {/* 代码块标题栏 */}
      {lang && (
        <Box flexDirection="row">
          <Text color="gray" backgroundColor="gray">     </Text>
          <Text color="black" backgroundColor="cyan"> {lang} </Text>
          <Text color="gray" backgroundColor="gray">{" ".repeat(Math.max(0, maxWidth - lang.length - 2))}</Text>
        </Box>
      )}
      {/* 代码内容 */}
      <Box flexDirection="column">
        {lines.map((line, idx) => (
          <Text key={`${keyPrefix}-line-${idx}`} color="gray">
            {line.slice(0, maxWidth) || " "}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

// 渲染引用块
function renderBlockquote(
  quote: marked.Tokens.Blockquote,
  keyPrefix: string,
  depth: number = 0
): React.ReactNode {
  const indent = "  ".repeat(depth);

  return (
    <Box key={keyPrefix} flexDirection="column" marginY={1}>
      {quote.tokens.map((token, idx) => {
        if (token.type === "paragraph") {
          const para = token as marked.Tokens.Paragraph;
          return (
            <Text key={`${keyPrefix}-p-${idx}`} color="yellow" italic>
              {indent + "▌ " + renderInlineText(para.tokens || [])}
            </Text>
          );
        }
        // 嵌套块
        const block = renderBlockToken(token, `${keyPrefix}-nested-${idx}`, depth + 1);
        if (block) {
          return (
            <Box key={`${keyPrefix}-nested-${idx}`} flexDirection="row">
              <Text color="yellow">{indent}▌ </Text>
              <Box flexDirection="column">{block}</Box>
            </Box>
          );
        }
        return null;
      })}
    </Box>
  );
}

// 渲染单个块级 token
function renderBlockToken(
  token: marked.Token,
  keyPrefix: string,
  depth: number = 0
): React.ReactNode {
  const maxWidth = getTerminalWidth() - 4;

  switch (token.type) {
    case "heading": {
      const heading = token as marked.Tokens.Heading;
      const colors: Record<number, string> = {
        1: "cyan",
        2: "greenBright",
        3: "blue",
        4: "magenta",
        5: "yellow",
        6: "gray",
      };
      const color = colors[heading.depth] || "white";
      const prefix = "#".repeat(heading.depth) + " ";

      return (
        <Box key={keyPrefix} flexDirection="column" marginY={1}>
          <Text color={color} bold>
            {prefix + renderInlineText(heading.tokens || [])}
          </Text>
        </Box>
      );
    }

    case "paragraph": {
      const paragraph = token as marked.Tokens.Paragraph;
      const tokens = paragraph.tokens || [];

      return (
        <Box key={keyPrefix} flexDirection="column" marginY={0}>
          <Text>{renderInlineText(tokens)}</Text>
        </Box>
      );
    }

    case "list":
      return renderList(token as marked.Tokens.List, keyPrefix, depth);

    case "code":
      return renderCodeBlock(token as marked.Tokens.Code, keyPrefix);

    case "blockquote":
      return renderBlockquote(token as marked.Tokens.Blockquote, keyPrefix, depth);

    case "hr":
      return (
        <Box key={keyPrefix} flexDirection="column" marginY={1}>
          <Text color="gray">{"─".repeat(Math.min(60, maxWidth))}</Text>
        </Box>
      );

    case "table":
      return renderTable(token as marked.Tokens.Table, keyPrefix);

    case "space":
      return null;

    case "html":
      // 处理 HTML 注释等特殊内容
      return null;

    default:
      // 处理其他类型（如 task list）
      if ("tokens" in token && Array.isArray((token as any).tokens)) {
        return (
          <Box key={keyPrefix} flexDirection="column" marginY={0}>
            <Text>{renderInlineText((token as any).tokens || [])}</Text>
          </Box>
        );
      }
      return null;
  }
}

// 主渲染函数
function renderTokens(tokens: marked.Token[]): React.ReactNode[] {
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const rendered = renderBlockToken(token, `token-${i}`);
    if (rendered) {
      elements.push(rendered);
    }
  }

  return elements;
}

export function Markdown({ content }: MarkdownProps): React.JSX.Element {
  const elements = useMemo(() => {
    try {
      const tokens = marked.lexer(content);
      return renderTokens(tokens);
    } catch (error) {
      return (
        <Box flexDirection="column">
          <Text color="red">
            Error parsing markdown: {error instanceof Error ? error.message : String(error)}
          </Text>
          <Text color="gray">{content}</Text>
        </Box>
      );
    }
  }, [content]);

  return <Box flexDirection="column">{elements}</Box>;
}
