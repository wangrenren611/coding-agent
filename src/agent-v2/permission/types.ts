/**
 * 权限级别
 */
export enum PermissionLevel {
    /** 安全，可直接执行 */
    SAFE = 'safe',
    /** 中等，需要确认 */
    MODERATE = 'moderate',
    /** 危险，需要明确授权 */
    DANGEROUS = 'dangerous',
}


/**
 * 确认响应
 */
export interface ConfirmationResponse {
    /** 请求ID */
    id: string;
    /** 是否批准 */
    approved: boolean;
    /** 用户消息 */
    message?: string;
}
/**
 * 确认请求
 */
export interface ConfirmationRequest {
    /** 请求ID */
    id: string;
    /** 请求描述 */
    description: string;
    /** 工具名称 */
    toolName?: string;
    /** 参数 */
    parameters?: unknown;
    /** 权限级别 */
    permission: PermissionLevel;
}
