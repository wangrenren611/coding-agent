/**
 * 日志模块
 *
 * 企业级日志系统，支持：
 * - 多级别日志 (TRACE, DEBUG, INFO, WARN, ERROR, FATAL)
 * - 多输出目标 (Console, File, Remote)
 * - 结构化日志 (JSON 格式)
 * - 日志轮转 (按大小/时间)
 * - 中间件支持
 * - 上下文管理
 * - Agent 事件自动记录
 * - 敏感信息脱敏
 *
 * @example
 * ```typescript
 * import { createLogger, LogLevel } from './logger';
 *
 * // 创建日志器
 * const logger = createLogger({
 *   service: 'my-service',
 *   level: LogLevel.INFO,
 *   console: { colorize: true },
 *   file: { enabled: true, filepath: './logs/app.log' }
 * });
 *
 * // 记录日志
 * logger.info('Application started', { version: '1.0.0' });
 * logger.error('Something went wrong', new Error('Oops'));
 *
 * // 创建子日志器
 * const moduleLogger = logger.child('MyModule');
 * moduleLogger.debug('Processing request', { requestId: '123' });
 *
 * // 与 EventBus 集成
 * import { createEventLoggerMiddleware } from './logger/middleware';
 * const unsubscribe = createEventLoggerMiddleware(eventBus, logger, { sessionId: 'xxx' });
 * ```
 */

// 类型导出
export * from './types';

// 配置
export { defaultLoggerConfig, mergeConfig, getConfigForEnv } from './config';

// 核心类
export { Logger, ChildLogger, createLogger, getLogger, setDefaultLogger } from './logger';

// 格式化器
export * from './formatters';

// Transport
export * from './transports';

// 中间件
export * from './middleware';
