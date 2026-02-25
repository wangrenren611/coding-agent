import { describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider } from './openai-compatible';
import type { Chunk } from './types';

function createDoneStream(): ReadableStream<Uint8Array> {
    return new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            controller.close();
        },
    });
}

async function drainStream(stream: AsyncGenerator<Chunk>): Promise<void> {
    for await (const _ of stream) {
        // no-op
    }
}

describe('OpenAICompatibleProvider request options', () => {
    it('should include stream_options.include_usage by default in stream mode', async () => {
        const provider = new OpenAICompatibleProvider({
            apiKey: 'test-key',
            baseURL: 'https://api.example.com',
            model: 'gpt-4',
            temperature: 0.7,
            max_tokens: 2000,
            LLMMAX_TOKENS: 8000,
        });

        const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
            ok: true,
            status: 200,
            body: createDoneStream(),
        } as Response);

        const stream = provider.generate([{ role: 'user', content: 'hello' }], {
            stream: true,
        }) as AsyncGenerator<Chunk>;
        await drainStream(stream);

        const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
        expect(requestBody.stream).toBe(true);
        expect(requestBody.stream_options?.include_usage).toBe(true);
    });

    it('should respect explicit stream_options.include_usage=false', async () => {
        const provider = new OpenAICompatibleProvider({
            apiKey: 'test-key',
            baseURL: 'https://api.example.com',
            model: 'gpt-4',
            temperature: 0.7,
            max_tokens: 2000,
            LLMMAX_TOKENS: 8000,
        });

        const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
            ok: true,
            status: 200,
            body: createDoneStream(),
        } as Response);

        const stream = provider.generate([{ role: 'user', content: 'hello' }], {
            stream: true,
            stream_options: {
                include_usage: false,
            },
        }) as AsyncGenerator<Chunk>;
        await drainStream(stream);

        const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
        expect(requestBody.stream_options?.include_usage).toBe(false);
    });

    it('should not send thinking flag in standard adapter request body', async () => {
        const provider = new OpenAICompatibleProvider({
            apiKey: 'test-key',
            baseURL: 'https://api.example.com',
            model: 'gpt-4',
            temperature: 0.7,
            max_tokens: 2000,
            LLMMAX_TOKENS: 8000,
            thinking: false,
        });

        const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
            ok: true,
            status: 200,
            body: createDoneStream(),
        } as Response);

        const stream = provider.generate([{ role: 'user', content: 'hello' }], {
            stream: true,
        }) as AsyncGenerator<Chunk>;
        await drainStream(stream);

        const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
        expect(requestBody.thinking).toBeUndefined();
    });

    it('should preserve multimodal content parts in request body', async () => {
        const provider = new OpenAICompatibleProvider({
            apiKey: 'test-key',
            baseURL: 'https://api.example.com',
            model: 'gpt-4',
            temperature: 0.7,
            max_tokens: 2000,
            LLMMAX_TOKENS: 8000,
        });

        const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
            ok: true,
            status: 200,
            body: createDoneStream(),
        } as Response);

        const userContent = [
            { type: 'text', text: 'describe this media' },
            { type: 'image_url', image_url: { url: 'https://example.com/demo.png' } },
            { type: 'file', file: { file_id: 'file-video-1', filename: 'demo.mp4' } },
            { type: 'input_video', input_video: { url: 'https://example.com/clip.mp4' } },
        ] as const;

        const stream = provider.generate([{ role: 'user', content: [...userContent] }], {
            stream: true,
        }) as AsyncGenerator<Chunk>;
        await drainStream(stream);

        const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
        expect(requestBody.messages[0].content).toEqual(userContent);
    });
});
