export function safeParse(data: string): any | null {
    if (!data) {
        return null;
    }

    try {
        return JSON.parse(data);
    } catch (error) {
        return null;
    }
}

/**
 * 安全地将数据转换为 JSON 字符串
 *
 * @param data - 要转换的数据
 * @param maxLength - 最大字符串长度，超过则截断（默认 500KB）
 * @returns JSON 字符串，如果失败或数据为空则返回空字符串
 */
export function safeJSONStringify(data: any, maxLength: number = 500 * 1024): string {
    if (!data) {
        return '';
    }

    try {
        const str = JSON.stringify(data);

        // 如果超过最大长度，进行截断
        if (str.length > maxLength) {
            const truncated = str.slice(0, maxLength);
            // 尝试找到最后一个完整的 JSON 结构
            // 简单处理：直接截断并添加提示
            return truncated + '\n\n[... Content truncated due to size limit ...]';
        }

        return str;
    } catch (error) {
        // 处理 RangeError: Invalid string length 等错误
        if (error instanceof RangeError) {
            // 尝试转换为字符串并截断
            try {
                const str = String(data);
                if (str.length > maxLength) {
                    return str.slice(0, maxLength) + '\n\n[... Content truncated due to size limit ...]';
                }
                return str;
            } catch {
                return '[Result too large to serialize]';
            }
        }
        return '';
    }
}

/**
 * 将工具结果安全地转换为字符串
 * 专门用于处理可能很大的工具返回值
 *
 * @param result - 工具执行结果
 * @param maxLength - 最大字符串长度（默认 500KB）
 * @returns 安全的字符串表示
 */
export function safeToolResultToString(result: unknown, maxLength: number = 500 * 1024): string {
    if (result === null || result === undefined) {
        return '';
    }

    // 如果已经是字符串，直接检查长度
    if (typeof result === 'string') {
        if (result.length > maxLength) {
            return result.slice(0, maxLength) + '\n\n[... Content truncated due to size limit ...]';
        }
        return result;
    }

    // 对于对象，使用安全 JSON 序列化
    return safeJSONStringify(result, maxLength);
}
