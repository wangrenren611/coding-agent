import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { Agent } from '../../../src/agent-v2/agent/agent.js';
import { operatorPrompt } from '../../../src/agent-v2/prompts/operator.js';
import { ProviderRegistry } from '../../../src/providers/registry.js';
import { createMemoryManager } from '../../../src/agent-v2/memory/index.js';
import type { AgentMessage } from '../../../src/agent-v2/agent/stream-types.js';

interface AppProps {
  model?: string;
  cwd?: string;
  language?: string;
}

export function App({ 
  model = 'glm-4.7', 
  cwd = process.cwd(), 
  language = 'Chinese' 
}: AppProps = {}) {
  const { exit } = useApp();
  
  const [input, setInput] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  
  const agentRef = useRef<Agent | null>(null);
  const streamingContentRef = useRef('');
  const lastOutputLineRef = useRef(0);
  const isCreatingRef = useRef(false);

  // 初始化 Agent
  useEffect(() => {
    const init = async () => {
      if (agentRef.current || isCreatingRef.current) return;
      isCreatingRef.current = true;
      
      try {
        const memoryManager = createMemoryManager({
          type: 'file',
          connectionString: './data/agent-memory-v2',
        });
        await memoryManager.initialize();

        const agent = new Agent({
          provider: ProviderRegistry.createFromEnv(model as never),
          systemPrompt: operatorPrompt({ directory: cwd, language }),
          stream: true,
          memoryManager,
          streamCallback: handleStreamMessage,
        });

        agentRef.current = agent;
      } catch (err) {
        process.stdout.write(`\x1b[31m✗ Init error: ${err}\x1b[0m\n`);
      } finally {
        isCreatingRef.current = false;
      }
    };
    
    init();
  }, [model, cwd, language]);

  // 清除之前的输出并重新渲染
  const clearAndRender = useCallback((content: string) => {
    // 清除之前的行
    if (lastOutputLineRef.current > 0) {
      process.stdout.write(`\x1b[${lastOutputLineRef.current}F\x1b[0J`);
    }
    
    // 渲染新内容
    const lines = content.split('\n');
    for (const line of lines) {
      process.stdout.write(`\x1b[32m  ${line}\x1b[0m\n`);
    }
    
    lastOutputLineRef.current = lines.length;
  }, []);

  // 处理流式消息
  const handleStreamMessage = useCallback((message: AgentMessage) => {
    switch (message.type) {
      case 'text-start':
        streamingContentRef.current = '';
        lastOutputLineRef.current = 0;
        break;
        
      case 'text-delta':
        streamingContentRef.current += message.payload.content;
        clearAndRender(streamingContentRef.current);
        break;
        
      case 'text-complete':
        // 最终输出
        if (lastOutputLineRef.current > 0) {
          process.stdout.write(`\x1b[${lastOutputLineRef.current}F\x1b[0J`);
        }
        const lines = streamingContentRef.current.split('\n');
        for (const line of lines) {
          process.stdout.write(`\x1b[32m  ${line}\x1b[0m\n`);
        }
        lastOutputLineRef.current = 0;
        streamingContentRef.current = '';
        break;
        
      case 'error':
        process.stdout.write(`\x1b[31m✗ Error: ${message.payload.error}\x1b[0m\n`);
        break;
    }
  }, [clearAndRender]);

  useInput((char, key) => {
    if (key.ctrl && char === 'c') { exit(); return; }
    if (key.escape) { 
      agentRef.current?.abort(); 
      setIsExecuting(false);
      return; 
    }
    if (key.return && !isExecuting) { 
      handleSubmit(); 
      return; 
    }
    if (!isExecuting) {
      if (key.backspace || key.delete) setInput(prev => prev.slice(0, -1));
      else if (char && !key.ctrl) setInput(prev => prev + char);
    }
  });

  const handleSubmit = useCallback(async () => {
    const query = input.trim();
    if (!query || !agentRef.current) return;
    
    setInput('');
    setIsExecuting(true);
    
    // 输出用户消息
    process.stdout.write(`\n\x1b[36m❯\x1b[0m ${query}\n`);
    
    try {
      await agentRef.current.execute(query);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`\x1b[31m✗ Error: ${errMsg}\x1b[0m\n`);
    } finally {
      setIsExecuting(false);
    }
  }, [input]);

  return (
    <Box flexDirection="column">
      {/* 输入框 - 只在非执行时显示 */}
      {!isExecuting && (
        <Box>
          <Text color="cyan">❯ </Text>
          <Text>{input}</Text>
          <Text dimColor>█</Text>
        </Box>
      )}
      
      {/* 状态栏 */}
      <Box marginTop={1}>
        <Text dimColor>Ctrl+C: Exit | Esc: Abort | Model: {model}</Text>
      </Box>
    </Box>
  );
}
