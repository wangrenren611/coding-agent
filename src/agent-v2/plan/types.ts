/**
 * Plan Module - Types
 *
 * Plan 计划功能的类型定义
 */

import { z } from 'zod';

// ==================== 常量 ====================

/** Plan 文件存储目录名 */
export const PLANS_DIR_NAME = 'plans';

/** Plan ID 前缀 */
export const PLAN_ID_PREFIX = 'plan';

// ==================== Zod Schemas ====================

/** plan_create 工具参数 Schema */
export const planCreateSchema = z.object({
    title: z.string().min(1).max(200).describe('Plan title'),
    content: z.string().min(1).describe('Plan content in Markdown format'),
});

// ==================== 类型定义 ====================

/**
 * Plan 元数据
 */
export interface PlanMeta {
    /** 唯一标识 */
    id: string;
    /** 标题 */
    title: string;
    /** 创建时间 (ISO 8601) */
    createdAt: string;
    /** 更新时间 (ISO 8601) */
    updatedAt: string;
    /** 关联的会话 ID */
    sessionId: string;
    /** Markdown 文件绝对路径 */
    filePath: string;
}

/**
 * Plan 完整数据（元数据 + 内容）
 */
export interface PlanData {
    meta: PlanMeta;
    content: string;
}

/**
 * Plan 创建参数
 */
export interface CreatePlanParams {
    /** 标题 */
    title: string;
    /** Markdown 内容 */
    content: string;
    /** 会话 ID */
    sessionId: string;
}

// ==================== 辅助函数 ====================

/**
 * 生成唯一 Plan ID
 * 使用时间戳 + 随机数确保唯一性
 */
export function generatePlanId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 8);
    return `${PLAN_ID_PREFIX}-${timestamp}-${random}`;
}

/**
 * 获取 ISO 8601 格式的时间字符串
 */
export function nowIso(): string {
    return new Date().toISOString();
}

/**
 * 验证 sessionId 是否安全（不包含路径遍历字符）
 */
export function isValidSessionId(sessionId: string): boolean {
    if (!sessionId || typeof sessionId !== 'string') {
        return false;
    }
    // 拒绝空字符串、路径遍历、特殊字符
    if (sessionId.length === 0 || sessionId.length > 128) {
        return false;
    }
    // 只允许字母、数字、连字符、下划线
    return /^[a-zA-Z0-9_-]+$/.test(sessionId);
}

/**
 * 清理 sessionId（移除危险字符）
 * 如果无法清理则返回 null
 */
export function sanitizeSessionId(sessionId: string): string | null {
    if (!sessionId || typeof sessionId !== 'string') {
        return null;
    }
    // 移除所有非安全字符
    const cleaned = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
    if (cleaned.length === 0 || cleaned.length > 128) {
        return null;
    }
    return cleaned;
}
