/**
 * Plan Module - Storage
 *
 * Plan 文件存储实现
 *
 * 设计说明：
 * - 每个会话一个 Plan，存储在 {baseDir}/plans/{sessionId}/ 目录下
 * - 目录结构：
 *   plans/
 *   └── {sessionId}/
 *       ├── meta.json    # 元数据
 *       └── plan.md      # Markdown 内容
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
    PlanMeta,
    PlanData,
    CreatePlanParams,
    PLANS_DIR_NAME,
    generatePlanId,
    nowIso,
    isValidSessionId,
} from './types';

// ==================== 错误类 ====================

/**
 * Plan 存储错误
 */
export class PlanStorageError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly cause?: Error
    ) {
        super(message);
        this.name = 'PlanStorageError';
    }
}

// ==================== 接口定义 ====================

/**
 * Plan 存储接口
 */
export interface PlanStorage {
    /** 创建或更新 Plan（同一 sessionId 重复调用会覆盖） */
    create(params: CreatePlanParams): Promise<PlanMeta>;

    /** 根据 Plan ID 获取 Plan（O(n) 遍历，推荐使用 getBySession） */
    get(planId: string): Promise<PlanData | null>;

    /** 根据会话 ID 获取 Plan（O(1)，推荐使用） */
    getBySession(sessionId: string): Promise<PlanData | null>;

    /** 列出所有 Plan 元数据 */
    list(): Promise<PlanMeta[]>;

    /** 根据 Plan ID 删除 Plan（O(n) 遍历，推荐使用 deleteBySession） */
    delete(planId: string): Promise<boolean>;

    /** 根据会话 ID 删除 Plan（O(1)，推荐使用） */
    deleteBySession(sessionId: string): Promise<boolean>;
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

    // ==================== 私有方法 ====================

    private getPlansDir(): string {
        return path.join(this.baseDir, PLANS_DIR_NAME);
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

    private async ensureDir(dir: string): Promise<void> {
        try {
            await fs.mkdir(dir, { recursive: true });
        } catch (error) {
            // EEXIST 是预期错误（目录已存在），忽略
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                throw new PlanStorageError(
                    `Failed to create directory: ${dir}`,
                    'CREATE_DIR_FAILED',
                    error as Error
                );
            }
        }
    }

    // ==================== 公共方法 ====================

    async create(params: CreatePlanParams): Promise<PlanMeta> {
        // 验证 sessionId
        if (!isValidSessionId(params.sessionId)) {
            throw new PlanStorageError(
                `Invalid sessionId: ${params.sessionId}. Only alphanumeric characters, hyphens, and underscores are allowed.`,
                'INVALID_SESSION_ID'
            );
        }

        const sessionDir = this.getSessionDir(params.sessionId);
        await this.ensureDir(sessionDir);

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

        try {
            // 写入 Markdown 文件
            await fs.writeFile(filePath, params.content, 'utf-8');

            // 写入元数据
            await fs.writeFile(
                this.getMetaPath(params.sessionId),
                JSON.stringify(meta, null, 2),
                'utf-8'
            );

            return meta;
        } catch (error) {
            throw new PlanStorageError(
                `Failed to create plan: ${(error as Error).message}`,
                'CREATE_FAILED',
                error as Error
            );
        }
    }

    async get(planId: string): Promise<PlanData | null> {
        if (!planId || typeof planId !== 'string') {
            return null;
        }

        const plansDir = this.getPlansDir();

        try {
            const sessions = await fs.readdir(plansDir, { withFileTypes: true });

            for (const entry of sessions) {
                if (!entry.isDirectory()) continue;

                const sessionId = entry.name;
                const metaPath = this.getMetaPath(sessionId);

                try {
                    const metaContent = await fs.readFile(metaPath, 'utf-8');
                    const meta = JSON.parse(metaContent) as PlanMeta;

                    if (meta.id === planId) {
                        const content = await fs.readFile(this.getPlanPath(sessionId), 'utf-8');
                        return { meta, content };
                    }
                } catch {
                    // Skip invalid sessions (corrupted meta.json or missing plan.md)
                    continue;
                }
            }
        } catch (error) {
            // Plans directory doesn't exist
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return null;
            }
            throw new PlanStorageError(
                `Failed to read plans directory`,
                'READ_DIR_FAILED',
                error as Error
            );
        }

        return null;
    }

    async getBySession(sessionId: string): Promise<PlanData | null> {
        if (!sessionId || typeof sessionId !== 'string') {
            return null;
        }

        const metaPath = this.getMetaPath(sessionId);
        const planPath = this.getPlanPath(sessionId);

        try {
            const [metaContent, content] = await Promise.all([
                fs.readFile(metaPath, 'utf-8'),
                fs.readFile(planPath, 'utf-8'),
            ]);

            const meta = JSON.parse(metaContent) as PlanMeta;
            return { meta, content };
        } catch (error) {
            // Plan doesn't exist for this session
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return null;
            }
            throw new PlanStorageError(
                `Failed to read plan for session: ${sessionId}`,
                'READ_FAILED',
                error as Error
            );
        }
    }

    async list(): Promise<PlanMeta[]> {
        const plansDir = this.getPlansDir();
        const metas: PlanMeta[] = [];

        try {
            const sessions = await fs.readdir(plansDir, { withFileTypes: true });

            for (const entry of sessions) {
                if (!entry.isDirectory()) continue;

                const sessionId = entry.name;
                const metaPath = this.getMetaPath(sessionId);

                try {
                    const metaContent = await fs.readFile(metaPath, 'utf-8');
                    const meta = JSON.parse(metaContent) as PlanMeta;
                    metas.push(meta);
                } catch {
                    // Skip invalid sessions
                    continue;
                }
            }
        } catch (error) {
            // Plans directory doesn't exist
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw new PlanStorageError(
                    `Failed to list plans`,
                    'LIST_FAILED',
                    error as Error
                );
            }
        }

        // 按更新时间降序排序
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
        } catch (error) {
            throw new PlanStorageError(
                `Failed to delete plan: ${planId}`,
                'DELETE_FAILED',
                error as Error
            );
        }
    }

    async deleteBySession(sessionId: string): Promise<boolean> {
        if (!sessionId || typeof sessionId !== 'string') {
            return false;
        }

        const sessionDir = this.getSessionDir(sessionId);

        try {
            await fs.rm(sessionDir, { recursive: true });
            return true;
        } catch (error) {
            // 目录不存在视为删除失败
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return false;
            }
            throw new PlanStorageError(
                `Failed to delete plan for session: ${sessionId}`,
                'DELETE_FAILED',
                error as Error
            );
        }
    }
}

// ==================== 工厂函数 ====================

/**
 * 创建 Plan 存储
 *
 * @param baseDir 存储根目录，默认为 process.cwd()
 */
export function createPlanStorage(baseDir?: string): PlanStorage {
    return new FilePlanStorage(baseDir || process.cwd());
}

/**
 * 获取 Plan 文件路径
 */
export function getPlanFilePath(baseDir: string, sessionId: string): string {
    return path.join(baseDir, PLANS_DIR_NAME, sessionId, 'plan.md');
}
