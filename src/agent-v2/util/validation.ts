/**
 * 通用验证工具
 */

export function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

export function isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

export function hasProperty(obj: unknown, key: string): boolean {
    return isObject(obj) && key in obj;
}

export function getProperty<T>(obj: unknown, key: string): T | undefined {
    if (isObject(obj) && key in obj) {
        return obj[key] as T;
    }
    return undefined;
}

export interface ValidationResult {
    valid: boolean;
    error?: string;
}

export function validateRequired(value: unknown, fieldName: string): ValidationResult {
    if (value === undefined || value === null) {
        return { valid: false, error: `${fieldName} is required` };
    }
    if (typeof value === 'string' && value.length === 0) {
        return { valid: false, error: `${fieldName} cannot be empty` };
    }
    return { valid: true };
}

export function validateLength(
    value: string, 
    fieldName: string, 
    options?: { min?: number; max?: number }
): ValidationResult {
    const { min, max } = options ?? {};
    
    if (min !== undefined && value.length < min) {
        return { valid: false, error: `${fieldName} must be at least ${min} characters` };
    }
    if (max !== undefined && value.length > max) {
        return { valid: false, error: `${fieldName} must be at most ${max} characters` };
    }
    return { valid: true };
}

export function validateRange(
    value: number, 
    fieldName: string, 
    options?: { min?: number; max?: number }
): ValidationResult {
    const { min, max } = options ?? {};
    
    if (min !== undefined && value < min) {
        return { valid: false, error: `${fieldName} must be at least ${min}` };
    }
    if (max !== undefined && value > max) {
        return { valid: false, error: `${fieldName} must be at most ${max}` };
    }
    return { valid: true };
}

export function validatePattern(
    value: string, 
    fieldName: string, 
    pattern: RegExp,
    message?: string
): ValidationResult {
    if (!pattern.test(value)) {
        return { 
            valid: false, 
            error: message ?? `${fieldName} has invalid format` 
        };
    }
    return { valid: true };
}

export function validateEmail(email: string): ValidationResult {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return validatePattern(email, 'Email', emailPattern, 'Invalid email format');
}

export function validateUrl(url: string): ValidationResult {
    try {
        new URL(url);
        return { valid: true };
    } catch {
        return { valid: false, error: 'Invalid URL format' };
    }
}
