/**
 * ============================================================================
 * Plan Module - Types (简化版)
 * ============================================================================
 *
 * Plan 计划功能的简化类型定义
 *
 * 设计理念：
 * - Plan 就是一个 Markdown 文档
 * - 不需要复杂的状态管理
 * - Agent 自己阅读文档并执行
 */

import { z } from 'zod';

// ==================== Plan 元数据 ====================

/**
 * Plan 元数据
 */
export interface PlanMeta {
    /** 唯一标识 */
    id: string;
    /** 标题 */
    title: string;
    /** 创建时间 */
    createdAt: string;
    /** 更新时间 */
    updatedAt: string;
    /** 关联的会话 ID */
    sessionId: string;
    /** MD 文件路径 */
    filePath: string;
}

// ==================== Plan 创建参数 ====================

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

// ==================== Zod Schemas ====================

export const planCreateSchema = z.object({
    title: z.string().min(1).max(200).describe('Plan title'),
    content: z.string().min(1).describe('Plan content in Markdown format'),
});

// ==================== Helper Functions ====================

/**
 * 生成唯一 Plan ID
 */
export function generatePlanId(): string {
    const adjectives = ['swift', 'calm', 'bold', 'wise', 'keen', 'fair', 'grand', 'crisp'];
    const verbs = ['running', 'working', 'coding', 'making', 'building', 'planning'];
    const nouns = ['river', 'mountain', 'forest', 'meadow', 'valley', 'stream', 'path'];
    
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const verb = verbs[Math.floor(Math.random() * verbs.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    
    return `${adj}-${verb}-${noun}`;
}

/**
 * 获取 ISO 格式的时间字符串
 */
export function nowIso(): string {
    return new Date().toISOString();
}
