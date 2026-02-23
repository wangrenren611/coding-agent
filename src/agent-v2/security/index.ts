/**
 * 安全工具模块
 * 
 * 统一管理敏感信息的处理，确保整个 Agent 系统使用一致的脱敏策略。
 * 
 * 职责：
 * 1. 定义敏感字段列表
 * 2. 提供对象脱敏函数
 * 3. 提供结果脱敏函数
 */

/**
 * 敏感字段列表
 * 
 * 包含所有需要脱敏的字段名（不区分大小写匹配）。
 * 涵盖常见的密码、令牌、密钥等敏感信息字段。
 */
export const SENSITIVE_KEYS = Object.freeze([
    // 密码相关
    'password',
    'passwd',
    'pwd',
    
    // 令牌相关
    'token',
    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',
    'authToken',
    'auth_token',
    'bearerToken',
    'bearer_token',
    'csrfToken',
    'csrf_token',
    
    // 密钥相关
    'secret',
    'apiKey',
    'api_key',
    'apiSecret',
    'api_secret',
    'secretKey',
    'secret_key',
    'privateKey',
    'private_key',
    'publicKey',
    'public_key',
    
    // 认证相关
    'authorization',
    'credential',
    'credentials',
    
    // 会话相关
    'sessionKey',
    'session_key',
    'sessionToken',
    'session_token',
    
    // 其他敏感字段
    'otp',
    'otpCode',
    'otp_code',
    'pin',
    'pinCode',
    'pin_code',
    'salt',
    'hash',
    'cipher',
    'private',
] as const);

export type SensitiveKey = typeof SENSITIVE_KEYS[number];

/**
 * 脱敏后的占位符
 */
export const REDACTED_PLACEHOLDER = '[REDACTED]';

/**
 * 敏感值模式（正则表达式）
 * 
 * 用于检测字符串中的敏感信息模式
 */
export const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
    // API 密钥模式 (sk- 前缀)
    { pattern: /sk-[a-zA-Z0-9_-]{10,}/g, description: 'API Key (sk-)' },
    
    // API Key 模式
    { pattern: /api[_-]?key\s*=\s*['"]?[^\s'"]{8,}['"]?/gi, description: 'API Key Assignment' },
    
    // 密码模式
    { pattern: /password\s*=\s*['"]?[^\s'"]{4,}['"]?/gi, description: 'Password Assignment' },
    { pattern: /passwd\s*=\s*['"]?[^\s'"]{4,}['"]?/gi, description: 'Password Assignment' },
    { pattern: /pwd\s*=\s*['"]?[^\s'"]{4,}['"]?/gi, description: 'Password Assignment' },
    
    // Token 模式
    { pattern: /bearer\s+[_-]?[a-zA-Z0-9_-]{10,}/gi, description: 'Bearer Token' },
    { pattern: /token\s*=\s*['"]?[a-zA-Z0-9_-]{10,}['"]?/gi, description: 'Token Assignment' },
    
    // 私钥模式
    { pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g, description: 'Private Key' },
    { pattern: /-----BEGIN\s+OPENSSH\s+PRIVATE\s+KEY-----/g, description: 'OpenSSH Private Key' },
    
    // AWS 凭证
    { pattern: /AKIA[A-Z0-9]{16}/g, description: 'AWS Access Key' },
    { pattern: /aws[_-]?secret[_-]?access[_-]?key\s*=\s*['"]?[a-zA-Z0-9/+=]{30,}['"]?/gi, description: 'AWS Secret Key' },
];

/**
 * 脱敏字符串中的敏感模式
 * 
 * @param text 原始文本
 * @returns 脱敏后的文本
 */
export function sanitizeStringContent(text: string): string {
    let result = text;
    
    for (const { pattern } of SENSITIVE_PATTERNS) {
        // 重置正则的 lastIndex
        pattern.lastIndex = 0;
        result = result.replace(pattern, REDACTED_PLACEHOLDER);
    }
    
    return result;
}

/**
 * 检查字段名是否为敏感字段
 * 
 * @param key 字段名
 * @param additionalKeys 额外的敏感字段列表（可选）
 * @returns 是否为敏感字段
 */
export function isSensitiveKey(key: string, additionalKeys?: readonly string[]): boolean {
    const normalizedKey = key.toLowerCase();
    
    // 检查默认敏感字段
    for (const sensitiveKey of SENSITIVE_KEYS) {
        if (sensitiveKey.toLowerCase() === normalizedKey) {
            return true;
        }
    }
    
    // 检查额外敏感字段
    if (additionalKeys) {
        for (const additionalKey of additionalKeys) {
            if (additionalKey.toLowerCase() === normalizedKey) {
                return true;
            }
        }
    }
    
    return false;
}

/**
 * 脱敏单个值
 * 
 * @param value 原始值
 * @returns 脱敏后的值
 */
export function sanitizeValue(value: unknown): unknown {
    if (typeof value === 'string') {
        // 对于字符串，返回占位符
        return REDACTED_PLACEHOLDER;
    }
    
    if (typeof value === 'number' || typeof value === 'boolean') {
        // 对于数字和布尔值，返回占位符
        return REDACTED_PLACEHOLDER;
    }
    
    // 对于其他类型，返回占位符
    return REDACTED_PLACEHOLDER;
}

/**
 * 递归脱敏对象中的敏感字段选项
 */
export interface SanitizeOptions {
    /** 额外的敏感字段列表 */
    additionalKeys?: readonly string[];
    /** 最大递归深度（防止循环引用） */
    maxDepth?: number;
    /** 是否脱敏嵌套对象 */
    sanitizeNested?: boolean;
}

/**
 * 递归脱敏对象中的敏感字段
 * 
 * @param obj 原始对象
 * @param options 脱敏选项
 * @returns 脱敏后的对象
 */
export function sanitizeObject<T>(
    obj: T,
    options: SanitizeOptions = {}
): T {
    const { additionalKeys, maxDepth = 10, sanitizeNested = true } = options;
    
    // 处理非对象类型
    if (obj === null || obj === undefined) {
        return obj;
    }
    
    if (typeof obj !== 'object') {
        return obj;
    }
    
    // 处理数组
    if (Array.isArray(obj)) {
        return obj.map(item => 
            sanitizeObject(item, { additionalKeys, maxDepth: maxDepth - 1, sanitizeNested })
        ) as T;
    }
    
    // 检查递归深度
    if (maxDepth <= 0) {
        return obj;
    }
    
    // 处理普通对象
    const result: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (isSensitiveKey(key, additionalKeys)) {
            result[key] = sanitizeValue(value);
        } else if (sanitizeNested && typeof value === 'object' && value !== null) {
            result[key] = sanitizeObject(value, { additionalKeys, maxDepth: maxDepth - 1, sanitizeNested });
        } else if (typeof value === 'string') {
            // 脱敏字符串中的敏感模式
            result[key] = sanitizeStringContent(value);
        } else {
            result[key] = value;
        }
    }
    
    return result as T;
}

/**
 * 工具执行结果类型（与 core-types.ts 中的 ToolExecutionResult 保持一致）
 */
export interface ToolExecutionResultLike {
    tool_call_id: string;
    result?: {
        success?: boolean;
        [key: string]: unknown;
    };
}

/**
 * 脱敏工具执行结果
 * 
 * 专门用于处理 ToolExecutionResult 类型的脱敏
 * 
 * @param result 工具执行结果
 * @returns 脱敏后的结果
 */
export function sanitizeToolResult<T extends ToolExecutionResultLike>(
    result: T
): T {
    if (!result.result) {
        return result;
    }
    
    return {
        ...result,
        result: sanitizeObject(result.result) as T['result'],
    };
}

/**
 * 将工具结果转换为字符串（用于消息内容）
 * 
 * @param result 工具结果
 * @returns 字符串表示
 */
export function toolResultToString(result: unknown): string {
    if (typeof result === 'string') {
        return result;
    }
    
    if (result && typeof result === 'object') {
        const obj = result as Record<string, unknown>;
        
        // 如果有 output 字段，优先使用
        if ('output' in obj && typeof obj.output === 'string') {
            return obj.output;
        }
        
        // 如果有 error 字段
        if ('error' in obj && typeof obj.error === 'string') {
            return obj.error;
        }
        
        // 如果有 result 字段
        if ('result' in obj) {
            return toolResultToString(obj.result);
        }
        
        try {
            return JSON.stringify(result, null, 2);
        } catch {
            return '[Object]';
        }
    }
    
    return String(result);
}
