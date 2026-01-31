# Coding Agent 执行流程文档

> 版本：v1.0.0
> 更新时间：2026-01-31

---

## 目录

- [1. 整体执行流程](#1-整体执行流程)
- [2. ReAct 循环详解](#2-react-循环详解)
- [3. 任务执行流程](#3-任务执行流程)
- [4. 工具调用流程](#4-工具调用流程)
- [5. 错误处理流程](#5-错误处理流程)
- [6. 状态转换流程](#6-状态转换流程)
- [7. 数据流转详解](#7-数据流转详解)
- [8. 时序图](#8-时序图)

---

## 1. 整体执行流程

### 1.1 执行流程概览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Agent 执行流程                                │
│                                                                         │
│  ┌────────────────┐                                                    │
│  │  1. 用户输入    │                                                   │
│  │     task       │                                                   │
│  └────────┬───────┘                                                    │
│           │                                                             │
│           ▼                                                             │
│  ┌────────────────┐                                                    │
│  │  2. 初始化阶段   │                                                   │
│  │  - 创建上下文    │                                                   │
│  │  - 设置配置      │                                                   │
│  │  - 初始化组件    │                                                   │
│  └────────┬───────┘                                                    │
│           │                                                             │
│           ▼                                                             │
│  ┌────────────────┐                                                    │
│  │  3. 规划阶段     │                                                   │
│  │  - 分析任务      │                                                   │
│  │  - 分解子任务    │                                                   │
│  │  - 生成执行计划   │                                                  │
│  └────────┬───────┘                                                    │
│           │                                                             │
│           ▼                                                             │
│  ┌────────────────┐                                                    │
│  │  4. 执行阶段     │                                                   │
│  │  ┌──────────┐   │                                                   │
│  │  │ReAct Loop │   │  ←── 核心循环，可多次迭代                         │
│  │  │  Think   │   │                                                   │
│  │  │  Act     │   │                                                   │
│  │  │ Observe  │   │                                                   │
│  │  │ Reflect  │   │                                                   │
│  │  └────┬─────┘   │                                                   │
│  │       │         │                                                   │
│  │       ▼ No      │                                                   │
│  │  ┌─────────┐    │                                                   │
│  │  │Continue?│───Yes→ 回到 Think                                   │
│  │  └─────────┘    │                                                   │
│  └────────┬───────┘                                                    │
│           │                                                             │
│           ▼                                                             │
│  ┌────────────────┐                                                    │
│  │  5. 完成阶段     │                                                   │
│  │  - 生成最终响应   │                                                  │
│  │  - 汇总执行结果   │                                                  │
│  │  - 清理资源      │                                                   │
│  └────────┬───────┘                                                    │
│           │                                                             │
│           ▼                                                             │
│  ┌────────────────┐                                                    │
│  │  6. 返回结果     │                                                   │
│  └────────────────┘                                                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 详细执行步骤

```typescript
// ========== 步骤 1: 接收用户输入 ==========
const task = "分析项目结构并生成文档";

// ========== 步骤 2: 初始化阶段 ==========
// 2.1 创建中止控制器
const abortController = new AbortController();

// 2.2 创建执行上下文
const context = memoryManager.createContext(uuidv4());
context.userInputHistory.push(task);

// 2.3 初始化各组件
// - ToolRegistry: 加载内置工具
// - TaskManager: 准备任务跟踪
// - Planner: 准备任务规划
// - BackupManager: 初始化备份目录

// ========== 步骤 3: 规划阶段 ==========
// 3.1 调用 Planner 分析任务
const plan = await planner.createPlan(task, context);

// 3.2 添加任务到管理器
taskManager.addTask(plan.mainTask);
plan.subtasks.forEach(t => taskManager.addTask(t));

// 计划示例：
// {
//   mainTask: { id: "task-1", description: "分析项目结构并生成文档" },
//   subtasks: [
//     { id: "task-2", description: "扫描项目目录", dependencies: [] },
//     { id: "task-3", description: "分析文件类型", dependencies: ["task-2"] },
//     { id: "task-4", description: "生成文档结构", dependencies: ["task-3"] },
//     { id: "task-5", description: "编写文档内容", dependencies: ["task-4"] }
//   ],
//   executionOrder: ["task-2", "task-3", "task-4", "task-5"]
// }

// ========== 步骤 4: 执行阶段（ReAct 循环）==========
let shouldContinue = true;
let loopCount = 0;
let finalResponse: string | undefined;

while (shouldContinue && loopCount < maxLoops) {
    loopCount++;

    // --- 4.1 Think 阶段 ---
    const thinkResult = await think(task, context);

    // 示例 thinkResult:
    // {
    //   thought: "我需要先了解项目结构，使用 list_directory 工具",
    //   toolCall: { name: "list_directory", arguments: '{"recursive": true}' }
    // }

    // --- 4.2 Act 阶段 ---
    if (thinkResult.toolCall) {
        const toolResult = await executeTool(thinkResult.toolCall);

        // --- 4.3 Observe 阶段 ---
        const observation = processToolResult(toolResult);

        // --- 4.4 Reflect 阶段 ---
        const reflection = await reflect(task, thinkResult.thought, observation);

        // --- 4.5 决策 ---
        shouldContinue = checkShouldContinue(reflection);
        if (!shouldContinue) finalResponse = reflection;
    } else {
        // 没有 tool call，表示完成
        finalResponse = thinkResult.thought;
        shouldContinue = false;
    }
}

// ========== 步骤 5: 完成阶段 ==========
// 5.1 生成最终响应
if (!finalResponse) {
    finalResponse = await generateFinalResponse(task, context);
}

// 5.2 收集执行结果
const result = {
    success: true,
    response: finalResponse,
    toolCalls: context.toolCallHistory,
    tasks: taskManager.getAllTasks(),
    duration: Date.now() - startTime,
};

// ========== 步骤 6: 返回结果 ==========
return result;
```

---

## 2. ReAct 循环详解

### 2.1 ReAct 循环状态机

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ReAct 状态机                                  │
│                                                                         │
│     ┌───────┐                                                          │
│     │ THINK  │ ◀──────────────────────────────────────────────┐      │
│     └───┬───┘                                                   │      │
│         │                                                        │      │
│         │ 分析当前状态，决定下一步行动                             │      │
│         │ 生成思考内容和工具调用计划                                │      │
│         ▼                                                        │      │
│     ┌───────┐                                                    │      │
│     │  ACT   │ ──────────────────────────────────────────────┐  │      │
│     └───────┘                                               │  │      │
│         │                                                    │  │      │
│         │ 执行工具调用                                         │  │      │
│         │ 获取执行结果                                         │  │      │
│         ▼                                                    │  │      │
│     ┌───────┐                                               │  │      │
│     │OBSERVE│ ──────────────────────────────────────────────┼─┘      │
│     └───────┘                                               │         │
│         │                                                    │         │
│         │ 解析工具执行结果                                     │         │
│         │ 提取关键信息                                         │         │
│         ▼                                                    │         │
│     ┌───────┐                                               │         │
│     │REFLECT│ ──────────────────────────────────────────────┼─────────┘
│     └───┬───┘                                               │
│         │                                                    │
│         │ 评估任务进度                                        │
│         │ 决定继续或结束                                      │
│         │                                                    │
│         └──────────────┬─────────────────────────────────────┘
│                        │
│               ┌────────┴────────┐
│               │                 │
│               ▼ Yes            ▼ No
│          ┌─────────┐      ┌─────────┐
│          │ 继续    │      │ 完成    │
│          │THINK    │      │ 输出结果 │
│          └─────────┘      └─────────┘
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Think 阶段详解

```typescript
/**
 * Think 阶段 - 思考下一步行动
 *
 * 输入：
 *   - task: 原始任务描述
 *   - context: 当前执行上下文（包含历史、当前任务等）
 *   - loopCount: 当前循环次数
 *
 * 输出：
 *   - thought: 思考内容
 *   - toolCall: 工具调用请求（可选）
 */
async function think(
    task: string,
    context: ExecutionContext,
    reactContext: ReActContext
): Promise<ThinkResult> {
    // ===== 1. 构建系统提示词 =====
    const systemPrompt = memoryManager.buildSystemPrompt(context);

    // ===== 2. 构建消息列表 =====
    const messages: LLMRequestMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: task },
        // ... 添加历史对话
        ...context.userInputHistory.slice(-10).map(msg => ({
            role: 'user' as const,
            content: msg,
        })),
    ];

    // ===== 3. 添加工具调用历史 =====
    for (const call of context.toolCallHistory.slice(-5)) {
        messages.push({
            role: 'assistant' as const,
            content: `Called tool: ${call.toolName}`,
        });
        messages.push({
            role: 'user' as const,
            content: `Result: ${JSON.stringify(call.result)}`,
        });
    }

    // ===== 4. 添加当前思考 =====
    if (reactContext.lastObservation) {
        messages.push({
            role: 'system' as const,
            content: `Last observation: ${JSON.stringify(reactContext.lastObservation)}`,
        });
    }

    // ===== 5. 调用 LLM =====
    const response = await provider.generate(messages, {
        tools: toolRegistry.toLLMTools(),
    });

    // ===== 6. 解析响应 =====
    const message = response.choices[0].message;

    // 检查是否有工具调用
    if (message.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];
        return {
            thought: message.content || '',
            toolCall: {
                name: toolCall.function.name,
                arguments: toolCall.function.arguments || '{}',
            },
        };
    }

    // 没有工具调用，返回最终思考
    return {
        thought: message.content || '',
    };
}
```

**Think 阶段输出示例：**

```json
{
  "thought": "我需要先了解项目的目录结构，然后分析其中的文件类型和数量。",
  "toolCall": {
    "name": "list_directory",
    "arguments": "{\"path\": \".\", \"recursive\": true, \"pattern\": \"*\"}"
  }
}
```

### 2.3 Act 阶段详解

```typescript
/**
 * Act 阶段 - 执行工具调用
 *
 * 输入：
 *   - toolName: 工具名称
 *   - argsString: 参数 JSON 字符串
 *   - context: 执行上下文
 *
 * 输出：
 *   - ToolCallRecord: 工具调用记录
 */
async function act(
    toolName: string,
    argsString: string,
    context: ExecutionContext
): Promise<ToolCallRecord> {
    const startTime = Date.now();
    const callId = `call-${Date.now()}`;

    try {
        // ===== 1. 解析参数 =====
        const args = JSON.parse(argsString);

        // ===== 2. 执行工具 =====
        const result = await toolRegistry.execute(toolName, args, context);

        // ===== 3. 构建调用记录 =====
        const record: ToolCallRecord = {
            id: callId,
            toolName,
            parameters: args,
            result,
            startTime,
            endTime: Date.now(),
            duration: Date.now() - startTime,
            success: result.success,
        };

        return record;

    } catch (error) {
        // 错误处理
        return {
            id: callId,
            toolName,
            parameters: argsString,
            result: {
                success: false,
                error: (error as Error).message,
                retryable: isRetryableError(error as Error),
            },
            startTime,
            endTime: Date.now(),
            duration: Date.now() - startTime,
            success: false,
        };
    }
}
```

**Act 阶段执行示例：**

```typescript
// 输入
toolName = "list_directory"
argsString = '{"path": ".", "recursive": true}'

// 执行过程
// 1. 解析参数 -> { path: ".", recursive: true }
// 2. 调用 toolRegistry.execute("list_directory", {...}, context)
// 3. ToolExecutor 执行实际逻辑
// 4. 返回结果

// 输出
{
  "id": "call-1234567890",
  "toolName": "list_directory",
  "parameters": { "path": ".", "recursive": true },
  "result": {
    "success": true,
    "data": {
      "files": [
        { "path": "src/agent.ts", "isFile": true, "size": 1234 },
        { "path": "src/types.ts", "isFile": true, "size": 5678 },
        // ...
      ],
      "count": 42
    }
  },
  "duration": 156
}
```

### 2.4 Observe 阶段详解

```typescript
/**
 * Observe 阶段 - 观察工具执行结果
 *
 * 输入：
 *   - toolCall: 工具调用记录
 *   - context: 执行上下文
 *
 * 输出：
 *   - ToolResult: 处理后的观察结果
 */
function observe(
    toolCall: ToolCallRecord,
    context: ExecutionContext
): ToolResult {
    // ===== 1. 记录思考 =====
    context.thoughts.push({
        content: `Executed ${toolCall.toolName}: ${toolCall.result.success ? 'Success' : 'Failed'}`,
        timestamp: Date.now(),
        relatedToolCall: toolCall.id,
    });

    // ===== 2. 更新文件变更历史 =====
    if (toolCall.toolName === 'write_file' && toolCall.result.success) {
        const data = toolCall.result.data as { path: string; backupPath?: string };
        context.fileChangeHistory.push({
            path: data.path,
            changeType: 'modified',
            timestamp: Date.now(),
            backupPath: data.backupPath,
        });
    }

    // ===== 3. 添加到用户输入历史 =====
    const summary = toolCall.result.success
        ? JSON.stringify(toolCall.result.data)
        : toolCall.result.error;

    context.userInputHistory.push(
        `Tool ${toolCall.toolName} returned: ${summary}`
    );

    // ===== 4. 返回结果 =====
    return toolCall.result;
}
```

### 2.5 Reflect 阶段详解

```typescript
/**
 * Reflect 阶段 - 反思并决策下一步
 *
 * 输入：
 *   - task: 原始任务
 *   - thought: 之前的思考
 *   - observation: 观察结果
 *   - context: 执行上下文
 *
 * 输出：
 *   - string: 反思内容或最终响应
 */
async function reflect(
    task: string,
    thought: string,
    observation: ToolResult,
    context: ExecutionContext
): Promise<string> {
    // ===== 1. 构建反思提示词 =====
    const messages: LLMRequestMessage[] = [
        {
            role: 'system',
            content: `You are reflecting on the progress of a task.
Analyze the current state and determine if the task is complete or needs more work.

Respond with:
1. If the task is complete: Provide a final summary
2. If more work is needed: Briefly describe what to do next`,
        },
        {
            role: 'user',
            content: `Task: ${task}

My thought: ${thought}

Observation: ${observation.success ? JSON.stringify(observation.data) : observation.error}

Should I continue? If yes, what should I do next? If no, provide a final summary.`,
        },
    ];

    // ===== 2. 调用 LLM 获取反思 =====
    const response = await provider.generate(messages);

    return response?.choices[0].message.content || '';
}
```

**Reflect 阶段输出示例：**

```json
// 任务未完成时
{
  "content": "我已经了解了项目的基本结构，有42个文件。接下来需要分析这些文件的类型和用途。"
}

// 任务完成时
{
  "content": "任务已完成。项目结构分析：\n1. TypeScript 文件：15个\n2. 测试文件：8个\n3. 配置文件：5个\n\n已生成项目文档。"
}
```

---

## 3. 任务执行流程

### 3.1 任务生命周期

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         任务生命周期                                  │
│                                                                         │
│  ┌───────┐                                                            │
│  │ PENDING│ ← 任务创建，等待开始                                      │
│  └───┬───┘                                                            │
│      │                                                                │
│      │ dependencies satisfied?                                         │
│      │    ↓ No                                                        │
│      │  ┌─────────┐                                                   │
│      │  │ BLOCKED │ ← 等待依赖完成                                   │
│      │  └────┬────┘                                                   │
│      │       │ dependencies satisfied                                  │
│      │       ↓ Yes                                                    │
│      │       │                                                        │
│      └───────→│                                                        │
│               │                                                        │
│               ▼                                                        │
│  ┌───────┐                                                            │
│  │IN_PROGRESS│ ← 任务开始执行                                         │
│  └───┬───┘                                                            │
│      │                                                                │
│      ├───────────────┬───────────────┬──────────────┐                 │
│      │               │               │              │                 │
│      ▼               ▼               ▼              ▼                 │
│  ┌───────┐     ┌───────┐      ┌───────┐     ┌───────┐            │
│  │COMPLETED│    │FAILED  │      │CANCELLED│   │BLOCKED  │           │
│  └───────┘     └───────┘      └───────┘     └───────┘            │
│      │               │               │              │               │
│      │               │               │              │               │
│      ▼               ▼               ▼              │               │
│  记录结果        记录错误         取消后续任务     回到 IN_PROGRESS   │
│  更新状态        可能重试                         （依赖满足后）       │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 任务依赖管理

```typescript
/**
 * 任务依赖解析
 *
 * 示例任务结构：
 *
 * task-1 (main)
 *   ├── task-2 (scan directory) - no dependencies
 *   ├── task-3 (analyze files) - depends on: task-2
 *   ├── task-4 (generate docs) - depends on: task-3
 *   └── task-5 (write files) - depends on: task-4
 */

// ========== 依赖检查 ==========
function areDependenciesMet(taskId: string): boolean {
    const task = taskManager.getTask(taskId);
    if (!task || task.dependencies.length === 0) return true;

    return task.dependencies.every(depId => {
        const depTask = taskManager.getTask(depId);
        return depTask?.status === TaskStatus.COMPLETED;
    });
}

// ========== 获取下一个可执行任务 ==========
function getNextExecutableTask(): Task | null {
    // 更新阻塞状态
    updateBlockedStatus();

    // 查找第一个待处理的任务
    for (const task of taskManager.getAllTasks()) {
        if (task.status === TaskStatus.PENDING) {
            return task;
        }
    }
    return null;
}

// ========== 更新阻塞状态 ==========
function updateBlockedStatus(): void {
    for (const task of taskManager.getAllTasks()) {
        if (task.status === TaskStatus.PENDING) {
            if (!areDependenciesMet(task.id)) {
                task.status = TaskStatus.BLOCKED;
            }
        } else if (task.status === TaskStatus.BLOCKED) {
            if (areDependenciesMet(task.id)) {
                task.status = TaskStatus.PENDING;
            }
        }
    }
}
```

### 3.3 任务执行示例

```typescript
/**
 * 任务执行示例：分析项目结构并生成文档
 */

// ========== 任务计划 ==========
const plan = {
    mainTask: {
        id: 'task-1',
        description: '分析项目结构并生成文档',
        status: 'pending',
        dependencies: [],
    },
    subtasks: [
        {
            id: 'task-2',
            description: '扫描项目目录结构',
            status: 'pending',
            dependencies: [],
        },
        {
            id: 'task-3',
            description: '分析文件类型和数量',
            status: 'pending',
            dependencies: ['task-2'],
        },
        {
            id: 'task-4',
            description: '生成文档结构',
            status: 'pending',
            dependencies: ['task-3'],
        },
        {
            id: 'task-5',
            description: '编写文档内容',
            status: 'pending',
            dependencies: ['task-4'],
        },
    ],
    executionOrder: ['task-2', 'task-3', 'task-4', 'task-5'],
};

// ========== 执行过程 ==========
async function executeTasks(plan: TaskPlan) {
    for (const taskId of plan.executionOrder) {
        const task = plan.subtasks.find(t => t.id === taskId);

        // 检查依赖
        if (!areDependenciesMet(taskId)) {
            task.status = 'blocked';
            continue;
        }

        // 标记为进行中
        task.status = 'in_progress';
        task.startedAt = new Date();

        try {
            // 执行任务（通过 ReAct 循环）
            const result = await executeTaskWithReAct(task);

            // 标记为完成
            task.status = 'completed';
            task.completedAt = new Date();
            task.result = result;

        } catch (error) {
            // 标记为失败
            task.status = 'failed';
            task.error = error as Error;
        }
    }
}
```

---

## 4. 工具调用流程

### 4.1 工具调用完整流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       工具调用完整流程                                │
│                                                                         │
│  ReAct Engine                                                          │
│  ┌────────────────┐                                                    │
│  │ 1. 决定调用工具  │                                                   │
│  │    toolName    │                                                   │
│  │    params      │                                                   │
│  └────────┬───────┘                                                    │
│           │                                                             │
│           ▼                                                             │
│  ToolRegistry                                                          │
│  ┌────────────────┐                                                    │
│  │ 2. 检查工具存在  │                                                   │
│  │    has(tool)   │                                                   │
│  └────────┬───────┘                                                    │
│           │                                                             │
│           ▼ Yes                                                        │
│  ┌────────────────┐                                                    │
│  │ 3. 检查缓存     │                                                   │
│  │    cache.get() │                                                   │
│  └────────┬───────┘                                                    │
│           │                                                             │
│           ├────── Hit ──▶ 返回缓存结果                                 │
│           │                                                             │
│           ▼ Miss                                                       │
│  ┌────────────────┐                                                    │
│  │ 4. 权限检查     │                                                   │
│  │    permission   │                                                   │
│  └────────┬───────┘                                                    │
│           │                                                             │
│           ├──── SAFE ──▶ 直接执行                                      │
│           │                                                             │
│           ├──── MODERATE ──▶ 请求确认                                  │
│           │                                                             │
│           └──── DANGEROUS ──▶ 请求明确授权                             │
│                          │                                            │
│                          ├─ 批准 ──▶ 执行                            │
│                          │                                            │
│                          └─ 拒绝 ──▶ 返回取消                        │
│                                                                       │
│           ▼                                                            │
│  ┌────────────────┐                                                    │
│  │ 5. 参数验证     │                                                   │
│  │    validate()  │                                                   │
│  └────────┬───────┘                                                    │
│           │                                                             │
│           ├──── 验证失败 ──▶ 返回参数错误                              │
│           │                                                             │
│           ▼ 验证成功                                                    │
│  ┌────────────────┐                                                    │
│  │ 6. 执行工具     │                                                   │
│  │    execute()   │                                                   │
│  └────────┬───────┘                                                    │
│           │                                                             │
│           ▼                                                             │
│  ┌────────────────┐                                                    │
│  │ 7. 结果验证     │                                                   │
│  │    validate()  │                                                   │
│  └────────┬───────┘                                                    │
│           │                                                             │
│           ▼                                                             │
│  ┌────────────────┐                                                    │
│  │ 8. 缓存结果     │                                                   │
│  │    cache.set() │                                                   │
│  └────────┬───────┘                                                    │
│           │                                                             │
│           ▼                                                             │
│  ┌────────────────┐                                                    │
│  │ 9. 记录调用     │                                                   │
│  │    history.push│                                                   │
│  └────────┬───────┘                                                    │
│           │                                                             │
│           ▼                                                             │
│  ┌────────────────┐                                                    │
│  │ 10. 发送事件    │                                                   │
│  │     emit()     │                                                   │
│  └────────┬───────┘                                                    │
│           │                                                             │
│           ▼                                                             │
│     返回结果                                                           │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 工具执行示例

```typescript
/**
 * 示例：执行 list_directory 工具
 */

// ========== 输入 ==========
const toolName = 'list_directory';
const params = {
    path: '.',
    recursive: true,
    pattern: '*.ts'
};

// ========== 执行过程 ==========
async function executeListDirectory() {
    // 1. 检查工具存在
    const tool = toolRegistry.get('list_directory');
    if (!tool) {
        return { success: false, error: 'Tool not found' };
    }

    // 2. 检查缓存
    const cached = cache.get('list_directory', params);
    if (cached) return cached;

    // 3. 权限检查
    if (tool.permission !== 'safe') {
        const approved = await requestConfirmation({
            toolName: 'list_directory',
            permission: tool.permission,
        });
        if (!approved.approved) {
            return { success: false, error: 'Cancelled by user' };
        }
    }

    // 4. 参数验证
    const validatedParams = validateParams(tool.parameters, params);

    // 5. 执行工具
    const result = await tool.execute(validatedParams, context);

    // 6. 结果验证
    const validatedResult = validateResult(result);

    // 7. 缓存结果
    if (validatedResult.success) {
        cache.set('list_directory', params, validatedResult);
    }

    // 8. 记录调用
    callHistory.push({
        id: `call-${Date.now()}`,
        toolName: 'list_directory',
        parameters: params,
        result: validatedResult,
        startTime: Date.now() - 150,
        endTime: Date.now(),
        duration: 150,
        success: validatedResult.success,
    });

    return validatedResult;
}

// ========== 输出 ==========
{
    "success": true,
    "data": {
        "path": ".",
        "files": [
            { "path": "src/agent.ts", "isFile": true, "size": 1234 },
            { "path": "src/types.ts", "isFile": true, "size": 5678 },
            { "path": "src/index.ts", "isFile": true, "size": 3456 }
        ],
        "count": 3
    }
}
```

### 4.3 工具错误处理

```typescript
/**
 * 工具错误处理流程
 */
async function executeWithErrorHandling(
    toolName: string,
    params: unknown
): Promise<ToolResult> {
    try {
        // 执行工具
        return await toolRegistry.execute(toolName, params, context);

    } catch (error) {
        const err = error as Error;

        // 分类错误
        if (isRetryableError(err)) {
            // 可重试错误（网络、超时等）
            return {
                success: false,
                error: err.message,
                retryable: true,
            };
        }

        if (isPermissionError(err)) {
            // 权限错误
            return {
                success: false,
                error: `Permission denied: ${err.message}`,
                retryable: false,
            };
        }

        if (isValidationError(err)) {
            // 验证错误
            return {
                success: false,
                error: `Invalid parameters: ${err.message}`,
                retryable: false,
            };
        }

        // 其他错误
        return {
            success: false,
            error: err.message,
            retryable: false,
        };
    }
}

// 错误分类
function isRetryableError(error: Error): boolean {
    const retryablePatterns = [
        /timeout/i,
        /network/i,
        /connection/i,
        /ECONNRESET/i,
        /ETIMEDOUT/i,
    ];
    return retryablePatterns.some(pattern => pattern.test(error.message));
}
```

---

## 5. 错误处理流程

### 5.1 错误分类

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         错误分类体系                                  │
│                                                                         │
│  错误                                                                   │
│   │                                                                     │
│   ├── 可重试错误 (Retryable Errors)                                     │
│   │    ├── 网络超时 (Timeout)                                          │
│   │    ├── 连接重置 (Connection Reset)                                 │
│   │    ├── 速率限制 (Rate Limit)                                       │
│   │    └── 临时服务不可用 (Service Temporarily Unavailable)            │
│   │         │                                                          │
│   │         └─ 处理：自动重试（指数退避）                              │
│   │                                                                     │
│   ├── 可恢复错误 (Recoverable Errors)                                   │
│   │    ├── 参数错误 (Invalid Parameters) ── 处理：修正参数后重试       │
│   │    ├── 文件锁定 (File Locked) ── 处理：等待后重试                 │
│   │    └── 缺少依赖 (Missing Dependencies) ── 处理：安装依赖后重试    │
│   │                                                                     │
│   ├── 权限错误 (Permission Errors)                                     │
│   │    ├── 访问拒绝 (Access Denied) ── 处理：请求用户授权或更改路径   │
│   │    ├── 权限不足 (Insufficient Permissions) ── 处理：提升权限或更改 │
│   │    └── 路径限制 (Path Restriction) ── 处理：使用允许的路径        │
│   │                                                                     │
│   └── 永久错误 (Permanent Errors)                                      │
│        ├── 工具不存在 (Tool Not Found) ── 处理：终止执行，报告错误     │
│        ├── 资源不足 (Out of Resources) ── 处理：终止执行，释放资源     │
│        └── 致命错误 (Fatal Error) ── 处理：终止执行，记录日志         │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.2 错误恢复策略

```typescript
/**
 * 错误恢复策略
 */
interface ErrorRecoveryStrategy {
    // 重试策略
    retry?: {
        maxAttempts: number;
        backoffMs: number;
        exponentialBackoff: boolean;
    };

    // 降级策略
    fallback?: {
        alternativeTool?: string;
        alternativeAction?: () => Promise<ToolResult>;
    };

    // 用户干预
    userIntervention?: {
        required: boolean;
        prompt: string;
        timeout?: number;
    };

    // 终止策略
    terminate?: {
        shouldTerminate: boolean;
        reason: string;
    };
}

// 错误处理示例
async function handleToolError(
    error: Error,
    toolName: string,
    params: unknown
): Promise<ToolResult> {
    // 1. 分类错误
    if (isRetryableError(error)) {
        // 重试策略
        const strategy: ErrorRecoveryStrategy = {
            retry: {
                maxAttempts: 3,
                backoffMs: 1000,
                exponentialBackoff: true,
            },
        };

        return await retryWithBackoff(toolName, params, strategy);
    }

    if (isRecoverableError(error)) {
        // 降级策略
        const strategy: ErrorRecoveryStrategy = {
            fallback: {
                alternativeTool: getAlternativeTool(toolName),
            },
        };

        return await tryFallback(toolName, params, strategy);
    }

    if (isPermissionError(error)) {
        // 用户干预
        const strategy: ErrorRecoveryStrategy = {
            userIntervention: {
                required: true,
                prompt: `需要权限执行 ${toolName}: ${error.message}`,
                timeout: 30000,
            },
        };

        return await requestUserIntervention(strategy);
    }

    // 永久错误，终止
    return {
        success: false,
        error: `无法恢复的错误: ${error.message}`,
        retryable: false,
    };
}
```

### 5.3 重试机制

```typescript
/**
 * 带退避的重试机制
 */
async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    options: {
        maxAttempts: number;
        initialDelay: number;
        maxDelay: number;
        exponential: boolean;
    }
): Promise<T> {
    let lastError: Error;
    let delay = options.initialDelay;

    for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error as Error;

            // 最后一次尝试失败，不再等待
            if (attempt === options.maxAttempts - 1) {
                break;
            }

            // 计算退避时间
            const backoffDelay = Math.min(delay, options.maxDelay);

            console.log(`Attempt ${attempt + 1} failed, retrying in ${backoffDelay}ms...`);

            // 等待
            await new Promise(resolve => setTimeout(resolve, backoffDelay));

            // 指数退避
            if (options.exponential) {
                delay *= 2;
            }
        }
    }

    throw lastError!;
}

// 使用示例
const result = await retryWithBackoff(
    () => toolRegistry.execute(toolName, params, context),
    {
        maxAttempts: 3,
        initialDelay: 1000,
        maxDelay: 10000,
        exponential: true,
    }
);
```

---

## 6. 状态转换流程

### 6.1 Agent 状态转换

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Agent 状态转换图                                  │
│                                                                         │
│     ┌───────┐                                                          │
│     │  IDLE  │ ← 初始状态                                             │
│     └───┬───┘                                                          │
│         │ execute()                                                   │
│         ▼                                                              │
│     ┌───────┐                                                          │
│     │PLANNING│ ← 规划中                                               │
│     └───┬───┘                                                          │
│         │ plan created                                                │
│         ▼                                                              │
│     ┌───────┐                                                          │
│     │ RUNNING│ ← 执行中                                              │
│     └───┬───┘                                                          │
│         │                                                            │
│         ├─── 完成 ──▶ ┌───────┐                                       │
│         │             │COMPLETED│ ← 成功完成                           │
│         │             └───────┘                                       │
│         │                                                            │
│         ├─── 失败 ──▶ ┌───────┐                                       │
│         │             │ FAILED  │ ← 执行失败                           │
│         │             └───────┘                                       │
│         │                                                            │
│         ├─── 中止 ──▶ ┌───────┐                                       │
│         │             │ABORTED │ ← 用户中止                           │
│         │             └───────┘                                       │
│         │                                                            │
│         └─── 等待用户 ──▶ ┌───────┐                                    │
│                       │WAITING │ ← 等待确认                           │
│                       └───────┘                                    │
│                           │ 用户响应                                │
│                           ├─ 批准 ──▶ RUNNING                       │
│                           └─ 拒绝 ──▶ ABORTED                       │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.2 状态转换方法

```typescript
/**
 * 状态转换管理
 */
class AgentStateManager {
    private currentState: AgentStatus = AgentStatus.IDLE;
    private stateHistory: Array<{ status: AgentStatus; timestamp: number }> = [];

    /**
     * 转换状态
     */
    transitionTo(newState: AgentStatus, reason?: string): void {
        const allowedTransitions: Record<AgentStatus, AgentStatus[]> = {
            [AgentStatus.IDLE]: [AgentStatus.PLANNING],
            [AgentStatus.PLANNING]: [AgentStatus.RUNNING, AgentStatus.FAILED],
            [AgentStatus.RUNNING]: [
                AgentStatus.COMPLETED,
                AgentStatus.FAILED,
                AgentStatus.ABORTED,
                AgentStatus.WAITING,
            ],
            [AgentStatus.WAITING]: [
                AgentStatus.RUNNING,
                AgentStatus.ABORTED,
            ],
            [AgentStatus.COMPLETED]: [AgentStatus.IDLE],
            [AgentStatus.FAILED]: [AgentStatus.IDLE],
            [AgentStatus.ABORTED]: [AgentStatus.IDLE],
        };

        const allowed = allowedTransitions[this.currentState];
        if (!allowed.includes(newState)) {
            throw new Error(
                `Invalid state transition: ${this.currentState} -> ${newState}`
            );
        }

        // 记录状态历史
        this.stateHistory.push({
            status: this.currentState,
            timestamp: Date.now(),
        });

        // 执行转换
        console.log(`[State] ${this.currentState} -> ${newState}${reason ? ` (${reason})` : ''}`);
        this.currentState = newState;

        // 触发事件
        this.emit('status_changed', { status: newState });
    }

    /**
     * 检查是否可以转换
     */
    canTransitionTo(newState: AgentStatus): boolean {
        const allowed = {
            [AgentStatus.IDLE]: [AgentStatus.PLANNING],
            [AgentStatus.PLANNING]: [AgentStatus.RUNNING, AgentStatus.FAILED],
            [AgentStatus.RUNNING]: [
                AgentStatus.COMPLETED,
                AgentStatus.FAILED,
                AgentStatus.ABORTED,
                AgentStatus.WAITING,
            ],
            [AgentStatus.WAITING]: [
                AgentStatus.RUNNING,
                AgentStatus.ABORTED,
            ],
            [AgentStatus.COMPLETED]: [AgentStatus.IDLE],
            [AgentStatus.FAILED]: [AgentStatus.IDLE],
            [AgentStatus.ABORTED]: [AgentStatus.IDLE],
        }[this.currentState];

        return allowed?.includes(newState) ?? false;
    }
}
```

---

## 7. 数据流转详解

### 7.1 上下文数据流

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        上下文数据流                                    │
│                                                                         │
│  ExecutionContext                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  userInputHistory: string[]                                      │   │
│  │    ├── "分析项目结构"                           (用户输入)      │   │
│  │    ├── "Tool list_directory returned: ..."  (工具结果)       │   │
│  │    └── "根据分析结果..."                       (LLM响应)      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                        │
│                              ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  toolCallHistory: ToolCallRecord[]                              │   │
│  │    ├── { id: "call-1", toolName: "list_directory", ... }        │   │
│  │    ├── { id: "call-2", toolName: "read_file", ... }             │   │
│  │    └── { id: "call-3", toolName: "search_files", ... }          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                        │
│                              ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  fileChangeHistory: FileChangeRecord[]                          │   │
│  │    ├── { path: "README.md", changeType: "modified" }            │   │
│  │    ├── { path: "src/docs/api.md", changeType: "created" }        │   │
│  │    └── { path: "old.ts", changeType: "deleted" }                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                        │
│                              ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  thoughts: Thought[]                                             │   │
│  │    ├── { content: "需要先了解项目结构", timestamp: ... }          │   │
│  │    ├── { content: "文件分析完成", timestamp: ... }               │   │
│  │    └── { content: "可以生成文档了", timestamp: ... }             │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                        │
│                              ▼                                        │
│                    MemoryManager.buildSystemPrompt()                │
│                              │                                        │
│                              ▼                                        │
│                    传递给 LLM 的系统提示词                            │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### 7.2 LLM 消息流

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        LLM 消息流                                      │
│                                                                         │
│  循环 1:                                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  [system] 系统提示词                                               │   │
│  │           包含：工具列表、工作目录、当前任务等                       │   │
│  │                                                                 │   │
│  │  [user] 任务描述                                                  │   │
│  │        "分析项目结构并生成文档"                                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                        │
│                              ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  LLM 响应: [assistant]                                           │   │
│  │    content: "我需要先了解项目结构..."                            │   │
│  │    tool_calls: [{                                               │   │
│  │      name: "list_directory",                                     │   │
│  │      arguments: '{"path": ".", "recursive": true}'               │   │
│  │    }]                                                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                        │
│                              ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  工具执行: list_directory                                       │   │
│  │  结果: { files: [...], count: 42 }                              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                        │
│                              ▼                                        │
│  循环 2:                                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  [system] 系统提示词 + 上次观察结果                              │   │
│  │                                                                 │   │
│  │  [user] 任务描述                                                │   │
│  │  [assistant] 我需要先了解项目结构                                │   │
│  │  [user] Tool list_directory returned: {...}                      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                        │
│                              ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  LLM 响应: [assistant]                                           │   │
│  │    content: "已获取文件列表，接下来分析文件类型..."               │   │
│  │    tool_calls: [{                                               │   │
│  │      name: "search_code",                                       │   │
│  │      arguments: '{"pattern": "export.*class"}'                   │   │
│  │    }]                                                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                        │
│                              ▼                                        │
│  ... 继续循环直到任务完成 ...                                         │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 8. 时序图

### 8.1 完整执行时序图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         完整执行时序图                                  │
│                                                                         │
│  User      Agent       Planner      ReActEngine    ToolRegistry    Tool  │
│   │          │            │              │              │           │    │
│   │  execute(task)          │              │              │           │    │
│   │──────────────────────▶│              │              │           │    │
│   │          │            │              │              │           │    │
│   │          │    createPlan()            │              │           │    │
│   │          │───────────────────▶│              │           │    │
│   │          │            │              │              │           │    │
│   │          │            │   TaskPlan    │              │           │    │
│   │          │            │◀──────────────│              │           │    │
│   │          │            │              │              │           │    │
│   │          │            │              │  execute()   │           │    │
│   │          │            │              │──────────────────────▶│    │
│   │          │            │              │              │           │    │
│   │          │            │              │              │  execute()│    │
│   │          │            │              │              │──────────▶│    │
│   │          │            │              │              │           │    │
│   │          │            │              │              │    ToolResult│
│   │          │            │              │              │◀──────────│    │
│   │          │            │              │              │           │    │
│   │          │            │              │   ToolResult  │           │    │
│   │          │            │              │◀──────────────│           │    │
│   │          │            │              │              │           │    │
│   │          │            │              │  reflect()    │           │    │
│   │          │            │              │──────┐       │           │    │
│   │          │            │              │      │       │           │    │
│   │          │            │              │      ▼       │           │    │
│   │          │            │              │  继续循环?    │           │    │
│   │          │            │              │      │       │           │    │
│   │          │            │              │      ├Yes──┐  │           │    │
│   │          │            │              │      │      │           │    │
│   │          │            │              │      └─────┼───────────▶│    │
│   │          │            │              │              │  execute()│    │
│   │          │            │              │              │──────────▶│    │
│   │          │            │              │      ┌──No┐  │           │    │
│   │          │            │              │      │    │  │           │    │
│   │          │            │              │      ▼    │  │           │    │
│   │          │            │              │  生成最终响应 │           │    │
│   │          │            │              │      │       │           │    │
│   │          │            │              │      └───────┼───────────▶│    │
│   │          │            │              │              │           │    │
│   │          │            │              │              │           │    │
│   │          │            │              │   AgentResult  │           │    │
│   │          │            │              │◀──────────────│           │    │
│   │          │            │              │              │           │    │
│   │  AgentResult         │              │              │           │    │
│   │◀─────────────────────│              │              │           │    │
│   │          │            │              │              │           │    │
│   │          │            │              │              │           │    │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8.2 工具调用时序图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       工具调用详细时序                                 │
│                                                                         │
│  ReActEngine  Registry  Executor  Tool  Permission  Cache  Backup       │
│      │           │         │        │       │        │       │        │
│      │ execute(name, params)          │       │        │       │        │
│      │────────────────────▶│         │        │       │        │       │
│      │           │         │         │        │       │        │       │
│      │           │  get(name)        │        │       │        │       │
│      │           │─▶         │         │        │       │        │       │
│      │           │  ◀─────────│       │        │       │        │       │
│      │           │   ToolDefinition      │       │        │       │        │
│      │           │         │         │        │       │        │       │
│      │           │         │  validate()│        │       │        │       │
│      │           │──────────────────────▶│        │       │        │       │
│      │           │         │◀────────────────│        │       │        │       │
│      │           │         │         │        │       │        │       │
│      │           │         │         │        │  check(params)│       │
│      │           │──────────────────────────────────────▶│       │        │
│      │           │         │         │        │       │        │       │
│      │           │         │         │        │   approved?     │       │
│      │           │         │         │        │◀──────────────│       │
│      │           │         │         │        │       │        │       │
│      │           │         │         │        │       │   approved?      │
│      │           │──────────────────────────────────────▶│       │
│      │           │         │         │        │       │        │       │
│      │           │         │         │        │       │  get(name,params)│
│      │           │──────────────────────────────────────────────▶│
│      │           │         │         │        │       │        │       │
│      │           │         │         │        │       │  cached result?  │
│      │           │         │         │        │       │◀──────────│
│      │           │         │         │        │       │        │       │
│      │           │         │         │        │       │        │       │
│      │           │         │         │  createBackup()?    │       │       │
│      │           │──────────────────────────────▶│        │       │
│      │           │         │         │        │       │        │       │
│      │           │         │         │        │  backupPath        │       │
│      │           │         │         │        │◀───────│        │       │
│      │           │         │         │        │       │        │       │
│      │           │         │  execute()│        │       │        │       │
│      │           │─────────▶│         │        │       │        │       │
│      │           │         │         │        │       │        │       │
│      │           │         │  tool result      │       │        │       │
│      │           │         │◀────────│        │       │        │       │
│      │           │         │         │        │       │        │       │
│      │           │         │         │        │       │  set(name, params, result)│
│      │           │──────────────────────────────────────────────▶│
│      │           │         │         │        │       │        │       │
│      │           │  ToolResult         │        │       │        │       │
│      │           │◀────────│         │        │       │        │       │
│      │           │         │         │        │       │        │       │
│      │  ToolResult          │        │       │        │       │        │
│      │◀────────────────────│        │       │        │       │        │
│      │                      │        │       │        │       │        │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 附录

### A. 流程图例说明

| 符号 | 含义 |
|-----|------|
| `▶` | 数据流向/调用 |
| `○─` | 可选路径 |
| `├─` | 分支选择 |
| `└─` | 汇聚 |
| `←` | 返回 |

### B. 相关文档

- [产品文档](./PRODUCT.md)
- [技术方案](./ARCHITECTURE.md)
- [技术实现](./IMPLEMENTATION.md)

---

**文档版本：** v1.0.0
**最后更新：** 2026-01-31
**维护团队：** Agent-V4 开发组
