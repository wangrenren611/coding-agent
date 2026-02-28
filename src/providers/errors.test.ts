/**
 * Errors 模块测试
 */

import { describe, it, expect } from 'vitest';
import {
    LLMError,
    LLMRetryableError,
    LLMRateLimitError,
    LLMPermanentError,
    LLMAuthError,
    LLMNotFoundError,
    LLMBadRequestError,
    LLMAbortedError,
    createErrorFromStatus,
    isRetryableError,
    isPermanentError,
    isAbortedError,
} from './types';

describe('LLMError', () => {
    it('should create error with message and code', () => {
        const error = new LLMError('Something went wrong', 'CUSTOM_ERROR');
        expect(error.message).toBe('Something went wrong');
        expect(error.code).toBe('CUSTOM_ERROR');
        expect(error.name).toBe('LLMError');
    });

    it('should create error with only message', () => {
        const error = new LLMError('Something went wrong');
        expect(error.message).toBe('Something went wrong');
        expect(error.code).toBeUndefined();
        expect(error.name).toBe('LLMError');
    });
});

describe('LLMRetryableError', () => {
    it('should create error with message and retryAfter', () => {
        const error = new LLMRetryableError('Rate limited', 5000, 'RATE_LIMIT');
        expect(error.message).toBe('Rate limited');
        expect(error.retryAfter).toBe(5000);
        expect(error.code).toBe('RATE_LIMIT');
        expect(error.name).toBe('LLMRetryableError');
    });

    it('should calculate backoff with retryAfter', () => {
        const error = new LLMRetryableError('Rate limited', 3000);
        expect(error.getBackoff(1)).toBe(3000);
    });

    it('should calculate exponential backoff without retryAfter', () => {
        const error = new LLMRetryableError('Server error');
        expect(error.getBackoff(1)).toBe(2000); // 2^1 * 1000
        expect(error.getBackoff(2)).toBe(4000); // 2^2 * 1000
        expect(error.getBackoff(3)).toBe(8000); // 2^3 * 1000
    });
});

describe('LLMRateLimitError', () => {
    it('should create rate limit error', () => {
        const error = new LLMRateLimitError('Too many requests');
        expect(error.message).toBe('Too many requests');
        expect(error.retryAfter).toBeUndefined();
        expect(error.code).toBe('RATE_LIMIT');
        expect(error.name).toBe('LLMRateLimitError');
    });

    it('should create without retryAfter', () => {
        const error = new LLMRateLimitError('Too many requests');
        expect(error.retryAfter).toBeUndefined();
        expect(error.code).toBe('RATE_LIMIT');
    });
});

describe('LLMPermanentError', () => {
    it('should create permanent error with statusCode', () => {
        const error = new LLMPermanentError('Not found', 404, 'NOT_FOUND');
        expect(error.message).toBe('Not found');
        expect(error.statusCode).toBe(404);
        expect(error.code).toBe('NOT_FOUND');
        expect(error.name).toBe('LLMPermanentError');
    });
});

describe('LLMAuthError', () => {
    it('should create auth error', () => {
        const error = new LLMAuthError('Invalid API key');
        expect(error.message).toBe('Invalid API key');
        expect(error.statusCode).toBe(401);
        expect(error.code).toBe('AUTH_FAILED');
        expect(error.name).toBe('LLMAuthError');
    });
});

describe('LLMNotFoundError', () => {
    it('should create not found error with resource type', () => {
        const error = new LLMNotFoundError('Model not found', 'model');
        expect(error.message).toBe('Model not found');
        expect(error.statusCode).toBe(404);
        expect(error.code).toBe('NOT_FOUND');
        expect(error.resourceType).toBe('model');
        expect(error.name).toBe('LLMNotFoundError');
    });

    it('should create without resource type', () => {
        const error = new LLMNotFoundError('Resource not found');
        expect(error.resourceType).toBeUndefined();
    });
});

describe('LLMBadRequestError', () => {
    it('should create bad request error with validation errors', () => {
        const validationErrors = { field: 'Invalid value' };
        const error = new LLMBadRequestError('Invalid request', validationErrors);
        expect(error.message).toBe('Invalid request');
        expect(error.statusCode).toBe(400);
        expect(error.code).toBe('BAD_REQUEST');
        expect(error.validationErrors).toEqual(validationErrors);
        expect(error.name).toBe('LLMBadRequestError');
    });
});

describe('LLMAbortedError', () => {
    it('should create aborted error with default message', () => {
        const error = new LLMAbortedError();
        expect(error.message).toBe('Request was cancelled');
        expect(error.code).toBe('ABORTED');
        expect(error.name).toBe('LLMAbortedError');
    });

    it('should create aborted error with custom message', () => {
        const error = new LLMAbortedError('User cancelled');
        expect(error.message).toBe('User cancelled');
        expect(error.code).toBe('ABORTED');
    });
});

describe('createErrorFromStatus', () => {
    it('should return LLMAuthError for 401', () => {
        const error = createErrorFromStatus(401, 'Unauthorized', 'Invalid token');
        expect(error).toBeInstanceOf(LLMAuthError);
        expect(error.code).toBe('AUTH_FAILED');
    });

    it('should return LLMAuthError for 403', () => {
        const error = createErrorFromStatus(403, 'Forbidden', 'Access denied');
        expect(error).toBeInstanceOf(LLMAuthError);
    });

    it('should return LLMNotFoundError for 404', () => {
        const error = createErrorFromStatus(404, 'Not Found', 'Resource not found');
        expect(error).toBeInstanceOf(LLMNotFoundError);
        expect((error as LLMNotFoundError).resourceType).toBe('resource');
    });

    it('should return LLMRateLimitError for 429', () => {
        const error = createErrorFromStatus(429, 'Too Many Requests', 'Rate limit exceeded');
        expect(error).toBeInstanceOf(LLMRateLimitError);
    });

    it('should return LLMBadRequestError for 400', () => {
        const error = createErrorFromStatus(400, 'Bad Request', 'Invalid input');
        expect(error).toBeInstanceOf(LLMBadRequestError);
    });

    it('should return LLMPermanentError for 501', () => {
        const error = createErrorFromStatus(501, 'Not Implemented', 'Feature not available');
        expect(error).toBeInstanceOf(LLMPermanentError);
        expect(error.code).toBe('NOT_IMPLEMENTED');
    });

    it('should return LLMRetryableError for 500', () => {
        const error = createErrorFromStatus(500, 'Internal Server Error', 'Something broke');
        expect(error).toBeInstanceOf(LLMRetryableError);
        expect(error.code).toBe('SERVER_500');
    });

    it('should return LLMRetryableError for 408', () => {
        const error = createErrorFromStatus(408, 'Request Timeout', 'RequestTimeOut');
        expect(error).toBeInstanceOf(LLMRetryableError);
        expect(error.code).toBe('TIMEOUT');
    });

    it('should return LLMRetryableError for 502', () => {
        const error = createErrorFromStatus(502, 'Bad Gateway', 'Upstream error');
        expect(error).toBeInstanceOf(LLMRetryableError);
        expect(error.code).toBe('SERVER_502');
    });

    it('should return LLMRetryableError for 503', () => {
        const error = createErrorFromStatus(503, 'Service Unavailable', 'Server busy');
        expect(error).toBeInstanceOf(LLMRetryableError);
        expect(error.code).toBe('SERVER_503');
    });

    it('should return LLMRetryableError for 504', () => {
        const error = createErrorFromStatus(504, 'Gateway Timeout', 'Timeout');
        expect(error).toBeInstanceOf(LLMRetryableError);
        expect(error.code).toBe('SERVER_504');
    });

    it('should return LLMError for unknown status codes', () => {
        const error = createErrorFromStatus(418, "I'm a teapot", 'Teapot');
        expect(error).toBeInstanceOf(LLMError);
        expect(error.code).toBe('HTTP_418');
    });

    it('should parse error details from JSON', () => {
        const errorText = JSON.stringify({ error: { message: 'Detailed error' } });
        const error = createErrorFromStatus(400, 'Bad Request', errorText);
        expect(error.message).toContain('Detailed error');
    });

    it('should handle non-JSON error text', () => {
        const error = createErrorFromStatus(500, 'Internal Server Error', 'Plain text error');
        expect(error.message).toContain('Plain text error');
    });

    it('should handle empty error text', () => {
        const error = createErrorFromStatus(500, 'Internal Server Error', '');
        expect(error.message).toBe('500 Internal Server Error');
    });
});

describe('isRetryableError', () => {
    it('should return true for LLMRetryableError', () => {
        const error = new LLMRetryableError('Server error');
        expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for LLMRateLimitError', () => {
        const error = new LLMRateLimitError('Rate limited');
        expect(isRetryableError(error)).toBe(true);
    });

    it('should return false for LLMAuthError', () => {
        const error = new LLMAuthError('Unauthorized');
        expect(isRetryableError(error)).toBe(false);
    });

    it('should return false for generic error', () => {
        const error = new Error('Generic error');
        expect(isRetryableError(error)).toBe(false);
    });

    it('should return false for non-Error objects', () => {
        expect(isRetryableError('string')).toBe(false);
        expect(isRetryableError(null)).toBe(false);
        expect(isRetryableError(undefined)).toBe(false);
    });
});

describe('isPermanentError', () => {
    it('should return true for LLMPermanentError', () => {
        const error = new LLMPermanentError('Not found', 404);
        expect(isPermanentError(error)).toBe(true);
    });

    it('should return true for LLMAuthError', () => {
        const error = new LLMAuthError('Unauthorized');
        expect(isPermanentError(error)).toBe(true);
    });

    it('should return true for LLMNotFoundError', () => {
        const error = new LLMNotFoundError('Not found');
        expect(isPermanentError(error)).toBe(true);
    });

    it('should return true for LLMBadRequestError', () => {
        const error = new LLMBadRequestError('Bad request');
        expect(isPermanentError(error)).toBe(true);
    });

    it('should return false for LLMRetryableError', () => {
        const error = new LLMRetryableError('Server error');
        expect(isPermanentError(error)).toBe(false);
    });

    it('should return false for generic error', () => {
        const error = new Error('Generic error');
        expect(isPermanentError(error)).toBe(false);
    });
});

describe('isAbortedError', () => {
    it('should return true for LLMAbortedError', () => {
        const error = new LLMAbortedError();
        expect(isAbortedError(error)).toBe(true);
    });

    it('should return false for other errors', () => {
        const error = new LLMError('Other error');
        expect(isAbortedError(error)).toBe(false);
    });

    it('should return false for non-Error objects', () => {
        expect(isAbortedError('string')).toBe(false);
        expect(isAbortedError(null)).toBe(false);
    });
});
