/**
 * Agent 输入验证器
 * 
 * 负责验证用户输入的查询内容
 */

import { MessageContent } from '../../providers';
import { QueryValidator, QueryValidationResult, MAX_QUERY_LENGTH } from './config';


/**
 * 验证 Agent 输入的结果
 */
export interface AgentInputValidationResult {
    valid: boolean;
    error?: string;
}


/**
 * Agent 输入验证器
 * 
 * 使用 config.ts 中的 QueryValidator 进行基础验证
 * 提供 Agent 特定的验证逻辑
 */
export class AgentInputValidator {
    /**
     * 验证完整的 Agent 输入
     */
    static validate(query: MessageContent): AgentInputValidationResult {
        if (typeof query === 'string') {
            return this.validateText(query);
        }

        if (!Array.isArray(query) || query.length === 0) {
            return { valid: false, error: 'Query content parts cannot be empty' };
        }

        for (let i = 0; i < query.length; i++) {
            const part = query[i];
            const result = this.validateContentPart(part);
            if (!result.valid) {
                return result;
            }
        }

        return { valid: true };
    }


    /**
     * 验证文本输入
     */
    static validateText(query: string): AgentInputValidationResult {
        // 使用 QueryValidator 进行基础验证
        const baseResult = QueryValidator.validateTextInput(query);
        if (!baseResult.valid) {
            return baseResult;
        }

        return { valid: true };
    }


    /**
     * 验证内容部分
     */
    static validateContentPart(part: unknown): AgentInputValidationResult {
        // 使用 QueryValidator 进行基础验证
        const baseResult = QueryValidator.validateContentPart(part);
        if (!baseResult.valid) {
            return baseResult;
        }

        // 进行 Agent 特定的验证
        const contentPart = part as {
            type: string;
            text?: string;
            image_url?: { url?: string };
            file?: { file_id?: string; file_data?: string };
            input_audio?: { data?: string; format?: string };
            input_video?: { url?: string; file_id?: string; data?: string };
        };

        switch (contentPart.type) {
            case 'text':
                // 额外验证：检查文本长度是否超过 QueryValidator 的限制
                if (contentPart.text && contentPart.text.length > MAX_QUERY_LENGTH) {
                    return { valid: false, error: 'Text content exceeds maximum length' };
                }
                return { valid: true };

            case 'image_url':
            case 'file':
            case 'input_audio':
            case 'input_video':
                // QueryValidator 已经验证了必需字段
                return { valid: true };

            default:
                return { valid: false, error: `Unsupported content part type: ${contentPart.type}` };
        }
    }
}
