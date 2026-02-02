/**
 * Markdown Text Component
 *
 * Renders Markdown using marked + marked-terminal with custom theme
 */

import React from 'react';
import { Box, Text } from 'ink';
import { marked, parse } from 'marked';
import TerminalRenderer from 'marked-terminal';
import { COLORS } from '../../utils/constants';

// Import chalk for custom styling
import chalk from 'chalk';

interface MarkdownTextProps {
  content: string;
  isStreaming?: boolean;
}

const MarkdownText: React.FC<MarkdownTextProps> = ({ content, isStreaming }) => {
  // Show streaming indicator if content is being streamed
  if (isStreaming) {
    return (
      <Box marginBottom={1}>
        <Text dimColor>{content}</Text>
        <Text color={COLORS.WARNING}>…</Text>
      </Box>
    );
  }

  // Custom markdown theme using project colors
  const markdownTheme = {
    code: chalk.yellow,
    blockquote: chalk.gray.italic,
    html: chalk.gray,
    heading: chalk.green.bold,
    firstHeading: chalk.magenta.underline.bold,
    hr: chalk.reset,
    listitem: chalk.reset,
    paragraph: chalk.reset,
    strong: chalk.bold,
    em: chalk.italic,
    codespan: chalk.yellow,
    del: chalk.dim.gray.strikethrough,
    link: chalk.blue,
    href: chalk.blue.underline,
    keyword: chalk.blue,
    width: 80,
    reflowText: false,
    showSectionPrefix: true,
    unescape: true,
    emoji: true,
    tableOptions: {},
    tab: 1
  };

  // Configure marked with custom terminal renderer for each render
  const renderer = new TerminalRenderer(markdownTheme);
  marked.setOptions({ renderer: renderer as any });

  // Parse markdown to terminal-formatted string
  const renderedContent = parse(content) as string;

  return (<Text>{renderedContent}</Text>
  );
};

export default MarkdownText;
