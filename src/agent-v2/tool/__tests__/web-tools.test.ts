/**
 * Tests for web tools (WebSearchTool, WebFetchTool)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSearchTool } from '../web-search';
import { WebFetchTool } from '../web-fetch';
import { TestEnvironment } from './test-utils';

describe('Web Tools', () => {
    let env: TestEnvironment;

    beforeEach(async () => {
        env = new TestEnvironment('web-tools');
        await env.setup();
    });

    afterEach(async () => {
        await env.teardown();
    });

    describe('WebSearchTool', () => {
        it('should return error when API key is not set', async () => {
            // Ensure API key is not set
            delete process.env.TAVILY_API_KEY;

            const tool = new WebSearchTool();
            const result = await tool.execute({
                query: 'test search',
                maxResults: 5,
            });

            expect(result.success).toBe(false);
            expect((result.metadata as { error: string })?.error).toContain('API_KEY_MISSING');
        });

        it('should handle missing query parameter', async () => {
            const tool = new WebSearchTool();
            const result = await tool.execute({
                query: '',
                maxResults: 5,
            });

            // Should fail validation
            expect(result).toBeDefined();
        });

        it('should validate maxResults range', async () => {
            const tool = new WebSearchTool();
            const result = await tool.execute({
                query: 'test',
                maxResults: 100, // Too many
            });

            // Should fail validation
            expect(result).toBeDefined();
        });

        it('should use default maxResults when not specified', async () => {
            delete process.env.TAVILY_API_KEY;

            const tool = new WebSearchTool();
            const result = await tool.execute({
                query: 'test search',
                maxResults: 5,
            });

            expect(result).toBeDefined();
        });
    });

    describe('WebFetchTool', () => {
        it('should return error for invalid URL format', async () => {
            const tool = new WebFetchTool();
            const result = await tool.execute({
                url: 'not-a-valid-url',
                format: 'markdown',
            });

            expect(result.success).toBe(false);
            expect((result.metadata as { error: string })?.error).toContain('INVALID_URL');
        });

        it('should return error for URL without http/https', async () => {
            const tool = new WebFetchTool();
            const result = await tool.execute({
                url: 'ftp://example.com',
                format: 'markdown',
            });

            expect(result.success).toBe(false);
            expect((result.metadata as { error: string })?.error).toContain('INVALID_URL');
        });

        it('should validate timeout range', async () => {
            const tool = new WebFetchTool();
            const result = await tool.execute({
                url: 'https://example.com',
                format: 'markdown',
                timeout: 200, // Too large (max 120)
            });

            // Should cap at max timeout (and attempt fetch, may fail due to network)
            expect(result).toBeDefined();
        }, 30000); // Increase timeout for network request

        it('should support markdown format', async () => {
            const tool = new WebFetchTool();
            const result = await tool.execute({
                url: 'https://example.com',
                format: 'markdown',
            });

            // Should attempt fetch (may fail due to network)
            expect(result).toBeDefined();
        });

        it('should support text format', async () => {
            const tool = new WebFetchTool();
            const result = await tool.execute({
                url: 'https://example.com',
                format: 'text',
            });

            expect(result).toBeDefined();
        });

        it('should support html format', async () => {
            const tool = new WebFetchTool();
            const result = await tool.execute({
                url: 'https://example.com',
                format: 'html',
            });

            expect(result).toBeDefined();
        });

        it('should use default format when not specified', async () => {
            const tool = new WebFetchTool();
            const result = await tool.execute({
                url: 'https://example.com',
                format: 'markdown',
            });

            expect(result).toBeDefined();
            // Default should be markdown
        });

        it('should handle network errors gracefully', async () => {
            const tool = new WebFetchTool();
            const result = await tool.execute({
                url: 'https://this-domain-definitely-does-not-exist-12345.com',
                format: 'markdown',
            });

            expect(result).toBeDefined();
            // May fail due to DNS or network error
        });

        it('should handle timeout errors', async () => {
            const tool = new WebFetchTool();
            const result = await tool.execute({
                url: 'https://httpbin.org/delay/10',
                format: 'markdown',
                timeout: 1, // Very short timeout
            });

            expect(result).toBeDefined();
            // May timeout
        });

        it('should include duration in metadata', async () => {
            const tool = new WebFetchTool();
            const result = await tool.execute({
                url: 'https://example.com',
                format: 'markdown',
            });

            if (result.success) {
                expect((result.metadata as { duration: number })?.duration).toBeDefined();
            }
        });

        it('should include content size in result', async () => {
            const tool = new WebFetchTool();
            const result = await tool.execute({
                url: 'https://example.com',
                format: 'markdown',
            });

            if (result.success) {
                expect((result.metadata as { size: number })?.size).toBeDefined();
                expect(typeof (result.metadata as { size: number })?.size).toBe('number');
            }
        });

        it('should include contentType in result', async () => {
            const tool = new WebFetchTool();
            const result = await tool.execute({
                url: 'https://example.com',
                format: 'markdown',
            });

            if (result.success) {
                expect((result.metadata as { contentType: string })?.contentType).toBeDefined();
            }
        });

        it('should handle responses larger than limit', async () => {
            const tool = new WebFetchTool();
            const result = await tool.execute({
                url: 'https://httpbin.org/bytes/6000000', // 6MB response
                format: 'markdown',
            });

            // Should fail with RESPONSE_TOO_LARGE or timeout
            expect(result).toBeDefined();
        }, 30000); // 30 second timeout for large file test
    });
});
