/**
 * JSON Schema to Zod Converter Tests
 */

import { describe, it, expect } from 'vitest';
import { jsonSchemaToZod } from '../json-schema-to-zod';
import { z } from 'zod';
import type { JsonSchema } from '../types';

describe('jsonSchemaToZod', () => {
    describe('string type', () => {
        it('should convert string schema', () => {
            const schema: JsonSchema = { type: 'string' };
            const result = jsonSchemaToZod(schema);
            expect(result).toBeInstanceOf(z.ZodString);
            expect(result.safeParse('hello').success).toBe(true);
        });

        it('should convert string schema with email format', () => {
            const schema: JsonSchema = {
                type: 'string',
                format: 'email',
            };
            const result = jsonSchemaToZod(schema);
            expect(result).toBeInstanceOf(z.ZodString);
        });

        it('should convert string schema with regex pattern', () => {
            const schema: JsonSchema = {
                type: 'string',
                pattern: '^[a-z]+$',
            };
            const result = jsonSchemaToZod(schema);
            expect(result).toBeInstanceOf(z.ZodString);
            expect(result.safeParse('abc').success).toBe(true);
            expect(result.safeParse('123').success).toBe(false);
        });

        it('should convert string schema with length constraints', () => {
            const schema: JsonSchema = {
                type: 'string',
                minLength: 2,
                maxLength: 10,
            };
            const result = jsonSchemaToZod(schema);
            expect(result).toBeInstanceOf(z.ZodString);
            expect(result.safeParse('ab').success).toBe(true);
            expect(result.safeParse('a').success).toBe(false);
            expect(result.safeParse('12345678901').success).toBe(false);
        });
    });

    describe('number type', () => {
        it('should convert number schema', () => {
            const schema: JsonSchema = { type: 'number' };
            const result = jsonSchemaToZod(schema);
            expect(result).toBeInstanceOf(z.ZodNumber);
            expect(result.safeParse(42).success).toBe(true);
        });

        it('should convert number schema with min/max', () => {
            const schema: JsonSchema = {
                type: 'number',
                minimum: 0,
                maximum: 100,
            };
            const result = jsonSchemaToZod(schema);
            expect(result).toBeInstanceOf(z.ZodNumber);
            expect(result.safeParse(-1).success).toBe(false);
            expect(result.safeParse(50).success).toBe(true);
            expect(result.safeParse(101).success).toBe(false);
        });

        it('should convert integer schema', () => {
            const schema: JsonSchema = { type: 'integer' };
            const result = jsonSchemaToZod(schema);
            expect(result).toBeInstanceOf(z.ZodNumber);
            expect(result.safeParse(1).success).toBe(true);
            expect(result.safeParse(1.5).success).toBe(false);
        });
    });

    describe('boolean type', () => {
        it('should convert boolean schema', () => {
            const schema: JsonSchema = { type: 'boolean' };
            const result = jsonSchemaToZod(schema);
            expect(result).toBeInstanceOf(z.ZodBoolean);
            expect(result.safeParse(true).success).toBe(true);
            expect(result.safeParse(false).success).toBe(true);
        });
    });

    describe('null type', () => {
        it('should convert null schema', () => {
            const schema: JsonSchema = { type: 'null' };
            const result = jsonSchemaToZod(schema);
            expect(result).toBeInstanceOf(z.ZodNull);
            expect(result.safeParse(null).success).toBe(true);
        });
    });

    describe('array type', () => {
        it('should convert array schema', () => {
            const schema: JsonSchema = {
                type: 'array',
                items: { type: 'string' },
            };
            const result = jsonSchemaToZod(schema);
            expect(result).toBeInstanceOf(z.ZodArray);
            expect(result.safeParse(['a', 'b']).success).toBe(true);
        });

        it('should convert array schema with length constraints', () => {
            const schema: JsonSchema = {
                type: 'array',
                items: { type: 'string' },
                minItems: 1,
                maxItems: 3,
            };
            const result = jsonSchemaToZod(schema);
            expect(result).toBeInstanceOf(z.ZodArray);
        });

        it('should convert array schema without items', () => {
            const schema: JsonSchema = { type: 'array' };
            const result = jsonSchemaToZod(schema);
            expect(result).toBeInstanceOf(z.ZodArray);
        });
    });

    describe('object type', () => {
        it('should convert object schema', () => {
            const schema: JsonSchema = {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    age: { type: 'number' },
                },
                required: ['name'],
            };
            const result = jsonSchemaToZod(schema);
            expect(result).toBeInstanceOf(z.ZodObject);
            expect(result.safeParse({ name: 'test' }).success).toBe(true);
            expect(result.safeParse({}).success).toBe(false);
        });

        it('should make non-required fields optional', () => {
            const schema: JsonSchema = {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    age: { type: 'number' },
                },
                required: ['name'],
            };
            const result = jsonSchemaToZod(schema);
            const parsed = result.safeParse({ name: 'test' });
            expect(parsed.success).toBe(true);
            if (parsed.success) {
                expect(parsed.data).toEqual({ name: 'test' });
            }
        });
    });

    describe('default values', () => {
        it('should handle default values', () => {
            const schema: JsonSchema = {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    enabled: { type: 'boolean', default: true },
                },
                required: ['name'],
            };
            const result = jsonSchemaToZod(schema);
            expect(result).toBeInstanceOf(z.ZodObject);
        });
    });

    describe('enum type', () => {
        it('should convert enum schema', () => {
            const schema: JsonSchema = {
                enum: ['red', 'green', 'blue'],
            };
            const result = jsonSchemaToZod(schema);
            expect(result).toBeInstanceOf(z.ZodEnum);
            expect(result.safeParse('red').success).toBe(true);
            expect(result.safeParse('yellow').success).toBe(false);
        });
    });

    describe('anyOf type', () => {
        it('should convert anyOf schema', () => {
            const schema: JsonSchema = {
                anyOf: [{ type: 'string' }, { type: 'number' }],
            };
            const result = jsonSchemaToZod(schema);
            expect(result).toBeInstanceOf(z.ZodUnion);
            expect(result.safeParse('hello').success).toBe(true);
            expect(result.safeParse(42).success).toBe(true);
        });
    });

    describe('nested object', () => {
        it('should convert nested object schema', () => {
            const schema: JsonSchema = {
                type: 'object',
                properties: {
                    user: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            email: { type: 'string', format: 'email' },
                        },
                        required: ['name', 'email'],
                    },
                },
                required: ['user'],
            };
            const result = jsonSchemaToZod(schema);
            expect(result).toBeInstanceOf(z.ZodObject);
            const valid = result.safeParse({
                user: { name: 'test', email: 'test@example.com' },
            });
            expect(valid.success).toBe(true);
        });
    });

    describe('empty schema', () => {
        it('should return any for empty schema', () => {
            const schema: JsonSchema = {};
            const result = jsonSchemaToZod(schema);
            expect(result).toBeInstanceOf(z.ZodAny);
        });
    });

    describe('unsupported types', () => {
        it('should return ZodAny for $ref', () => {
            const schema: JsonSchema = { $ref: '#/definitions/SomeType' };
            const result = jsonSchemaToZod(schema);
            // $ref is not supported, but the schema still returns ZodAny
            expect(result).toBeInstanceOf(z.ZodAny);
        });
    });
});
