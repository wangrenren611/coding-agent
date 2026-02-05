/**

* OpenTUI - 最简单的实现方式
 * 功能：输入、列表展示、窗口滚动
 */

import { useState } from 'react';
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';

export function App() {
  const [value, setValue] = useState('');
  const [messages, setMessages] = useState<string[]>(['欢迎！请输入消息。']);

  const handleSubmit = (submitted: string) => {
    if (!submitted.trim()) return;
    setMessages(prev => [...prev, `你: ${submitted}`]);
    setValue('');
  };

  return (
    <box flexDirection="column" padding={1} width="100%" height="100%">
      {/* 消息列表 - 可滚动 */}
      <scrollbox width="100%" flexGrow={1} marginBottom={1}>
        {messages.map((msg, i) => (
          <box key={i}>
            <text>{msg}</text>
          </box>
        ))}
      </scrollbox>

      {/* 输入框 */}
      <box borderStyle="single" padding={1}>
        <text color="green">{'> '} </text>
        <input
          value={value}
          onInput={setValue}
          onSubmit={handleSubmit}
          placeholder="输入消息..."
          focused={true}
        />
      </box>

      {/* 提示信息 */}
      <box paddingX={1}>
        <text dimColor>Enter 发送 | Ctrl+C 退出</text>
      </box>
    </box>
  );
}

export async function main() {
  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  const root = createRoot(renderer);
  root.render(<App />);
  return new Promise<void>(() => {});
}
