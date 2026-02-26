/**
 * 截断系统类型定义
 *
 * @module truncation/types
 */

/**
 * 截断方向
 */
export type TruncationDirection = 'head' | 'tail';

/**
 * 截断结果（判别联合）
 *
 * 使用判别联合的好处：
 * - TypeScript 自动类型收窄
 * - 明确区分截断和未截断状态
 */
export type TruncationResult =
    | {
          /** 截断后的内容 */
          content: string;
          /** 是否截断 */
          truncated: false;
      }
    | {
          content: string;
          truncated: true;
          /** 完整内容的存储路径 */
          outputPath: string;
          /** 移除的行数 */
          removedLines?: number;
          /** 移除的字节数 */
          removedBytes?: number;
      };

/**
 * 截断配置
 */
export interface TruncationConfig {
    /** 最大行数（默认 2000） */
    maxLines: number;
    /** 最大字节数（默认 50KB = 51200） */
    maxBytes: number;
    /** 截断方向（默认 head） */
    direction: TruncationDirection;
    /** 是否启用（默认 true） */
    enabled: boolean;
    /** 文件保留天数（默认 7） */
    retentionDays: number;
    /** 自定义存储目录（可选） */
    storageDir?: string;
}

/**
 * 截断选项（单次调用覆盖配置）
 */
export interface TruncationOptions {
    /** 覆盖最大行数 */
    maxLines?: number;
    /** 覆盖最大字节数 */
    maxBytes?: number;
    /** 覆盖截断方向 */
    direction?: TruncationDirection;
    /** 跳过截断 */
    skip?: boolean;
}

/**
 * 截断上下文（传递给截断服务）
 */
export interface TruncationContext {
    /** 工具名称 */
    toolName: string;
    /** 会话 ID */
    sessionId?: string;
    /** 消息 ID */
    messageId?: string;
    /** 工具特定选项 */
    options?: TruncationOptions;
}

/**
 * 截断策略接口
 */
export interface TruncationStrategy {
    /** 策略名称 */
    readonly name: string;

    /**
     * 检查是否需要截断
     * @param content 原始内容
     * @param config 截断配置
     * @returns 是否需要截断
     */
    needsTruncation(content: string, config: TruncationConfig): boolean;

    /**
     * 执行截断
     * @param content 原始内容
     * @param config 截断配置
     * @returns 截断后的内容和统计信息
     */
    truncate(content: string, config: TruncationConfig): {
        content: string;
        removedLines?: number;
        removedBytes?: number;
    };
}

/**
 * 截断事件类型
 */
export type TruncationEventType = 'truncated' | 'skipped' | 'error';

/**
 * 截断事件
 */
export interface TruncationEvent {
    /** 事件类型 */
    type: TruncationEventType;
    /** 工具名称 */
    toolName: string;
    /** 原始大小（字节） */
    originalSize: number;
    /** 截断后大小（字节） */
    truncatedSize: number;
    /** 存储路径（截断时有值） */
    outputPath?: string;
    /** 错误信息（错误时有值） */
    error?: string;
    /** 时间戳 */
    timestamp: number;
}

/**
 * 截断事件回调
 */
export type TruncationEventCallback = (event: TruncationEvent) => void;

/**
 * 存储接口（便于扩展不同存储后端）
 */
export interface ITruncationStorage {
    /**
     * 保存内容到存储
     * @param content 内容
     * @param context 上下文
     * @returns 存储路径
     */
    save(content: string, context: TruncationContext): Promise<string>;

    /**
     * 读取存储的内容
     * @param path 存储路径
     * @returns 内容
     */
    read(path: string): Promise<string>;

    /**
     * 清理过期文件
     * @param retentionDays 保留天数
     * @returns 清理的文件数
     */
    cleanup(retentionDays: number): Promise<number>;

    /**
     * 获取存储目录
     */
    getStorageDir(): string;
}
