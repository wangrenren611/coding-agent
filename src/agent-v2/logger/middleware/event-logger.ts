/**
 * Agent 事件日志中间件
 *
 * 将 EventBus 事件自动转换为日志记录
 */

import type { EventBus } from '../../eventbus/eventbus';
import { EventType, type EventMap, type BaseEventData, type EventListener } from '../../eventbus/types';
import type { LogRecord, LogLevel } from '../types';
import { LogLevel as Lvl, LogLevelName } from '../types';

/**
 * Agent 事件映射器函数类型
 */
export type AgentEventMapper = (event: { type: EventType; data: BaseEventData }) => LogRecord | null;

/**
 * 事件到日志级别的映射
 */
const EventLogLevel: Record<string, LogLevel> = {
    [EventType.TASK_START]: Lvl.INFO,
    [EventType.TASK_PROGRESS]: Lvl.DEBUG,
    [EventType.TASK_SUCCESS]: Lvl.INFO,
    [EventType.TASK_FAILED]: Lvl.ERROR,
    [EventType.TASK_RETRY]: Lvl.WARN,
    [EventType.TOOL_START]: Lvl.DEBUG,
    [EventType.TOOL_SUCCESS]: Lvl.DEBUG,
    [EventType.TOOL_FAILED]: Lvl.WARN,
    [EventType.STREAM_CHUNK]: Lvl.TRACE,
};

/**
 * 事件到日志消息的映射
 */
function createEventMessage(type: EventType, data: BaseEventData): string {
    switch (type) {
        case EventType.TASK_START: {
            const d = data as unknown as { query: string };
            return `Task started: ${d.query.substring(0, 100)}...`;
        }
        case EventType.TASK_PROGRESS: {
            const d = data as unknown as { loopCount: number };
            return `Task progress: loop ${d.loopCount}`;
        }
        case EventType.TASK_SUCCESS: {
            const d = data as unknown as { totalLoops: number; totalRetries: number; duration: number };
            return `Task completed: ${d.totalLoops} loops, ${d.totalRetries} retries, ${d.duration}ms`;
        }
        case EventType.TASK_FAILED: {
            const d = data as unknown as { error: string };
            return `Task failed: ${d.error}`;
        }
        case EventType.TASK_RETRY: {
            const d = data as unknown as { retryCount: number; maxRetries: number; reason: string };
            return `Task retry (${d.retryCount}/${d.maxRetries}): ${d.reason}`;
        }
        case EventType.TOOL_START: {
            const d = data as unknown as { toolName: string };
            return `Tool started: ${d.toolName}`;
        }
        case EventType.TOOL_SUCCESS: {
            const d = data as unknown as { toolName: string; duration: number };
            return `Tool completed: ${d.toolName} (${d.duration}ms)`;
        }
        case EventType.TOOL_FAILED: {
            const d = data as unknown as { toolName: string; error: string };
            return `Tool failed: ${d.toolName} - ${d.error}`;
        }
        case EventType.STREAM_CHUNK:
            return 'Stream chunk received';
        default:
            return `Event: ${String(type)}`;
    }
}

/**
 * 从事件数据提取上下文
 */
function extractContext(type: EventType, data: BaseEventData): Record<string, unknown> {
    const context: Record<string, unknown> = {};

    switch (type) {
        case EventType.TOOL_START:
        case EventType.TOOL_SUCCESS:
        case EventType.TOOL_FAILED: {
            const d = data as unknown as { toolName: string };
            context.toolName = d.toolName;
            break;
        }
        case EventType.TASK_RETRY: {
            const d = data as unknown as { retryCount: number; maxRetries: number };
            context.retryCount = d.retryCount;
            context.maxRetries = d.maxRetries;
            break;
        }
        case EventType.TASK_PROGRESS: {
            const d = data as unknown as { loopCount: number; retryCount: number };
            context.loopCount = d.loopCount;
            context.retryCount = d.retryCount;
            break;
        }
        case EventType.TASK_SUCCESS:
        case EventType.TASK_FAILED: {
            const d = data as unknown as { totalLoops: number; totalRetries: number; duration: number };
            context.totalLoops = d.totalLoops;
            context.totalRetries = d.totalRetries;
            context.duration = d.duration;
            break;
        }
    }

    return context;
}

/**
 * 创建 Agent 事件到日志记录的映射器
 */
export function createAgentEventMapper(sessionId?: string): AgentEventMapper {
    return (event: { type: EventType; data: BaseEventData }): LogRecord | null => {
        const { type, data } = event;

        const level = EventLogLevel[type] ?? Lvl.INFO;
        const message = createEventMessage(type, data);
        const context = extractContext(type, data);

        if (sessionId) {
            context.sessionId = sessionId;
        }

        // 对于失败事件，添加错误信息
        let error: LogRecord['error'] | undefined;
        if (type === EventType.TASK_FAILED || type === EventType.TOOL_FAILED) {
            const d = data as unknown as { error: string };
            error = {
                name: 'AgentError',
                message: d.error,
            };
        }

        return {
            timestamp: new Date(data.timestamp).toISOString(),
            level,
            levelName: LogLevelName[level],
            message,
            context,
            error,
            module: 'agent',
        };
    };
}

/**
 * 事件日志中间件配置
 */
export interface EventLoggerConfig {
    /** 是否记录所有事件 */
    logAllEvents?: boolean;
    /** 排除的事件类型 */
    excludeEvents?: EventType[];
    /** 自定义映射器 */
    customMapper?: AgentEventMapper;
    /** 会话 ID */
    sessionId?: string;
}

/**
 * 创建事件日志中间件
 *
 * 用于订阅 EventBus 事件并转换为日志记录
 */
export function createEventLoggerMiddleware(
    eventBus: EventBus,
    logger: { log: (record: LogRecord) => void },
    config: EventLoggerConfig = {}
): () => void {
    const { excludeEvents = [], customMapper, sessionId, logAllEvents = true } = config;
    const defaultMapper = createAgentEventMapper(sessionId);

    const listeners: Map<EventType, EventListener<BaseEventData>> = new Map();

    // 默认聚合模式仅记录核心事件，减少噪音
    const coreEventTypes: EventType[] = [
        EventType.TASK_START,
        EventType.TASK_SUCCESS,
        EventType.TASK_FAILED,
        EventType.TASK_RETRY,
        EventType.TOOL_FAILED,
    ];
    const eventTypes: EventType[] = logAllEvents ? (Object.values(EventType) as EventType[]) : coreEventTypes;

    for (const eventType of eventTypes) {
        if (excludeEvents.includes(eventType)) {
            continue;
        }

        const listener: EventListener<BaseEventData> = (data: BaseEventData) => {
            const event = { type: eventType, data };

            // 使用自定义映射器或默认映射器
            const record = customMapper ? customMapper(event) : defaultMapper(event);

            if (record) {
                logger.log(record);
            }
        };

        listeners.set(eventType, listener);
        eventBus.on(eventType, listener as EventListener<EventMap[typeof eventType]>);
    }

    // 返回取消订阅函数
    return () => {
        for (const [eventType, listener] of listeners) {
            eventBus.off(eventType, listener as EventListener<EventMap[typeof eventType]>);
        }
        listeners.clear();
    };
}
