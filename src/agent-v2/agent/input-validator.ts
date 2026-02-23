/**
 * Agent 输入验证器
 * 
 * 负责验证用户输入的合法性
 */

import { InputContentPart, MessageContent } from "../../providers";
import { ValidationResult } from "./types-internal";

/** 最大查询长度 */
const MAX_QUERY_LENGTH = 100000;

/**
 * 输入验证器
 */
export class InputValidator {
    /**
     * 验证用户输入
     */
    validate(query: MessageContent): ValidationResult {
        if (typeof query === 'string') {
            return this.validateTextInput(query);
        }

        if (!Array.isArray(query) || query.length === 0) {
            return { valid: false, error: 'Query content parts cannot be empty' };
        }

        for (const part of query) {
            const partValidation = this.validateContentPart(part);
            if (!partValidation.valid) {
                return partValidation;
            }
        }

        return { valid: true };
    }

    /**
     * 验证文本输入
     */
    private validateTextInput(query: string): ValidationResult {
        if (query.length === 0) {
            return { valid: false, error: 'Query cannot be empty' };
        }

        // 检查纯空白字符
        if (query.trim().length === 0) {
            return { valid: false, error: 'Query cannot be whitespace only' };
        }

        if (query.length > MAX_QUERY_LENGTH) {
            return { valid: false, error: 'Query exceeds maximum length' };
        }

        return { valid: true };
    }

    /**
     * 验证内容部分
     */
    private validateContentPart(part: InputContentPart): ValidationResult {
        if (!part || typeof part !== 'object' || !('type' in part)) {
            return { valid: false, error: 'Invalid content part structure' };
        }

        switch (part.type) {
            case 'text':
                return this.validateTextInput(part.text || '');
            case 'image_url':
                if (!part.image_url?.url) {
                    return { valid: false, error: 'image_url part must include a valid url' };
                }
                return { valid: true };
            case 'file':
                if (!part.file?.file_id && !part.file?.file_data) {
                    return { valid: false, error: 'file part must include file_id or file_data' };
                }
                return { valid: true };
            case 'input_audio':
                if (!part.input_audio?.data || !part.input_audio?.format) {
                    return { valid: false, error: 'input_audio part must include data and format' };
                }
                return { valid: true };
            case 'input_video':
                if (!part.input_video?.url && !part.input_video?.file_id && !part.input_video?.data) {
                    return { valid: false, error: 'input_video part must include url, file_id, or data' };
                }
                return { valid: true };
            default:
                return { valid: false, error: `Unsupported content part type: ${(part as { type?: string }).type}` };
        }
    }
}

/** 默认验证器实例 */
export const defaultInputValidator = new InputValidator();
