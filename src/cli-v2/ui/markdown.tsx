import React, { useMemo } from 'react';
import { Text } from 'ink';
import { marked, parse } from 'marked';
import TerminalRenderer from 'marked-terminal';
import chalk from 'chalk';

const renderer = new TerminalRenderer({
  code: chalk.yellow,
  blockquote: chalk.gray.italic,
  heading: chalk.green.bold,
  firstHeading: chalk.green.bold,
  strong: chalk.bold,
  em: chalk.italic,
  codespan: chalk.yellow,
  del: chalk.dim.gray.strikethrough,
  link: chalk.blue,
  href: chalk.blue.underline,
  width: 80,
  reflowText: false,
  showSectionPrefix: false,
  unescape: true,
  emoji: true,
  tab: 2,
});

marked.setOptions({ renderer: renderer as any });

interface MarkdownProps {
  content: string;
}

export const Markdown: React.FC<MarkdownProps> = ({ content }) => {
  const rendered = useMemo(() => parse(content) as string, [content]);
  return <Text>{rendered}</Text>;
};
