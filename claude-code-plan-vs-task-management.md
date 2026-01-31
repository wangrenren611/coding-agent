# Plan vs Task 管理工具 - 深度解析

> 文档生成时间：2026-01-31
> 适用版本：Claude Code (glm-4.7)

---

## 目录
 
1. [核心概念区别](#一核心概念区别)
2. [Plan 代理详解](#二-plan-代理详解)
3. [TaskCreate 详解](#三-taskcreate-详解)
4. [TaskGet 详解](#四-taskget-详解)
5. [TaskList 详解](#五-tasklist-详解)
6. [TaskUpdate 详解](#六-taskupdate-详解)
7. [TaskOutput 详解](#七-taskoutput-详解)
8. [对比决策表](#八对比决策表)
9. [完整工具提示词](#九完整工具提示词)
10. [实战场景](#十实战场景)

---

## 一、核心概念区别

### 1.1 两类工具的本质区别

```
┌─────────────────────────────────────────────────────────────────┐
│                     两类工具的本质区别                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────┐      ┌─────────────────────────────┐  │
│  │   Plan (通过Task)    │      │  TaskCreate/Update/等       │  │
│  │                     │      │                             │  │
│  │  ┌───────────────┐  │      │  ┌───────────────┐          │  │
│  │  │  子代理系统   │  │      │  │  任务管理系统 │          │  │
│  │  │              │  │      │  │              │          │  │
│  │  │ 启动独立代理 │  │      │  │ 创建待办事项 │          │  │
│  │  │              │  │      │  │              │          │  │
│  │  │ 代理返回结果 │  │      │  │ 跟踪任务状态 │          │  │
│  │  └───────────────┘  │      │  └───────────────┘          │  │
│  └─────────────────────┘      └─────────────────────────────┘  │
│           │                             │                     │
│           ▼                             ▼                     │
│  ┌─────────────────────┐      ┌─────────────────────────────┐  │
│  │   用于:             │      │   用于:                     │  │
│  │   - 设计实现方案    │      │   - 跟踪当前会话任务        │  │
│  │   - 架构决策        │      │   - 组织复杂工作流程        │  │
│  │   - 代码库分析      │      │   - 展示进度给用户          │  │
│  └─────────────────────┘      └─────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 快速对比表

| 维度 | Plan (Task工具) | TaskCreate/Update/等 |
|------|-----------------|---------------------|
| **本质** | 启动**子代理** | **任务列表**管理 |
| **执行者** | 独立的 Plan 代理 | Claude Code 主对话 |
| **用途** | 设计实现方案 | 跟踪当前会话的工作进度 |
| **输出** | 代理返回的设计方案 | 任务状态、进度追踪 |
| **持久性** | 代理完成后结束 | 任务列表持续存在 |
| **用户可见** | 结果返回给我展示 | 用户可见任务列表 |
| **工具归属** | 属于 Task 工具 | 属于任务管理系统 |

### 1.3 类比说明

```
Plan (子代理)：
就像雇佣一位"建筑设计师"
→ 你告诉需求
→ 设计师设计方案
→ 设计师返回蓝图
→ 关系结束

TaskCreate (任务管理)：
就像使用"待办事项清单"
→ 创建任务卡片
→ 标记进行中
→ 完成后勾选
→ 持续跟踪进度
```

---

## 二、Plan 代理详解

### 2.1 系统提示词

```
Plan: Software architect agent for designing implementation plans.
Use this when you need to plan the implementation strategy for a task.
Returns step-by-step plans, identifies critical files, and considers architectural trade-offs.

Tools: All tools except Task, ExitPlanMode, Edit, Write, NotebookEdit
```

### 2.2 调用方式

```javascript
Task(
  subagent_type: "Plan",
  prompt: "详细的任务描述和上下文",
  description: "简短描述(3-5词)",
  model?: "sonnet" | "opus" | "haiku"
)
```

### 2.3 什么时候使用 Plan

| 场景 | 示例 |
|------|------|
| 需要架构设计方案 | "设计一个微服务架构的用户认证系统" |
| 多种实现方案选择 | "选择合适的数据库方案" |
| 复杂重构规划 | "重构旧项目的模块依赖关系" |
| 技术栈选型 | "选择前端状态管理方案" |

### 2.4 Plan 不做的事情

| 不做 | 原因 |
|------|------|
| 不直接编写代码 | Plan 代理没有 Edit/Write 权限 |
| 不修改 ExitPlanMode | 不能退出计划模式（这是主对话的功能） |
| 不执行实现 | 只设计，不实现 |

### 2.5 Plan 输出示例

```
Plan 代理返回：

实现方案：用户认证系统

1. 架构选择
   - 使用 JWT Token 进行无状态认证
   - Token 存储在 HttpOnly Cookie
   - Refresh Token 存储在 Redis

2. 关键文件
   - src/auth/jwt.service.ts
   - src/auth/auth.controller.ts
   - src/middleware/auth.middleware.ts

3. 实现步骤
   - 步骤1: 实现 JWT 签发和验证
   - 步骤2: 创建登录/注册端点
   - 步骤3: 实现认证中间件
   - 步骤4: 添加 Token 刷新机制

4. 架构权衡
   - JWT vs Session: 选择 JWT 以支持水平扩展
   - 存储方案: Redis 用于 Token 黑名单
```

### 2.6 与 EnterPlanMode 的区别

| 特性 | EnterPlanMode | Task("Plan") |
|------|---------------|--------------|
| 执行者 | 主对话（我） | 独立子代理 |
| 用户交互 | 我用 ExitPlanMode 提交计划给你审批 | 代理完成后返回结果 |
| 使用频率 | **主要方式** | 较少使用 |

---

## 三、TaskCreate 详解

### 3.1 系统提示词

```
Use this tool proactively to create a structured task list for your current coding session.
This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.

## When to Use This Tool

Use this tool proactively in these scenarios:
- Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
- Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
- Plan mode - When using plan mode, create a task list to track the work
- User explicitly requests todo list - When the user directly asks you to use the todo list
- User provides multiple tasks - When users provide multiple tasks (numbered or comma-separated)
- After receiving new instructions - Immediately capture user requirements as tasks

## When NOT to Use This Tool

Skip using this tool when:
- There is only a single, straightforward task
- The task is trivial and tracking provides no organizational benefit
- The task can be completed in less than 3 trivial steps
- The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do.
```

### 3.2 调用参数

```javascript
TaskCreate(
  subject: string,      // 必需：简短标题，祈使句
  description: string,  // 必需：详细描述
  activeForm: string,   // 必需：现在进行时，显示在加载器
  metadata?: object     // 可选：元数据
)
```

### 3.3 参数详解

#### subject（任务标题）
```
格式：祈使句，简短有力
示例：
✓ "Fix authentication bug"
✓ "Run tests"
✓ "Implement user profile"

✗ "Fixing authentication bug" (不是祈使句)
✗ "The authentication bug" (不完整)
```

#### activeForm（进行时）
```
格式：现在进行时，与 subject 对应
示例：
subject: "Fix authentication bug"
activeForm: "Fixing authentication bug"

显示效果：
[⏳ Fixing authentication bug...]  ← 用户看到这个
```

#### description（详细描述）
```
格式：详细的任务描述
内容：
- 任务的具体要求
- 接受标准
- 上下文信息

示例：
"修复用户登录失败的问题。检查 JWT 验证逻辑，
确保 Token 正确解析和验证。修复后运行相关测试。"
```

### 3.4 使用流程

```
用户请求
    ↓
判断是否需要任务列表
    ↓
TaskCreate(创建任务，status=pending)
    ↓
开始工作前 TaskUpdate(status=in_progress)
    ↓
工作中...
    ↓
完成后 TaskUpdate(status=completed)
    ↓
TaskList 查看下一个任务
```

### 3.5 输出示例

```
调用：
TaskCreate(
  subject: "Implement user login",
  description: "Create login endpoint with JWT authentication",
  activeForm: "Implementing user login"
)

输出：
Task '1' created successfully.

任务列表：
┌───┬─────────────────────┬──────────┬────────┬──────────┐
│ ID │ Subject             │ Status   │ Owner  │ Blocked  │
├───┼─────────────────────┼──────────┼────────┼──────────┤
│ 1 │ Implement user login │ pending  │        │          │
└───┴─────────────────────┴──────────┴────────┴──────────┘
```

---

## 四、TaskGet 详解

### 4.1 系统提示词

```
Use this tool to retrieve a task by its ID from the task list.

## When to Use This Tool

- When you need the full description and context before starting work on a task
- To understand task dependencies (what it blocks, what blocks it)
- After being assigned a task, to get complete requirements

## Output

Returns full task details:
- subject: Task title
- description: Detailed requirements and context
- status: 'pending', 'in_progress', or 'completed'
- blocks: Tasks waiting on this one to complete
- blockedBy: Tasks that must complete before this one can start
```

### 4.2 调用参数

```javascript
TaskGet(
  taskId: string  // 必需：任务ID
)
```

### 4.3 什么时候使用

| 场景 | 说明 |
|------|------|
| 开始工作前 | 获取完整的任务描述和上下文 |
| 检查依赖 | 查看 blockedBy 列表，确认前置任务已完成 |
| 被分配任务后 | 获取完整的任务要求 |

### 4.4 输出示例

```
调用：
TaskGet(taskId: "1")

输出：
╔═══════════════════════════════════════════════════════════════╗
║ Task Details: #1                                               ║
╠═══════════════════════════════════════════════════════════════╣
║ Subject:                                                       ║
║   Implement user login                                         ║
║                                                               ║
║ Description:                                                   ║
║   Create login endpoint with JWT authentication.              ║
║   - Validate email/password                                   ║
║   - Generate JWT token                                         ║
║   - Return token in response                                   ║
║                                                               ║
║ Status:                                                        ║
║   pending                                                      ║
║                                                               ║
║ Owner:                                                         ║
║   (unassigned)                                                 ║
║                                                               ║
║ Dependencies:                                                  ║
║   blockedBy: []                                               ║
║   blocks: [2, 3]                                              ║
╚═══════════════════════════════════════════════════════════════╝
```

---

## 五、TaskList 详解

### 5.1 系统提示词

```
Use this tool to list all tasks in the task list.

## When to Use This Tool

- To see what tasks are available to work on (status: 'pending', no owner, not blocked)
- To check overall progress on the project
- To find tasks that are blocked and need dependencies resolved
- After completing a task, to check for newly unblocked work or claim the next available task

**Prefer working on tasks in ID order** (lowest ID first) when multiple tasks are available,
as earlier tasks often set up context for later ones.

## Output

Returns a summary of each task:
- id: Task identifier (use with TaskGet, TaskUpdate)
- subject: Brief description of the task
- status: 'pending', 'in_progress', or 'completed'
- owner: Agent ID if assigned, empty if available
- blockedBy: List of open task IDs that must be resolved first
```

### 5.2 调用参数

```javascript
TaskList()  // 无参数
```

### 5.3 什么时候使用

| 场景 | 说明 |
|------|------|
| 开始工作前 | 查看有哪些可用任务 |
| 完成任务后 | 查找下一个可执行的任务 |
| 检查进度 | 查看整体项目进度 |
| 查找阻塞任务 | 找出需要解决依赖的任务 |

### 5.4 输出示例

```
调用：
TaskList()

输出：
╔═══════════════════════════════════════════════════════════════╗
║ Task List                                                      ║
╠═══════════════════════════════════════════════════════════════╣
║ ┌───┬───────────────────┬──────────┬────────┬──────────────┐ ║
║ │ ID │ Subject          │ Status   │ Owner  │ Blocked By  │ ║
║ ├───┼───────────────────┼──────────┼────────┼──────────────┤ ║
║ │ 1 │ Setup database    │ completed│ claude │              │ ║
║ │ 2 │ Create API models │ in_progress│ claude│ [1]          │ ║
║ │ 3 │ Implement auth    │ pending  │        │ [1, 2]       │ ║
║ │ 4 │ Write tests       │ pending  │        │ [2, 3]       │ ║
║ └───┴───────────────────┴──────────┴────────┴──────────────┘ ║
║                                                               ║
║ Legend:                                                       ║
║ 🟢 pending (available)                                        ║
║ 🟡 in_progress                                                ║
║ 🔴 blocked (waiting on dependencies)                          ║
╚═══════════════════════════════════════════════════════════════╝
```

### 5.5 任务选择策略

```
TaskList 输出解读：

可用任务（立即开始）:
- status = pending
- owner = 空
- blockedBy = 空

按 ID 顺序选择：
→ 最早的任务通常为后续任务建立上下文

示例：
┌───┬───────────────┬──────────┬────────┬──────────┐
│ ID │ Subject      │ Status   │ Owner  │BlockedBy │
├───┼───────────────┼──────────┼────────┼──────────┤
│ 1 │ Setup DB      │ completed│ claude │          │ ← 完成
│ 2 │ Create models │ pending  │        │ [1]      │ ← 可执行
│ 3 │ Implement auth│ pending  │        │ [1,2]    │ ← 被2阻塞
└───┴───────────────┴──────────┴────────┴──────────┘

下一个任务：#2 (ID最小，无阻塞)
```

---

## 六、TaskUpdate 详解

### 6.1 系统提示词

```
Use this tool to update a task in the task list.

## When to Use This Tool

**Mark tasks as resolved:**
- When you have completed the work described in a task
- When a task is no longer needed or has been superseded
- IMPORTANT: Always mark your assigned tasks as resolved when you finish them

**Delete tasks:**
- When a task is no longer relevant or was created in error
- Setting status to `deleted` permanently removes the task

**Update task details:**
- When requirements change or become clearer
- When establishing dependencies between tasks

## Fields You Can Update

- status: 'pending' | 'in_progress' | 'completed' | 'deleted'
- subject: Change the task title (imperative form)
- description: Change the task description
- activeForm: Present continuous form for spinner
- owner: Change the task owner (agent name)
- metadata: Merge metadata keys (set to null to delete)
- addBlocks: Mark tasks that cannot start until this one completes
- addBlockedBy: Mark tasks that must complete before this one
```

### 6.2 调用参数

```javascript
TaskUpdate(
  taskId: string,              // 必需：任务ID
  status?: 'pending' | 'in_progress' | 'completed' | 'deleted',
  subject?: string,
  description?: string,
  activeForm?: string,
  owner?: string,
  metadata?: object,
  addBlocks?: string[],        // 此任务阻塞的其他任务ID
  addBlockedBy?: string[]      // 阻塞此任务的其他任务ID
)
```

### 6.3 状态流转

```
                    ┌─────────────────┐
                    │    pending      │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   in_progress   │  ← 开始工作时
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
      ┌───────────────┐             ┌──────────────┐
      │   completed   │             │   deleted    │
      └───────────────┘             └──────────────┘
       (任务完成)                     (任务作废)
```

### 6.4 使用场景

| 场景 | 操作 |
|------|------|
| 开始任务 | `TaskUpdate(taskId, status: "in_progress")` |
| 完成任务 | `TaskUpdate(taskId, status: "completed")` |
| 删除任务 | `TaskUpdate(taskId, status: "deleted")` |
| 设置依赖 | `TaskUpdate(taskId, addBlockedBy: ["1"])` |
| 指派所有者 | `TaskUpdate(taskId, owner: "my-name")` |

### 6.5 输出示例

```
调用：
TaskUpdate(taskId: "1", status: "in_progress")

输出：
Task '1' updated successfully.

╔═══════════════════════════════════════════════════════════════╗
║ Task Updated: #1                                              ║
╠═══════════════════════════════════════════════════════════════╣
║ Status: pending → in_progress                                 ║
║                                                               ║
║ ┌───┬───────────────────┬──────────┬────────┬──────────────┐ ║
║ │ ID │ Subject          │ Status   │ Owner  │ Blocked By  │ ║
║ ├───┼───────────────────┼──────────┼────────┼──────────────┤ ║
║ │ 1 │ Implement login   │ 🔄 in_progress │ claude │          │ ║
║ └───┴───────────────────┴──────────┴────────┴──────────────┘ ║
╚═══════════════════════════════════════════════════════════════╝
```

### 6.6 完成任务规则

```
✅ 可以标记为 completed 的情况：
- 任务已完全完成
- 测试通过
- 实现完整

❌ 不可标记为 completed 的情况：
- 测试失败
- 实现部分完成
- 有未解决的错误
- 找不到所需文件
- 遇到阻塞但未创建新任务

⚠️ 遇到阻塞时的处理：
→ 保持 in_progress
→ 创建新任务描述阻塞问题
→ 设置依赖关系 (addBlockedBy)
```

---

## 七、TaskOutput 详解

### 7.1 系统提示词

```
- Retrieves output from a running or completed task (background shell, agent, or remote session)
- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs can be found using the /tasks command
- Works with all task types: background shells, async agents, and remote sessions
```

### 7.2 调用参数

```javascript
TaskOutput(
  task_id: string,      // 必需：任务ID
  block: boolean,       // 可选：默认true，是否等待完成
  timeout: number       // 可选：默认30000ms，超时时间
)
```

### 7.3 什么时候使用

| 场景 | 说明 |
|------|------|
| 后台任务 | 获取后台运行的 shell 或代理的输出 |
| 检查状态 | 非阻塞方式检查任务进度 |
| 获取结果 | 等待任务完成并获取完整输出 |

### 7.4 与 TaskGet 的区别

| 工具 | 用途 | 操作对象 |
|------|------|----------|
| **TaskGet** | 获取任务详情（描述、状态、依赖） | 任务列表中的待办任务 |
| **TaskOutput** | 获取任务执行输出 | 后台运行的 shell/代理 |

### 7.5 输出示例

```
调用：
TaskOutput(task_id: "agent_abc123", block: true)

输出：
╔═══════════════════════════════════════════════════════════════╗
║ Task Output: agent_abc123                                      ║
╠═══════════════════════════════════════════════════════════════╣
║ Status: completed                                              ║
║ Duration: 45.2s                                               ║
║                                                               ║
║ Output:                                                       ║
║ ────────────────────────────────────────────────────────────  ║
║ Exploring codebase...                                         ║
║                                                               ║
║ Found 15 authentication-related files:                        ║
║   - src/auth/jwt.service.ts                                   ║
║   - src/auth/login.controller.ts                              ║
║   - src/middleware/auth.middleware.ts                         ║
║   ...                                                         ║
║                                                               ║
║ Architecture analysis:                                        ║
║   The authentication system uses JWT tokens stored in         ║
║   HttpOnly cookies with Redis-backed refresh tokens.          ║
║                                                               ║
║ Recommendations:                                              ║
║   1. Add rate limiting to login endpoint                      ║
║   2. Implement token rotation policy                          ║
║ ────────────────────────────────────────────────────────────  ║
╚═══════════════════════════════════════════════════════════════╝
```

---

## 八、对比决策表

### 8.1 什么时候用 Plan vs TaskCreate

| 场景 | 使用工具 | 原因 |
|------|----------|------|
| 需要设计方案架构 | `Task("Plan")` | 让专业代理设计 |
| 多步骤工作需要跟踪 | `TaskCreate` | 跟踪当前会话进度 |
| 用户询问架构方案 | `Task("Plan")` | 获取设计方案 |
| 开始复杂实现任务 | `TaskCreate` | 组织和展示进度 |
| 技术选型决策 | `Task("Plan")` | 考虑架构权衡 |

### 8.2 决策流程图

```
┌─────────────────────────────────────────────────────────────┐
│                      用户请求                                │
└──────────────────────────┬──────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
      ┌───────────────┐         ┌───────────────┐
      │  需要设计方案? │         │  需要跟踪进度? │
      └───────┬───────┘         └───────┬───────┘
              │                         │
        ┌─────┴─────┐             ┌─────┴─────┐
        │           │             │           │
       YES         NO            YES         NO
        │           │             │           │
        ▼           ▼             ▼           ▼
┌───────────────┐ ┌─────┐ ┌───────────────┐ ┌─────┐
│Task("Plan")   │ │直接 │ │ TaskCreate    │ │直接 │
│或EnterPlanMode│ │执行 │ │ + TaskUpdate  │ │执行 │
└───────────────┘ └─────┘ └───────────────┘ └─────┘
```

### 8.3 完整工作流对比

```
┌─────────────────────────────────────────────────────────────────┐
│                    Plan 代理工作流                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  用户: "设计一个用户认证系统"                                    │
│      ↓                                                         │
│  Task("Plan", "设计用户认证系统架构...")                        │
│      ↓                                                         │
│  Plan 代理 (独立进程):                                          │
│    - 分析需求                                                   │
│    - 考虑技术方案                                               │
│    - 评估架构权衡                                               │
│    - 设计实现步骤                                               │
│      ↓                                                         │
│    返回设计方案                                                 │
│      ↓                                                         │
│  我收到方案，展示给用户                                          │
│      ↓                                                         │
│  用户批准后，我开始实现                                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                 TaskCreate 工作流                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  用户: "实现用户认证系统"                                        │
│      ↓                                                         │
│  判断: 这是复杂多步骤任务                                        │
│      ↓                                                         │
│  TaskCreate(                                                   │
│    subject: "实现用户认证系统"                                   │
│    description: "..."                                          │
│    activeForm: "实现用户认证系统中"                              │
│  )                                                              │
│      ↓                                                         │
│  任务列表显示: [⏳ 实现用户认证系统中...]                        │
│      ↓                                                         │
│  TaskUpdate(taskId, status: "in_progress")                     │
│      ↓                                                         │
│  开始实现...                                                   │
│      ↓                                                         │
│  TaskUpdate(taskId, status: "completed")                       │
│      ↓                                                         │
│  任务列表显示: [✅ 实现用户认证系统]                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 九、完整工具提示词

### 9.1 Task 工具提示词

```
The Task tool launches specialized agents (subprocesses) that autonomously handle complex tasks.
Each agent type has specific capabilities and tools available to it.

Available agent types and the tools they have access to:
- Bash: Command execution specialist for running bash commands.
  Use this for git operations, command execution, and other terminal tasks.
  Tools: Bash

- general-purpose: General-purpose agent for researching complex questions,
  searching code, and executing multi-step tasks.
  When you are searching for a keyword or file and you are not confident that
  you will find the right match in the first few tries use this agent to perform
  the search for you.
  Tools: *

- statusline-setup: Use this agent to configure the user's Claude Code status
  line setting.
  Tools: Read, Edit

- Explore: Fast agent specialized for exploring codebases.
  Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"),
  search code for keywords (eg. "API endpoints"), or answer questions about the codebase
  (eg. "how do API endpoints work?").
  When calling this agent, specify the thoroughness level: "quick" for basic searches,
  "medium" for moderate exploration, or "very thorough" for comprehensive analysis
  across multiple locations and naming conventions.
  Tools: All tools except Task, ExitPlanMode, Edit, Write, NotebookEdit

- Plan: Software architect agent for designing implementation plans.
  Use this when you need to plan the implementation strategy for a task.
  Returns step-by-step plans, identifies critical files, and considers architectural
  trade-offs.
  Tools: All tools except Task, ExitPlanMode, Edit, Write, NotebookEdit

- claude-code-guide: Use this agent when you ask questions (e.g., "Can Claude...",
  "Does Claude...", "How do I...") about: (1) Claude Code (the CLI tool) - features,
  hooks, slash commands, MCP servers, settings, IDE integrations, keyboard shortcuts;
  (2) Claude Agent SDK - building custom agents; (3) Claude API (formerly Anthropic API)
  - API usage, tool use, Anthropic SDK usage.
  IMPORTANT: Before spawning a new agent, check if there is already a running or
  recently completed claude-code-guide agent that you can resume using the "resume" parameter.
  Tools: Glob, Grep, Read, WebFetch, WebSearch

- ui-sketcher: Universal UI Blueprint Engineer that transforms any functional requirement
  into visual ASCII interface designs, user stories, and interaction specifications.
  Excels at converting brief descriptions into comprehensive user journeys with spatial
  layout visualization.
  Tools: Bash, Glob, Grep, Read, WebFetch, TodoWrite, WebSearch, BashOutput, KillShell,
  ListMcpResourcesTool, ReadMcpResourceTool

- bug-analyzer: Expert debugger specialized in deep code execution flow analysis and root
  cause investigation. Use when you need to analyze code execution paths, build execution
  chain diagrams, trace variable state changes, or perform deep root cause analysis.
  Tools: read_file, write_file, run_bash_command, search_files, grep

- code-reviewer: Elite code review expert specializing in modern AI-powered code analysis,
  security vulnerabilities, performance optimization, and production reliability. Masters
  static analysis tools, security scanning, and configuration review with 2024/2025 best
  practices. Open-sourced by @wshonson.
  Use PROACTIVELY for code quality assurance. Open-sourced by @wshonson.
  Tools: All tools

Usage notes:
- Always include a short description (3-5 words) summarizing what the agent will do.
- Launch multiple agents concurrently for maximum performance.
- If you want to read a specific file path, use the Read or Glob tool instead.
- When NOT to use the Task tool: Direct file operations, single-file code searches.
- IMPORTANT: When searching for a keyword or file and you are not confident you will find
  the right match in the first few tries, use the Task tool.

IMPORTANT: Use the Task tool with subagent_type=Explore instead of running search commands
directly when exploring the codebase to gather context or answer questions that are not a
needle query for a specific file/class/function.

When NOT to use the Task tool:
- If you want to read a specific file path, use the Read or Glob tool instead
- For direct file operations
- For single-file code searches
```

### 9.2 TaskCreate 提示词

```
Use this tool proactively to create a structured task list for your current coding session.
This helps you track progress, organize complex tasks, and demonstrate thoroughness to the
user. It also helps the user understand the progress of the task and overall progress of
their requests.

## When to Use This Tool

Use this tool proactively in these scenarios:
- Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
- Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
- Plan mode - When using plan mode, create a task list to track the work
- User explicitly requests todo list - When the user directly asks you to use the todo list
- User provides multiple tasks - When users provide multiple tasks (numbered or comma-separated)
- After receiving new instructions - Immediately capture user requirements as tasks

## When NOT to Use This Tool

Skip using this tool when:
- There is only a single, straightforward task
- The task is trivial and tracking provides no organizational benefit
- The task can be completed in less than 3 trivial steps
- The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this
case you are better off just doing the task directly.

## Task Fields

- subject: A brief, actionable title in imperative form (e.g., "Fix authentication bug in login flow")
- description: Detailed description of what needs to be done, including context and acceptance criteria
- activeForm: Present continuous form shown in spinner when task is in_progress
  (e.g., "Fixing authentication bug"). This is displayed to the user while you work on the task.

**IMPORTANT**: Always provide activeForm when creating tasks. The subject should be imperative
("Run tests") while activeForm should be present continuous ("Running tests"). All tasks are
created with status `pending`.
```

### 9.3 TaskGet 提示词

```
Use this tool to retrieve a task by its ID from the task list.

## When to Use This Tool

- When you need the full description and context before starting work on a task
- To understand task dependencies (what it blocks, what blocks it)
- After being assigned a task, to get complete requirements

## Output

Returns full task details:
- subject: Task title
- description: Detailed requirements and context
- status: 'pending', 'in_progress', or 'completed'
- blocks: Tasks waiting on this one to complete
- blockedBy: Tasks that must complete before this one can start

## Tips

- After fetching a task, verify its blockedBy list is empty before beginning work
- Use TaskList to see all tasks in summary form
```

### 9.4 TaskList 提示词

```
Use this tool to list all tasks in the task list.

## When to Use This Tool

- To see what tasks are available to work on (status: 'pending', no owner, not blocked)
- To check overall progress on the project
- To find tasks that are blocked and need dependencies resolved
- After completing a task, to check for newly unblocked work or claim the next available task

**Prefer working on tasks in ID order** (lowest ID first) when multiple tasks are available,
as earlier tasks often set up context for later ones.

## Output

Returns a summary of each task:
- id: Task identifier (use with TaskGet, TaskUpdate)
- subject: Brief description of the task
- status: 'pending', 'in_progress', or 'completed'
- owner: Agent ID if assigned, empty if available
- blockedBy: List of open task IDs that must be resolved first (tasks with blockedBy
  cannot be claimed until dependencies resolve)
```

### 9.5 TaskUpdate 提示词

```
Use this tool to update a task in the task list.

## When to Use This Tool

**Mark tasks as resolved:**
- When you have completed the work described in a task
- When a task is no longer needed or has been superseded
- IMPORTANT: Always mark your assigned tasks as resolved when you finish them

**Delete tasks:**
- When a task is no longer relevant or was created in error
- Setting status to `deleted` permanently removes the task

**Update task details:**
- When requirements change or become clearer
- When establishing dependencies between tasks

## Fields You Can Update

- status: The task status (see Status Workflow below)
- subject: Change the task title (imperative form, e.g., "Run tests")
- description: Change the task description
- activeForm: Present continuous form shown in spinner when task is in_progress
  (e.g., "Running tests")
- owner: Change the task owner (agent name)
- metadata: Merge metadata keys into the task (set to null to delete it)
- addBlocks: Mark tasks that cannot start until this one completes
- addBlockedBy: Mark tasks that must complete before this one can start

## Status Workflow

Status progresses: `pending` → `in_progress` → `completed`

Use `deleted` to permanently remove a task.

## Staleness

Make sure to read a task's latest state using `TaskGet` before updating it.

## Examples

Mark task as in progress when starting work:
{"taskId": "1", "status": "in_progress"}

Mark task as completed after finishing work:
{"taskId": "1", "status": "completed"}

Delete a task:
{"taskId": "1", "status": "deleted"}

Claim a task by setting owner:
{"taskId": "1", "owner": "my-name"}

Set up task dependencies:
{"taskId": "2", "addBlockedBy": ["1"]}
```

### 9.6 TaskOutput 提示词

```
- Retrieves output from a running or completed task (background shell, agent, or remote session)
- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs can be found using the /tasks command
- Works with all task types: background shells, async agents, and remote sessions
```

---

## 十、实战场景

### 10.1 场景一：只使用 Plan

```
用户: "帮我设计一个微服务架构的用户认证系统"

处理：
Task(
  subagent_type: "Plan",
  prompt: "设计微服务架构的用户认证系统，考虑：
  1. 服务拆分策略
  2. 认证服务设计
  3. 服务间通信
  4. 数据一致性
  5. 安全性考虑",
  description: "设计微服务认证架构"
)

输出：Plan 代理返回完整的架构设计方案
```

### 10.2 场景二：只使用 TaskCreate

```
用户: "帮我实现用户登录功能，包括JWT验证"

处理：
TaskCreate(
  subject: "实现用户登录功能",
  description: "实现用户登录功能：
  1. 创建登录 API 端点
  2. 实现 JWT 验证逻辑
  3. 添加错误处理
  4. 编写单元测试",
  activeForm: "实现用户登录功能中"
)

输出：任务列表显示 [⏳ 实现用户登录功能中...]
然后开始实现，完成后更新状态
```

### 10.3 场景三：Plan + TaskCreate 组合使用

```
用户: "我要构建一个完整的电商平台"

处理：
步骤1: 先用 Plan 设计整体架构
Task(
  subagent_type: "Plan",
  prompt: "设计电商平台的整体架构...",
  description: "设计电商平台架构"
)

步骤2: 获得方案后，创建任务列表
TaskCreate(subject: "设置项目结构", ...)
TaskCreate(subject: "实现用户认证", ...)
TaskCreate(subject: "实现商品管理", ...)
TaskCreate(subject: "实现购物车", ...)
...

步骤3: 逐步执行任务
TaskUpdate(taskId: "1", status: "in_progress")
...实现...
TaskUpdate(taskId: "1", status: "completed")

TaskUpdate(taskId: "2", status: "in_progress")
...
```

### 10.4 场景四：EnterPlanMode + TaskCreate

```
用户: "重构这个项目的认证模块"

处理：
步骤1: EnterPlanMode
→ 进入计划模式
→ 探索代码库
→ 设计重构方案
→ ExitPlanMode 提交计划

步骤2: 用户批准后
TaskCreate(subject: "提取认证服务", ...)
TaskCreate(subject: "重构登录逻辑", ...)
TaskCreate(subject: "更新依赖引用", ...)
TaskCreate(subject: "运行测试验证", ...)

步骤3: 执行任务
按顺序执行，每完成一个更新状态
```

---

## 十一、总结对比表

### 11.1 核心区别总结

| 维度 | Plan (Task工具) | TaskCreate/Update/等 |
|------|-----------------|---------------------|
| **系统** | 子代理系统 | 任务管理系统 |
| **目的** | 获得设计方案 | 跟踪工作进度 |
| **执行者** | 独立代理 | 主对话 |
| **输出** | 设计方案/架构图 | 任务状态/进度条 |
| **用户可见** | 间接（我展示结果） | 直接（任务列表） |
| **何时使用** | 需要设计/规划 | 需要组织/跟踪 |

### 11.2 工具选择速查表

| 你的需求 | 使用工具 |
|----------|----------|
| 需要架构设计方案 | Task("Plan") 或 EnterPlanMode |
| 需要技术选型建议 | Task("Plan") |
| 复杂多步骤实现 | TaskCreate + TaskUpdate |
| 展示工作进度给用户 | TaskCreate + TaskUpdate |
| 组织待办事项 | TaskList + TaskGet |
| 获取后台任务输出 | TaskOutput |

### 11.3 最佳实践

| 场景 | 推荐做法 |
|------|----------|
| 新功能开发 | 先 Plan 设计，再用 TaskCreate 跟踪 |
| 代码重构 | 先 Plan 规划，再用 TaskCreate 组织 |
| 简单修复 | 直接执行，无需 TaskCreate |
| 学习现有代码 | 用 Task("Explore") |
| 代码审查完成后 | 用 Task("Plan") 优化建议 |

---

**文档结束**

> 本文档详细解析了 Plan 代理和 Task 管理工具的区别、使用场景和完整系统提示词。
