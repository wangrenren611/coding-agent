# 日志系统实现详解（面向前端转服务端）

## 1. 这份文档适合谁

如果你主要做前端，现在开始接触服务端，这份文档的目标是帮你建立一套完整日志思维：

1. 日志不是 `console.log`，而是可观测性基础设施。
2. 日志系统是“管道”，不是“函数”。
3. 正确的日志实现要同时考虑：结构化、可靠性、安全、性能、可运维。

本文基于当前项目代码实现，重点文件：

1. `src/agent-v2/logger/logger.ts`
2. `src/agent-v2/logger/config.ts`
3. `src/agent-v2/logger/types.ts`
4. `src/agent-v2/logger/middleware/context.ts`
5. `src/agent-v2/logger/middleware/event-logger.ts`
6. `src/agent-v2/logger/transports/file.ts`

---

## 2. 一句话理解日志系统

日志系统本质是一条流水线：

`业务事件 -> 结构化日志记录 -> 中间件处理 -> 格式化 -> 输出通道 -> flush/close`

用前端类比：

1. `业务事件` 像埋点事件。
2. `中间件` 像 request/response interceptor。
3. `formatter` 像渲染层（给人看 or 给机器看）。
4. `transport` 像上报通道（console/file/远端）。

---

## 3. 当前实现的核心模块分工

### 3.1 Logger（核心调度器）

文件：`src/agent-v2/logger/logger.ts`

职责：

1. 创建 `LogRecord`
2. 执行中间件链
3. 将日志写到多个 transport
4. 追踪 pending 异步写入，保证 `flush/close` 可靠
5. 提供 `trace/debug/info/warn/error/fatal`

关键点：

1. 内部维护 `pendingWrites`，关闭前会等待所有异步日志完成。
2. `close()` 幂等，避免重复关闭导致异常。
3. `logWithLevel` 统一入口，所有等级方法都走这条链路。

### 3.2 Types（日志模型）

文件：`src/agent-v2/logger/types.ts`

核心结构：

1. `LogLevel`：0/10/20/30/40/50
2. `LogRecord`：`timestamp/level/message/context/error/data`
3. `LoggerConfig`：全局配置，包含 console/file/remote（remote 预留）

核心思想：日志必须结构化，不能只靠字符串。

### 3.3 Middleware（中间件）

文件：

1. `src/agent-v2/logger/middleware/context.ts`
2. `src/agent-v2/logger/middleware/event-logger.ts`

当前重点：

1. `ContextManager` 使用 `AsyncLocalStorage` 做异步上下文隔离，避免并发串上下文。
2. `event-logger` 把 `EventBus` 事件映射为 `LogRecord`，减少业务层重复打点。

### 3.4 Formatter（输出格式）

文件：

1. `src/agent-v2/logger/formatters/json.ts`
2. `src/agent-v2/logger/formatters/pretty.ts`

区别：

1. `json`：给机器处理（生产推荐）
2. `pretty`：给人类本地调试

当前实现已处理不可序列化对象容错，避免格式化阶段崩溃。

### 3.5 Transport（输出通道）

文件：

1. `src/agent-v2/logger/transports/console.ts`
2. `src/agent-v2/logger/transports/file.ts`

`FileTransport` 关键能力：

1. 缓冲写入（降低 I/O 压力）
2. flush 定时器
3. `size/time/both` 轮转策略
4. 关闭前可靠冲刷缓冲区

---

## 4. 端到端执行流程（非常重要）

```mermaid
flowchart LR
  A["Business/Event"] --> B["Logger.createRecord"]
  B --> C["Middlewares (context/sanitize/custom)"]
  C --> D["Formatter (json/pretty)"]
  D --> E["Transports (console/file)"]
  E --> F["pendingWrites tracked"]
  F --> G["flush/close wait all writes"]
```

关键理解：

1. 日志不是“立刻打印完事”，尤其是 file 异步写入。
2. 真正可靠的系统要在退出时 `flush`，不然最后几条最关键日志会丢。

---

## 5. 配置系统：优先级与环境变量

文件：`src/agent-v2/logger/config.ts`

配置合并顺序（从低到高）：

1. `defaultLoggerConfig`
2. 按 `env` 的环境配置（development/production/test）
3. `.env` 日志变量覆盖
4. 代码里显式传入 `loggerConfig`

即：**代码传入优先级最高，`.env` 次之**。

### 5.1 可用环境变量

#### 全局

1. `LOG_ENV`：`development/staging/production/test`
2. `LOG_LEVEL`：`0/10/20/30/40/50`
3. `LOG_SERVICE`
4. `LOG_AGENT_EVENTS`
5. `LOG_SENSITIVE_FIELDS`（逗号分隔）

#### 控制台

1. `LOG_CONSOLE_ENABLED`
2. `LOG_CONSOLE_LEVEL`
3. `LOG_CONSOLE_FORMAT`：`pretty/json`
4. `LOG_CONSOLE_COLORIZE`
5. `LOG_CONSOLE_TIMESTAMP`
6. `LOG_CONSOLE_STREAM`：`stdout/stderr`

#### 文件

1. `LOG_FILE_ENABLED`
2. `LOG_FILE_LEVEL`
3. `LOG_FILE_PATH`（完整路径）
4. `LOG_DIR` + `LOG_FILE_NAME`（目录+文件名组合）
5. `LOG_FILE_FORMAT`：`json/pretty`
6. `LOG_FILE_SYNC`
7. `LOG_FILE_BUFFER_SIZE`
8. `LOG_FILE_FLUSH_INTERVAL`
9. `LOG_FILE_ROTATION_ENABLED`
10. `LOG_FILE_ROTATION_STRATEGY`：`size/time/both`
11. `LOG_FILE_ROTATION_MAX_SIZE`
12. `LOG_FILE_ROTATION_MAX_FILES`
13. `LOG_FILE_ROTATION_INTERVAL`

---

## 6. 从前端视角迁移：你最容易忽略的点

### 6.1 前端习惯：本地 console 即可

服务端风险：

1. 并发请求混在一起，看不出谁是谁。
2. 进程退出前日志未落盘。
3. 线上日志量巨大，纯文本不可检索。

对应改造：

1. 每条日志带 `requestId/sessionId`。
2. 结构化 JSON。
3. 可靠 flush。

### 6.2 前端习惯：报错才打日志

服务端建议：

1. 关键状态转换也打（start/retry/success/fail）
2. 警告级别单独管理（`WARN`）
3. 使用事件桥接自动打点，避免遗漏

### 6.3 前端习惯：日志里随手打对象

服务端风险：

1. 循环引用导致序列化异常
2. 敏感字段泄露（token/password/apiKey）

对应改造：

1. 格式化容错
2. 脱敏中间件

---

## 7. 可靠性设计（企业级最关键）

### 7.1 为什么会丢日志

常见场景：

1. 异步写文件尚未完成，进程退出。
2. 写入错误未处理。
3. 关闭过程没有等待 pending write。

### 7.2 当前实现如何避免

1. `Logger` 追踪 `pendingWrites`。
2. `flush()` 先等待 pending，再调用 transport.flush。
3. `close()` 幂等并等待 `flush` 完成。
4. `FileTransport.close()` 会等待缓冲写入完成后再 `end()`。

---

## 8. 安全设计（必须有）

### 8.1 脱敏

默认敏感字段：

1. `apiKey`
2. `api_key`
3. `password`
4. `token`
5. `secret`
6. `authorization`

可通过 `LOG_SENSITIVE_FIELDS` 覆盖。

### 8.2 建议补充（你后续可以做）

1. 增加“白名单日志字段”策略（防止过量字段写入）
2. 对 `error.stack` 做长度截断，避免日志爆炸
3. 区分“审计日志”和“调试日志”

---

## 9. 使用示例

### 9.1 只写文件，不打印控制台

```env
LOG_CONSOLE_ENABLED=false
LOG_FILE_ENABLED=true
LOG_DIR=./logs
LOG_FILE_NAME=agent.log
LOG_FILE_FORMAT=json
```

### 9.2 开发环境友好输出

```env
LOG_LEVEL=10
LOG_CONSOLE_ENABLED=true
LOG_CONSOLE_FORMAT=pretty
LOG_CONSOLE_COLORIZE=true
LOG_FILE_ENABLED=false
```

### 9.3 生产推荐

```env
LOG_LEVEL=20
LOG_CONSOLE_ENABLED=true
LOG_CONSOLE_FORMAT=json
LOG_CONSOLE_LEVEL=30

LOG_FILE_ENABLED=true
LOG_FILE_FORMAT=json
LOG_FILE_ROTATION_ENABLED=true
LOG_FILE_ROTATION_STRATEGY=both
LOG_FILE_ROTATION_MAX_SIZE=52428800
LOG_FILE_ROTATION_INTERVAL=3600000
LOG_FILE_ROTATION_MAX_FILES=10
```

---

## 10. 常见问题排查

### Q1：为什么我设置了 LOG_LEVEL 但没生效？

先检查：

1. 是否代码里传了 `loggerConfig.level`（代码优先级更高）
2. `LOG_LEVEL` 是否合法值（0/10/20/30/40/50）

### Q2：为什么控制台没日志了？

检查：

1. `LOG_CONSOLE_ENABLED=false`？
2. 当前环境是否 `test`（默认 console 关闭）
3. 级别是否过高（例如 `LOG_LEVEL=40`）

### Q3：文件日志为什么没落盘？

检查：

1. `LOG_FILE_ENABLED=true` 是否设置
2. 文件路径是否可写
3. 进程退出前是否调用了 `close()`

---

## 11. 你可以按这个学习顺序来

1. 先读 `types.ts`（理解日志数据模型）
2. 再读 `logger.ts`（理解主流程）
3. 再读 `transports/file.ts`（理解可靠性）
4. 再读 `middleware/context.ts`（理解并发上下文）
5. 最后读 `config.ts`（理解配置合并）

---

## 12. 服务端日志最小清单（实践版）

每次做新服务，至少做到：

1. 全链路 requestId/sessionId
2. 结构化 JSON（生产）
3. INFO/WARN/ERROR 分级明确
4. 敏感字段脱敏
5. 异步写入 + flush/close
6. 支持环境变量控制日志行为

你已经有了一个不错的企业级起点。接下来可以继续进阶到：

1. 接入集中式日志平台（ELK/Loki/Datadog）
2. 加 trace/span（OpenTelemetry）
3. 日志告警与 SLO 联动
