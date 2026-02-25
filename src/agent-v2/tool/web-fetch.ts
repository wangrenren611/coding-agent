import { z } from 'zod';
import { BaseTool, ToolContext, ToolResult } from './base';
import TurndownService from 'turndown';

// 常量定义
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_TIMEOUT = 30 * 1000; // 30秒
const MAX_TIMEOUT = 120 * 1000; // 120秒

// 定义 schema
const schema = z.object({
    url: z.string().describe('The URL to fetch content from'),
    format: z
        .enum(['text', 'markdown', 'html'])
        .default('markdown')
        .describe('The format to return the content in (text, markdown, or html). Defaults to markdown.'),
    timeout: z.number().describe('Optional timeout in seconds (max 120)').optional(),
});

export class WebFetchTool extends BaseTool<typeof schema> {
    name = 'web_fetch';
    description = 'Fetch webpage content from a URL and return it in the specified format (markdown, text, or html).';
    schema = schema;

    async execute(params: z.infer<typeof schema>, _context?: ToolContext): Promise<ToolResult> {
        const startTime = Date.now();

        // 验证 URL 格式
        if (!params.url.startsWith('http://') && !params.url.startsWith('https://')) {
            return this.result({
                success: false,
                metadata: {
                    error: 'INVALID_URL',
                    duration: Date.now() - startTime,
                } as any,
                output: 'INVALID_URL: URL must start with http:// or https://',
            });
        }

        // 计算超时时间
        const timeoutMs = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT);

        // 创建 AbortController 用于超时控制
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            // 根据请求格式构建 Accept 头
            let acceptHeader = '*/*';
            switch (params.format) {
                case 'markdown':
                    acceptHeader =
                        'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1';
                    break;
                case 'text':
                    acceptHeader = 'text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1';
                    break;
                case 'html':
                    acceptHeader =
                        'text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1';
                    break;
            }

            // 发起请求
            const response = await fetch(params.url, {
                signal: controller.signal,
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    Accept: acceptHeader,
                    'Accept-Language': 'en-US,en;q=0.9',
                },
            });

            // 检查响应状态
            if (!response.ok) {
                return this.result({
                    success: false,
                    metadata: {
                        error: 'FETCH_FAILED',
                        statusCode: response.status,
                        duration: Date.now() - startTime,
                    } as any,
                    output: `FETCH_FAILED: Request failed with status code: ${response.status}`,
                });
            }

            // 检查内容长度
            const contentLength = response.headers.get('content-length');
            if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
                return this.result({
                    success: false,
                    metadata: {
                        error: 'RESPONSE_TOO_LARGE',
                        duration: Date.now() - startTime,
                    } as any,
                    output: 'RESPONSE_TOO_LARGE: Response too large (exceeds 5MB limit)',
                });
            }

            // 读取响应内容
            const arrayBuffer = await response.arrayBuffer();
            if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
                return this.result({
                    success: false,
                    metadata: {
                        error: 'RESPONSE_TOO_LARGE',
                        duration: Date.now() - startTime,
                    } as any,
                    output: 'RESPONSE_TOO_LARGE: Response too large (exceeds 5MB limit)',
                });
            }

            // 解码内容
            const content = new TextDecoder().decode(arrayBuffer);
            const contentType = response.headers.get('content-type') || '';

            // 根据请求格式处理内容
            let outputText: string;
            switch (params.format) {
                case 'markdown':
                    // 如果是 HTML，转换为 Markdown
                    if (contentType.includes('text/html')) {
                        outputText = convertHTMLToMarkdown(content);
                    } else {
                        outputText = content;
                    }
                    break;
                case 'text':
                    // 如果是 HTML，提取纯文本（简化版本）
                    if (contentType.includes('text/html')) {
                        outputText = extractTextFromHTML(content);
                    } else {
                        outputText = content;
                    }
                    break;
                case 'html':
                default:
                    outputText = content;
                    break;
            }

            return this.result({
                success: true,
                metadata: {
                    url: params.url,
                    format: params.format,
                    contentType,
                    size: arrayBuffer.byteLength,
                    duration: Date.now() - startTime,
                },
                output: outputText.slice(0, 100000), // 限制输出长度
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return this.result({
                success: false,
                metadata: {
                    error: 'FETCH_ERROR',
                    errorMsg: errorMessage,
                    duration: Date.now() - startTime,
                } as any,
                output: `FETCH_ERROR: Web fetch failed: ${errorMessage}`,
            });
        } finally {
            // 确保在任何情况下都清除超时定时器，防止内存泄漏
            clearTimeout(timeoutId);
        }
    }
}

/**
 * 从 HTML 提取纯文本（简化版本）
 */
function extractTextFromHTML(html: string): string {
    // 移除 script 和 style 标签
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    // 移除其他标签
    text = text.replace(/<[^>]+>/g, ' ');
    // 解码 HTML 实体
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    // 清理多余空格
    text = text.replace(/\s+/g, ' ').trim();
    return text;
}

/**
 * 将 HTML 转换为 Markdown
 */
function convertHTMLToMarkdown(html: string): string {
    // 创建 TurndownService 实例
    const turndownService = new TurndownService({
        headingStyle: 'atx',
        hr: '---',
        bulletListMarker: '-',
        codeBlockStyle: 'fenced',
        emDelimiter: '*',
    });

    // 移除不需要的标签
    turndownService.remove(['script', 'style', 'meta', 'link']);

    // 转换 HTML 为 Markdown
    return turndownService.turndown(html);
}
