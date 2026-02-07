import { z } from 'zod';
import { BaseTool, ToolContext, ToolResult } from './base';
import { tavily } from '@tavily/core';

const schema = z.object({
  query: z.string().describe("Search query content"),
  maxResults: z.number().min(1).max(10).default(5).describe("Maximum number of results")
});

export class WebSearchTool extends BaseTool<typeof schema> {
  name = "web_search";
  description = "Performs a web search using Tavily API.";
  schema = schema;

  async execute({ query, maxResults = 3 }: z.infer<typeof schema>, _context?: ToolContext): Promise<ToolResult> {
    // === 业务错误：API Key 未配置 ===
    if (!process.env.TAVILY_API_KEY) {
      return this.result({
        success: false,
        metadata: { error: 'API_KEY_MISSING' } as any,
        output: 'API_KEY_MISSING: TAVILY_API_KEY environment variable not set',
      });
    }

    // === 底层异常：网络请求失败 ===
    let response: any;
    try {
      const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });
      response = await tvly.search(query, { maxResults: maxResults || 5 });
    } catch (error) {
      return this.result({
        success: false,
        metadata: {
          error: 'SEARCH_FAILED',
          errorMsg: error instanceof Error ? error.message : String(error)
        } as any,
        output: `SEARCH_FAILED: Web search request failed`,
      });
    }

    const results = response?.results || [];

    // === 业务错误：无结果 ===
    if (results.length === 0) {
      return this.result({
        success: true,
        metadata: {
          query: response.query,
          results: [],
          responseTime: response.responseTime,
        },
        output: `No results found for query: ${query}`,
      });
    }

    const summarizedResults = results.map((r: any) => ({
      title: r.title,
      url: r.url,
      content: r.content || '',
      score: r.score
    }));

    return this.result({
      success: true,
      metadata: {
        query: response.query,
        results: summarizedResults,
        responseTime: response.responseTime,
      },
      output: `Found ${results.length} result(s) for "${query}"`,
    });
  }
}
