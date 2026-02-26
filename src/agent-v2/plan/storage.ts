/**
 * ============================================================================
 * Plan Module - Storage (简化版)
 * ============================================================================
 *
 * Plan 文件存储 - 只负责保存和读取 Markdown 文档
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { IMemoryManager } from '../memory/types';
import { PlanMeta, CreatePlanParams, generatePlanId, nowIso } from './types';

// ==================== 常量 ====================

const PLANS_DIR = 'plans';

// ==================== 工具函数 ====================

async function ensureDir(dir: string): Promise<void> {
    try {
        await fs.mkdir(dir, { recursive: true });
    } catch {
        // Directory already exists
    }
}

// ==================== Plan 存储接口 ====================

/**
 * Plan 存储接口
 */
export interface PlanStorage {
    /** 创建 Plan（保存 MD 文件） */
    create(params: CreatePlanParams): Promise<PlanMeta>;
    
    /** 获取 Plan（读取 MD 文件） */
    get(planId: string): Promise<{ meta: PlanMeta; content: string } | null>;
    
    /** 获取会话的 Plan */
    getBySession(sessionId: string): Promise<{ meta: PlanMeta; content: string } | null>;
    
    /** 列出所有 Plan */
    list(sessionId?: string): Promise<PlanMeta[]>;
    
    /** 删除 Plan */
    delete(planId: string): Promise<boolean>;
}

// ==================== 文件存储实现 ====================

/**
 * 基于文件系统的 Plan 存储
 */
export class FilePlanStorage implements PlanStorage {
    private readonly baseDir: string;

    constructor(baseDir: string) {
        this.baseDir = baseDir;
    }

    private getPlansDir(): string {
        return path.join(this.baseDir, PLANS_DIR);
    }

    private getSessionDir(sessionId: string): string {
        return path.join(this.getPlansDir(), sessionId);
    }

    private getMetaPath(sessionId: string): string {
        return path.join(this.getSessionDir(sessionId), 'meta.json');
    }

    private getPlanPath(sessionId: string): string {
        return path.join(this.getSessionDir(sessionId), 'plan.md');
    }

    async create(params: CreatePlanParams): Promise<PlanMeta> {
        const sessionDir = this.getSessionDir(params.sessionId);
        await ensureDir(sessionDir);

        const id = generatePlanId();
        const now = nowIso();
        const filePath = this.getPlanPath(params.sessionId);

        const meta: PlanMeta = {
            id,
            title: params.title,
            createdAt: now,
            updatedAt: now,
            sessionId: params.sessionId,
            filePath,
        };

        // 写入 MD 文件
        await fs.writeFile(filePath, params.content, 'utf-8');

        // 写入元数据
        await fs.writeFile(this.getMetaPath(params.sessionId), JSON.stringify(meta, null, 2), 'utf-8');

        return meta;
    }

    async get(planId: string): Promise<{ meta: PlanMeta; content: string } | null> {
        // 遍历所有会话目录查找 planId
        const plansDir = this.getPlansDir();
        
        try {
            const sessions = await fs.readdir(plansDir);
            
            for (const sessionId of sessions) {
                const metaPath = this.getMetaPath(sessionId);
                try {
                    const metaContent = await fs.readFile(metaPath, 'utf-8');
                    const meta = JSON.parse(metaContent) as PlanMeta;
                    
                    if (meta.id === planId) {
                        const content = await fs.readFile(this.getPlanPath(sessionId), 'utf-8');
                        return { meta, content };
                    }
                } catch {
                    // Skip invalid sessions
                }
            }
        } catch {
            // Plans directory doesn't exist
        }
        
        return null;
    }

    async getBySession(sessionId: string): Promise<{ meta: PlanMeta; content: string } | null> {
        const metaPath = this.getMetaPath(sessionId);
        const planPath = this.getPlanPath(sessionId);

        try {
            const metaContent = await fs.readFile(metaPath, 'utf-8');
            const content = await fs.readFile(planPath, 'utf-8');
            const meta = JSON.parse(metaContent) as PlanMeta;
            
            return { meta, content };
        } catch {
            return null;
        }
    }

    async list(sessionId?: string): Promise<PlanMeta[]> {
        const plansDir = this.getPlansDir();
        const metas: PlanMeta[] = [];

        try {
            const sessions = await fs.readdir(plansDir);
            
            for (const session of sessions) {
                if (sessionId && session !== sessionId) continue;
                
                const metaPath = this.getMetaPath(session);
                try {
                    const metaContent = await fs.readFile(metaPath, 'utf-8');
                    const meta = JSON.parse(metaContent) as PlanMeta;
                    metas.push(meta);
                } catch {
                    // Skip invalid sessions
                }
            }
        } catch {
            // Plans directory doesn't exist
        }

        return metas.sort((a, b) => 
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
    }

    async delete(planId: string): Promise<boolean> {
        const plan = await this.get(planId);
        if (!plan) return false;

        const sessionDir = this.getSessionDir(plan.meta.sessionId);
        
        try {
            await fs.rm(sessionDir, { recursive: true });
            return true;
        } catch {
            return false;
        }
    }
}

// ==================== MemoryManager 适配 ====================

/**
 * 基于 MemoryManager 的 Plan 存储（fallback 到文件存储）
 */
export class MemoryManagerPlanStorage implements PlanStorage {
    private readonly fallbackStorage: FilePlanStorage;

    constructor(memoryManager?: IMemoryManager, sessionId?: string, fallbackDir?: string) {
        // 使用 fallback 文件存储
        this.fallbackStorage = new FilePlanStorage(fallbackDir || process.cwd());
    }

    create(params: CreatePlanParams): Promise<PlanMeta> {
        return this.fallbackStorage.create(params);
    }

    get(planId: string): Promise<{ meta: PlanMeta; content: string } | null> {
        return this.fallbackStorage.get(planId);
    }

    getBySession(sessionId: string): Promise<{ meta: PlanMeta; content: string } | null> {
        return this.fallbackStorage.getBySession(sessionId);
    }

    list(sessionId?: string): Promise<PlanMeta[]> {
        return this.fallbackStorage.list(sessionId);
    }

    delete(planId: string): Promise<boolean> {
        return this.fallbackStorage.delete(planId);
    }
}

// ==================== 工厂函数 ====================

/**
 * 创建 Plan 存储
 */
export function createPlanStorage(
    memoryManager?: IMemoryManager,
    sessionId?: string,
    baseDir?: string
): PlanStorage {
    if (memoryManager) {
        return new MemoryManagerPlanStorage(memoryManager, sessionId, baseDir);
    }
    return new FilePlanStorage(baseDir || process.cwd());
}

/**
 * 获取 Plan 文件路径（用于 Agent 读取）
 */
export function getPlanFilePath(baseDir: string, sessionId: string): string {
    return path.join(baseDir, PLANS_DIR, sessionId, 'plan.md');
}
