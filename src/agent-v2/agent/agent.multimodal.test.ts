import { describe, expect, it } from 'vitest';
import { Agent } from './agent';
import { ToolRegistry } from '../tool/registry';
import {
  LLMProvider,
  type Chunk,
  type LLMGenerateOptions,
  type LLMRequestMessage,
  type LLMResponse,
  type MessageContent,
} from '../../providers';

class MockMultimodalProvider extends LLMProvider {
  public lastMessages: LLMRequestMessage[] = [];

  constructor() {
    super({
      apiKey: 'mock',
      baseURL: 'https://mock.local',
      model: 'mock-model',
      max_tokens: 1024,
      LLMMAX_TOKENS: 8192,
      temperature: 0,
    });
  }

  generate(
    messages: LLMRequestMessage[],
    options?: LLMGenerateOptions
  ): Promise<LLMResponse | null> | AsyncGenerator<Chunk> {
    this.lastMessages = messages;

    if (options?.stream) {
      return (async function* (): AsyncGenerator<Chunk> {
        yield {
          index: 0,
          choices: [{
            index: 0,
            delta: {
              role: 'assistant',
              content: 'ok',
            },
            finish_reason: 'stop',
          }],
        };
      })();
    }

    return Promise.resolve({
      id: 'mock-id',
      object: 'chat.completion',
      created: Date.now(),
      model: 'mock-model',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: 'ok',
        },
        finish_reason: 'stop',
      }],
    });
  }

  getTimeTimeout(): number {
    return 30000;
  }

  getLLMMaxTokens(): number {
    return 8192;
  }

  getMaxOutputTokens(): number {
    return 1024;
  }
}

describe('Agent multimodal input', () => {
  it('should pass multimodal user content to provider without flattening', async () => {
    const provider = new MockMultimodalProvider();
    const toolRegistry = new ToolRegistry({ workingDirectory: process.cwd() });

    const agent = new Agent({
      provider,
      toolRegistry,
      stream: false,
      systemPrompt: 'test',
    });

    const userContent: MessageContent = [
      { type: 'text', text: 'analyze this image and video' },
      { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
      { type: 'input_video', input_video: { url: 'https://example.com/video.mp4' } },
    ];

    const response = await agent.execute(userContent);

    expect(response.role).toBe('assistant');
    expect(response.content).toBe('ok');

    const userMessage = [...provider.lastMessages].reverse().find((message) => message.role === 'user');
    expect(userMessage).toBeDefined();
    expect(userMessage?.content).toEqual(userContent);
  });

  it('should reject invalid input_video part', async () => {
    const provider = new MockMultimodalProvider();
    const toolRegistry = new ToolRegistry({ workingDirectory: process.cwd() });
    const agent = new Agent({
      provider,
      toolRegistry,
      stream: false,
      systemPrompt: 'test',
    });

    await expect(
      agent.execute([
        { type: 'text', text: 'test' },
        { type: 'input_video', input_video: {} },
      ])
    ).rejects.toThrow('input_video part must include url, file_id, or data');
  });
});
