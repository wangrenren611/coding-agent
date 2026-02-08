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
  isStreaming?: boolean; // 是否正在流式输出
}

// 计算字符串的显示宽度（忽略 ANSI 转义码）
function calculateWidth(str: string): number {
  return str.replace(/\u001b\[[0-9;]*m/g, "").length;
}

// 渲染表格
function renderTable(table: marked.Tokens.Table): React.ReactNode {
  const { header, rows } = table;

  // 计算每列的最大宽度
  const columnWidths = header.map((_, colIndex) => {
    let maxWidth = calculateWidth(header[colIndex].text);
    for (const row of rows) {
      const cellWidth = calculateWidth(row[colIndex].text);
      if (cellWidth > maxWidth) {
        maxWidth = cellWidth;
      }
    }
    return maxWidth + 2; // 加上 padding
  });

  // 渲染表头
  const headerRow = (
    <Box>
      {header.map((cell, i) => (
        <Text key={`header-${i}`} bold>
          {" "}{cell.text}{" ".repeat(columnWidths[i] - calculateWidth(cell.text) - 1)}
        </Text>
      ))}
    </Box>
  );

  // 渲染分隔线
  const separatorRow = (
    <Box>
      {header.map((_, i) => (
        <Text key={`sep-${i}`} color="cyan">
          {"-" + "-".repeat(columnWidths[i] - 1)}
        </Text>
      ))}
    </Box>
  );

  // 渲染数据行
  const dataRows = rows.map((row, rowIndex) => (
    <Box key={`row-${rowIndex}`}>
      {row.map((cell, colIndex) => (
        <Text key={`cell-${rowIndex}-${colIndex}`}>
          {" "}{cell.text}{" ".repeat(columnWidths[colIndex] - calculateWidth(cell.text) - 1)}
        </Text>
      ))}
    </Box>
  ));

  return (
    <Box flexDirection="column" marginBottom={1}>
      {headerRow}
      {separatorRow}
      {dataRows}
    </Box>
  );
}

// 解析 markdown tokens
function renderTokens(tokens: marked.Token[], level: number = 0): React.ReactNode[] {
  const elements: React.ReactNode[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case "heading": {
        const heading = token as marked.Tokens.Heading;
        const color = heading.depth === 1 ? "cyan" : heading.depth === 2 ? "magenta" : "blue";
        elements.push(
          <Box key={token.raw} marginBottom={1}>
            <Text color={color} bold>
              {renderInlineText(heading.tokens)}
            </Text>
          </Box>
        );
        break;
      }

      case "paragraph": {
        const paragraph = token as marked.Tokens.Paragraph;
        elements.push(
          <Box key={token.raw} flexDirection="row" marginBottom={1} flexWrap="wrap">
            {renderInlineText(paragraph.tokens)}
          </Box>
        );
        break;
      }

      case "list": {
        const list = token as marked.Tokens.List;
        elements.push(
          <Box key={token.raw} flexDirection="column" marginBottom={1}>
            {list.items.map((item, i) => {
              const prefix = list.ordered ? `${i + 1}. ` : "• ";
              return (
                <Box key={i}>
                  <Text>{prefix}</Text>
                  {renderInlineText(item.tokens)}
                </Box>
              );
            })}
          </Box>
        );
        break;
      }

      case "code": {
        const code = token as marked.Tokens.Code;
        const lines = code.text.split("\n");
        elements.push(
          <Box key={token.raw} flexDirection="column" marginBottom={1} marginLeft={2}>
            {lines.map((line, i) => (
              <Text key={i} color="gray">
                {line}
              </Text>
            ))}
          </Box>
        );
        break;
      }

      case "blockquote": {
        const quote = token as marked.Tokens.Blockquote;
        elements.push(
          <Box key={token.raw} flexDirection="column" marginBottom={1} marginLeft={2}>
            {quote.tokens.map((t, i) => (
              <Box key={i} flexDirection="row">
                <Text color="yellow" italic>
                  {renderInlineText(t.type === "paragraph" ? (t as marked.Tokens.Paragraph).tokens : [t])}
                </Text>
              </Box>
            ))}
          </Box>
        );
        break;
      }

      case "hr": {
        elements.push(
          <Box key={token.raw} marginBottom={1}>
            <Text color="gray">{"─".repeat(80)}</Text>
          </Box>
        );
        break;
      }

      case "table": {
        elements.push(renderTable(token as marked.Tokens.Table));
        break;
      }

      case "space":
        break;

      default:
        // 处理其他类型
        if ("tokens" in token && Array.isArray((token as any).tokens)) {
          elements.push(
            <Box key={token.raw} flexDirection="row" marginBottom={1}>
              {renderInlineText((token as any).tokens)}
            </Box>
          );
        }
        break;
    }
  }

  return elements;
}

// 将内联 tokens 渲染为 Text 组件
function renderInlineText(tokens: marked.Token[]): React.ReactNode[] {
  const elements: React.ReactNode[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case "text":
        elements.push(<Text key={token.raw}>{(token as marked.Tokens.Text).text}</Text>);
        break;

      case "strong":
        elements.push(
          <Text key={token.raw} bold>
            {renderInlineText((token as marked.Tokens.Strong).tokens)}
          </Text>
        );
        break;

      case "em":
        elements.push(
          <Text key={token.raw} italic>
            {renderInlineText((token as marked.Tokens.Em).tokens)}
          </Text>
        );
        break;

      case "codespan":
        elements.push(
          <Text key={token.raw} color="cyan">
            {(token as marked.Tokens.Codespan).text}
          </Text>
        );
        break;

      case "link":
        elements.push(
          <Text key={token.raw} color="cyan" underline>
            {(token as marked.Tokens.Link).text || (token as marked.Tokens.Link).href}
          </Text>
        );
        break;

      case "del":
        elements.push(
          <Text key={token.raw} strikethrough>
            {renderInlineText((token as marked.Tokens.Del).tokens)}
          </Text>
        );
        break;

      case "br":
        elements.push(<Text key={token.raw}>{" "}</Text>);
        break;

      default:
        elements.push(<Text key={token.raw}>{(token as any).raw || ""}</Text>);
        break;
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
      return [
        <Text key="error" color="red">
          Error parsing markdown: {error instanceof Error ? error.message : String(error)}
        </Text>,
      ];
    }
  }, [content]);

  return <Box flexDirection="column">{elements}</Box>;
}
