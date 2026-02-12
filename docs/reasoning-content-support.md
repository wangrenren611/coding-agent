## 流式响应 reasoning_content 支持

### 修改内容总结

#### 1. stream-types.ts - 添加新的消息类型

```typescript
// 新增消息类型
REASONING_START = 'reasoning-start',       // 开始推理/思考
REASONING_DELTA = 'reasoning-delta',       // 推理/思考增量内容
REASONING_COMPLETE = 'reasoning-complete', // 推理/思考完成

// 新增消息接口
interface ReasoningStartMessage extends BaseAgentMessage {
  type: AgentMessageType.REASONING_START;
  payload: { content: string };
  msgId: string;
}

interface ReasoningDeltaMessage extends BaseAgentMessage {
  type: AgentMessageType.REASONING_DELTA;
  payload: { content: string };
  msgId: string;
}

interface ReasoningCompleteMessage extends BaseAgentMessage {
  type: AgentMessageType.REASONING_COMPLETE;
  payload: { content: string };
  msgId: string;
}
```

#### 2. types-internal.ts - 添加推理内容检测函数

```typescript
// 检查 chunk 是否包含推理内容增量
export function hasReasoningDelta(chunk: Chunk): boolean {
    const delta = chunk.choices?.[0]?.delta;
    return !!delta && typeof (delta as any).reasoning_content === 'string' && (delta as any).reasoning_content !== '';
}

// 获取 chunk 中的 reasoning_content
export function getChunkReasoningContent(chunk: Chunk): string {
    const delta = chunk.choices?.[0]?.delta;
    const reasoningContent = (delta as any)?.reasoning_content;
    if (!reasoningContent) return '';
    return typeof reasoningContent === 'string' ? reasoningContent : '';
}
```

#### 3. stream-processor.ts - 处理推理内容

```typescript
export interface StreamProcessorOptions {
    // ... 现有选项
    // 推理内容回调 (thinking 模式)
    onReasoningDelta?: (content: string, messageId: string) => void;
    onReasoningStart?: (messageId: string) => void;
    onReasoningComplete?: (messageId: string) => void;
}

export class StreamProcessor {
    private reasoningBuffer = '';  // 推理内容缓冲区
    private reasoningStarted = false;

    processChunk(chunk: Chunk): void {
        // ... 现有处理

        // 处理推理内容增量 (reasoning_content) - thinking 模式
        if (hasReasoningDelta(chunk)) {
            this.handleReasoningDelta(reasoningContent, chunk.id, finishReason);
        }

        // ... 其他处理
    }

    private handleReasoningDelta(content: string, chunkId: string | undefined, finishReason: FinishReason | undefined): void {
        if (!this.appendToReasoningBuffer(content)) return;

        if (!this.reasoningStarted) {
            this.reasoningStarted = true;
            this.options.onReasoningStart?.(this.currentMessageId);
        }

        this.options.onReasoningDelta?.(content, this.currentMessageId);

        if (finishReason) {
            this.options.onReasoningComplete?.(this.currentMessageId);
        }
    }
}
```

#### 4. agent.ts - 添加推理内容发射方法并连接到 StreamProcessor

```typescript
// 在构造函数中
this.streamProcessor = new StreamProcessor({
    maxBufferSize: this.maxBufferSize,
    onMessageCreate: (msg) => this.session.addMessage(msg as Message),
    onMessageUpdate: (msg) => this.session.addMessage(msg as Message),
    onTextDelta: (content, msgId) => this.emitTextDelta(content, msgId),
    onTextStart: (msgId) => this.emitTextStart(msgId),
    onTextComplete: (msgId) => this.emitTextComplete(msgId),
    // 新增推理内容回调
    onReasoningDelta: (content, msgId) => this.emitReasoningDelta(content, msgId),
    onReasoningStart: (msgId) => this.emitReasoningStart(msgId),
    onReasoningComplete: (msgId) => this.emitReasoningComplete(msgId),
});

// 新增发射方法
private emitReasoningStart(messageId: string): void {
    this.streamCallback?.({
        type: AgentMessageType.REASONING_START,
        payload: { content: '' },
        msgId: messageId,
        sessionId: this.session.getSessionId(),
        timestamp: this.timeProvider.getCurrentTime(),
    });
}

private emitReasoningDelta(content: string, messageId: string): void {
    this.streamCallback?.({
        type: AgentMessageType.REASONING_DELTA,
        payload: { content },
        msgId: messageId,
        sessionId: this.session.getSessionId(),
        timestamp: this.timeProvider.getCurrentTime(),
    });
}

private emitReasoningComplete(messageId: string): void {
    this.streamCallback?.({
        type: AgentMessageType.REASONING_COMPLETE,
        payload: { content: '' },
        msgId: messageId,
        sessionId: this.session.getSessionId(),
        timestamp: this.timeProvider.getCurrentTime(),
    });
}
```

### 使用示例

#### CLI 中处理推理内容

```typescript
const agent = new Agent({
    provider: ProviderRegistry.createFromEnv('glm-5'),
    systemPrompt: '...',
    thinking: true,  // 启用 thinking 模式
    stream: true,
    streamCallback: (message) => {
        switch (message.type) {
            case 'reasoning-start':
                console.log(chalk.gray('💭 开始思考...'));
                break;
            case 'reasoning-delta':
                // 显示推理过程（可折叠）
                process.stdout.write(chalk.dim(message.payload.content));
                break;
            case 'reasoning-complete':
                console.log(); // 换行
                break;
            case 'text-start':
                console.log(chalk.green('┌─ AI'));
                break;
            case 'text-delta':
                process.stdout.write(message.payload.content);
                break;
            case 'text-complete':
                console.log();
                break;
        }
    },
});
```

### API 响应格式

当启用 thinking 模式时，LLM 的响应格式：

```json
{
    "choices": [{
        "delta": {
            "reasoning_content": "让我分析一下这个问题...",
            "content": ""
        }
    }]
}

// 然后是正式回复
{
    "choices": [{
        "delta": {
            "reasoning_content": "",
            "content": "根据分析，我建议..."
        }
    }]
}
```
