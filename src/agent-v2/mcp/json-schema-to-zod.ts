/**
 * JSON Schema to Zod 转换器
 *
 * 将 MCP 工具的 JSON Schema 转换为 Zod schema
 */

import { z } from 'zod';
import type { JsonSchema } from './types';

/**
 * 转换选项
 */
export interface ConversionOptions {
    /** 是否保留原始值 */
    preserveDefaults?: boolean;
}

/**
 * 将 JSON Schema 转换为 Zod schema
 */
export function jsonSchemaToZod(schema: JsonSchema, options: ConversionOptions = {}): z.ZodType {
    return convertSchema(schema, options);
}

/**
 * 递归转换 schema
 */
function convertSchema(schema: JsonSchema, options: ConversionOptions): z.ZodType {
    // 处理 enum
    if (schema.enum && Array.isArray(schema.enum)) {
        const enumValues = schema.enum as (string | number | boolean | null)[];
        if (enumValues.length > 0) {
            const nonNullValues = enumValues.filter((v) => v !== null) as string[];
            if (nonNullValues.length > 0) {
                return z.enum(nonNullValues as [string, ...string[]]);
            }
        }
    }

    // 处理 oneOf
    if (schema.oneOf && Array.isArray(schema.oneOf)) {
        const schemas = schema.oneOf.map((s) => convertSchema(s as JsonSchema, options));
        if (schemas.length >= 2) {
            return z.union([schemas[0], schemas[1]]);
        }
        if (schemas.length === 1) {
            return schemas[0];
        }
    }

    // 处理 anyOf
    if (schema.anyOf && Array.isArray(schema.anyOf)) {
        const schemas = schema.anyOf.map((s) => convertSchema(s as JsonSchema, options));
        if (schemas.length >= 2) {
            return z.union([schemas[0], schemas[1]]);
        }
        if (schemas.length === 1) {
            return schemas[0];
        }
    }

    // 处理 allOf（合并所有属性）
    if (schema.allOf && Array.isArray(schema.allOf)) {
        const mergedSchema: JsonSchema = {};
        for (const s of schema.allOf) {
            Object.assign(mergedSchema, s);
        }
        return convertSchema(mergedSchema, options);
    }

    // 处理 $ref（不支持）
    if (schema.$ref) {
        return z.any();
    }

    // 处理 const
    if (schema.const !== undefined) {
        const constValue = schema.const;
        if (typeof constValue === 'string') {
            return z.literal(constValue);
        }
        if (typeof constValue === 'number') {
            return z.literal(constValue);
        }
        if (typeof constValue === 'boolean') {
            return z.literal(constValue);
        }
        return z.any();
    }

    // 处理 type
    const type = schema.type;
    if (Array.isArray(type)) {
        const schemas = type.map((t) => convertSchema({ ...schema, type: t }, options));
        if (schemas.length >= 2) {
            return z.union([schemas[0], schemas[1]]);
        }
        if (schemas.length === 1) {
            return schemas[0];
        }
    }

    switch (type) {
        case 'string':
            return convertString(schema, options);
        case 'number':
            return convertNumber(schema, options);
        case 'integer':
            return convertInteger(schema, options);
        case 'boolean':
            return z.boolean();
        case 'null':
            return z.null();
        case 'array':
            return convertArray(schema, options);
        case 'object':
            return convertObject(schema, options);
        default:
            return z.any();
    }
}

/**
 * 转换字符串类型
 */
function convertString(schema: JsonSchema, options: ConversionOptions): z.ZodType {
    let result: z.ZodString = z.string();

    // 格式约束
    if (schema.format === 'email') {
        result = result.email();
    } else if (schema.format === 'uri' || schema.format === 'url') {
        result = result.url();
    } else if (schema.format === 'uuid') {
        result = result.uuid();
    } else if (schema.format === 'date') {
        result = result.date();
    } else if (schema.format === 'date-time') {
        result = result.datetime();
    }

    // 模式约束
    if (typeof schema.pattern === 'string') {
        try {
            result = result.regex(new RegExp(schema.pattern));
        } catch {
            // 忽略无效的正则表达式
        }
    }

    // 长度约束
    if (typeof schema.minLength === 'number') {
        result = result.min(schema.minLength);
    }
    if (typeof schema.maxLength === 'number') {
        result = result.max(schema.maxLength);
    }

    // 默认值
    if (schema.default !== undefined && options.preserveDefaults !== false) {
        return result.default(schema.default as string);
    }

    return result;
}

/**
 * 转换数字类型
 */
function convertNumber(schema: JsonSchema, options: ConversionOptions): z.ZodType {
    let result: z.ZodNumber = z.number();

    // 范围约束
    if (typeof schema.minimum === 'number') {
        result = result.min(schema.minimum);
    }
    if (typeof schema.maximum === 'number') {
        result = result.max(schema.maximum);
    }
    if (typeof schema.exclusiveMinimum === 'number') {
        result = result.gt(schema.exclusiveMinimum);
    }
    if (typeof schema.exclusiveMaximum === 'number') {
        result = result.lt(schema.exclusiveMaximum);
    }

    // 默认值
    if (schema.default !== undefined && options.preserveDefaults !== false) {
        return result.default(schema.default as number);
    }

    return result;
}

/**
 * 转换整数类型
 */
function convertInteger(schema: JsonSchema, options: ConversionOptions): z.ZodType {
    const result = convertNumber(schema, options) as z.ZodNumber;
    return result.int();
}

/**
 * 转换数组类型
 */
function convertArray(schema: JsonSchema, options: ConversionOptions): z.ZodType {
    const itemType = schema.items ? convertSchema(schema.items as JsonSchema, options) : z.any();
    let result: z.ZodArray<z.ZodType> = z.array(itemType);

    // 长度约束
    if (typeof schema.minItems === 'number') {
        result = result.min(schema.minItems);
    }
    if (typeof schema.maxItems === 'number') {
        result = result.max(schema.maxItems);
    }

    // 默认值
    if (schema.default !== undefined && options.preserveDefaults !== false) {
        return result.default(schema.default as unknown[]);
    }

    return result;
}

/**
 * 转换对象类型
 */
function convertObject(schema: JsonSchema, options: ConversionOptions): z.ZodType {
    const shape: Record<string, z.ZodTypeAny> = {};

    // 处理属性
    if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
            shape[key] = convertSchema(propSchema as JsonSchema, options);
        }
    }

    // 处理 required 字段
    const required = new Set(schema.required || []);

    // 标记可选字段
    for (const key of Object.keys(shape)) {
        if (!required.has(key)) {
            shape[key] = shape[key].optional();
        }
    }

    // 处理默认值
    if (options.preserveDefaults !== false) {
        for (const [key] of Object.entries(shape)) {
            const defaultVal = (schema.properties?.[key] as JsonSchema)?.default;
            if (defaultVal !== undefined) {
                shape[key] = shape[key].default(defaultVal);
            }
        }
    }

    return z.object(shape);
}
