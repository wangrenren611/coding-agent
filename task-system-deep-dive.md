# Claude Code 任务管理系统深度剖析

## 概述

Claude Code 提供了两种看似相似但本质不同的任务管理机制：

1. **`TaskCreate` / `TaskList` / `TaskUpdate` / `TaskGet`** - 任务记录与追踪系统
2. **`Task`** - 子智能体（Subagent）执行系统

理解两者的区别对高效使用 Claude Code 至关重要。

---

## 第一部分：任务记录系统（TaskCreate 家族）

### 1.1 核心定位

**`TaskCreate` 是一个纯元数据管理系统**，它不会在后台启动任何进程或智能体。它的作用类似于 Jira、Trello 或传统的 Todo List，用于：

- 记录需要完成的工作项
- 跟踪任务状态（pending → in_progress → completed）
- 建立任务间的依赖关系
- 分配任务负责人
- 维护任务上下文信息

### 1.2 详细参数说明

#### `TaskCreate` 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `subject` | string | 是 | 任务标题（祈使句形式，如"修复登录bug"） |
| `description` | string | 是 | 详细描述，包括背景、验收标准等 |
| `activeForm` | string | 否 | 进行中状态显示文本（如"正在修复登录bug"） |
| `metadata` | object | 否 | 任意自定义元数据（如优先级、标签等） |

**示例：**
```json
{
  "subject": "重构用户认证模块",
  "description": "当前认证逻辑分散在多个文件中，需要统一抽取到 auth/ 目录下。\n\n验收标准：\n- [ ] 所有认证相关函数迁移到 auth/ 目录\n- [ ] 现有测试全部通过\n- [ ] 新增单元测试覆盖率达到80%",
  "activeForm": "重构用户认证模块",
  "metadata": {
    "priority": "high",
    "estimated_hours": 4,
    "component": "backend"
  }
}
```

#### `TaskUpdate` 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `taskId` | string | **必填** 任务唯一标识 |
| `status` | enum | pending / in_progress / completed |
| `subject` | string | 更新标题 |
| `description` | string | 更新描述 |
| `activeForm` | string | 更新进行中状态文本 |
| `owner` | string | 指定负责人（agent ID） |
| `metadata` | object | 合并元数据（设值为 null 删除键） |
| `addBlockedBy` | string[] | 添加阻塞此任务的任务ID列表 |
| `addBlocks` | string[] | 添加被此任务阻塞的任务ID列表 |

#### `TaskGet` 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `taskId` | string | 要查询的任务ID |

**返回值包含：**
- 完整任务描述
- 当前状态
- 阻塞关系（blocks / blockedBy）
- 负责人

#### `TaskList` 参数

无需参数，返回所有任务的摘要列表：
- id
- subject
- status
- owner
- blockedBy（阻塞此任务的未完成任务ID）

### 1.3 使用场景

#### 场景 A：复杂项目的阶段规划

```
用户：帮我实现一个完整的用户注册系统
```

此时应该先用 `TaskCreate` 规划所有任务：

```json
// 任务1：数据库设计
TaskCreate({
  "subject": "设计用户表结构",
  "description": "创建用户表，包含字段：id, email, password_hash, created_at..."
})

// 任务2：API开发
TaskCreate({
  "subject": "实现注册API",
  "description": "POST /api/register 端点实现...",
  "addBlockedBy": ["任务1的ID"]  // 依赖任务1
})

// 任务3：前端页面
TaskCreate({
  "subject": "实现注册页面UI",
  "description": "创建注册表单组件...",
  "addBlockedBy": ["任务2的ID"]  // 依赖任务2
})
```

#### 场景 B：跟踪自己的工作进度

```json
// 开始工作时
TaskUpdate({
  "taskId": "task-123",
  "status": "in_progress",
  "owner": "claude-main"
})

// 完成后
TaskUpdate({
  "taskId": "task-123",
  "status": "completed"
})

// 查看下一个可用任务
TaskList()  // 找 pending 且无 blockedBy 的任务
```

#### 场景 C：多轮对话保持上下文

当对话很长时，用任务系统记录已完成的和待办的工作：

```json
// 第1轮对话后
TaskCreate({
  "subject": "完成数据库迁移",
  "description": "已创建 users 表，包含索引...",
  "status": "completed"
})

// 第5轮对话后，用户问"我们做到哪了"
TaskList()  // 快速回顾所有任务状态
```

### 1.4 状态流转

```
┌─────────┐    ┌─────────────┐    ┌───────────┐
│ pending │ → │ in_progress │ → │ completed │
└─────────┘    └─────────────┘    └───────────┘
     ↑                                │
     └────────────────────────────────┘
              （可以重新打开）
```

### 1.5 依赖关系图

```
Task A (数据库设计)
    │
    ▼ blockedBy: [A]
Task B (API开发)
    │
    ▼ blockedBy: [B]
Task C (前端页面)
    │
    ▼ blockedBy: [C]
Task D (集成测试)
```

`TaskList` 会自动过滤出有 `blockedBy` 的任务，让你知道哪些任务当前可执行。

---

## 第二部分：子智能体执行系统（Task 工具）

### 2.1 核心定位

**`Task` 是一个进程启动器**，它会创建一个完全独立的子智能体（subagent），这个子智能体：

- 在自己的上下文中运行
- 可以并行执行多个任务
- 有独立的工具访问权限
- 最终会返回结果给父智能体

**类比理解：**
- `TaskCreate` = 在白板上写一张便利贴
- `Task` = 派一个实习生去实际干活

### 2.2 详细参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `description` | string | 是 | 简短描述（3-5词），用于标识任务 |
| `prompt` | string | 是 | **完整详细的任务指令**，子智能体会看到 |
| `subagent_type` | string | 是 | 智能体类型，决定可用工具和专长 |
| `model` | enum | 否 | 使用模型：sonnet / opus / haiku（默认继承父智能体） |
| `max_turns` | number | 否 | 最大交互轮数，防止无限循环 |
| `resume` | string | 否 | 恢复之前任务的 agent ID |
| `run_in_background` | boolean | 否 | 后台运行，不阻塞当前对话 |
| `allowed_tools` | string[] | 否 | 限制子智能体可使用的工具 |

### 2.3 Subagent 类型详解

#### `Explore`（代码探索专家）

**专长：** 快速理解代码库结构

**适用场景：**
- 用户问"这个代码库怎么组织的？"
- 需要找到特定功能的实现位置
- 理解项目架构

**默认工具：** Glob, Grep, Read, Bash(ls/git)

**示例：**
```json
{
  "description": "探索错误处理机制",
  "prompt": "帮我找到这个代码库中所有错误处理相关的代码。\n\n具体包括：\n1. 错误定义的枚举或常量\n2. 错误处理的中间件/拦截器\n3. 全局错误边界\n4. 日志记录机制\n\n请返回每个发现的具体文件路径和行号。",
  "subagent_type": "Explore"
}
```

#### `Bash`（命令行专家）

**专长：** 执行 shell 命令和脚本

**适用场景：**
- Git 操作
- 文件系统操作
- 运行测试/构建命令
- 系统管理任务

**可用工具：** Bash 命令执行

**示例：**
```json
{
  "description": "运行测试套件",
  "prompt": "运行这个项目的所有测试，并告诉我：\n1. 测试总数\n2. 通过/失败数量\n3. 如果有失败的测试，显示失败详情\n\n首先检查 package.json 或类似文件确定如何运行测试。",
  "subagent_type": "Bash"
}
```

#### `Plan`（软件架构师）

**专长：** 设计实现方案

**适用场景：**
- 需要设计复杂功能的实现方案
- 不确定从哪开始
- 需要评估不同架构选择的利弊

**可用工具：** 所有工具（除 Task, Edit, Write）

**示例：**
```json
{
  "description": "设计缓存系统方案",
  "prompt": "我需要为这个 Node.js API 项目添加 Redis 缓存。\n\n请设计一个完整的实现方案，包括：\n1. 需要哪些文件/目录\n2. 缓存键的命名策略\n3. 缓存失效策略\n4. 错误回退机制\n5. 现有代码需要哪些修改\n\n先探索现有代码结构，再给出详细方案。",
  "subagent_type": "Plan"
}
```

#### `general-purpose`（通用代理）

**专长：** 多步骤复杂任务

**适用场景：**
- 需要搜索、阅读、分析多步操作
- 不确定用哪个专门 agent
- 任务涉及多种操作类型

**可用工具：** 所有工具

**示例：**
```json
{
  "description": "修复 API 鉴权问题",
  "prompt": "用户报告说某些 API 端点的鉴权有问题。\n\n请：\n1. 找到所有 API 端点定义\n2. 检查鉴权中间件的使用\n3. 找出哪些端点缺少鉴权\n4. 提出修复方案\n\n任务完成后返回详细的发现报告。",
  "subagent_type": "general-purpose"
}
```

#### `claude-code-guide`（Claude Code 专家）

**专长：** 回答关于 Claude Code 工具本身的问题

**适用场景：**
- "Claude Code 能做什么？"
- "如何配置 MCP 服务器？"
- "/commit 技能怎么用？"

**可用工具：** Glob, Grep, Read, WebFetch, WebSearch

#### `research-agent`（研究代理）

**专长：** 获取最新信息

**适用场景：**
- 查询最新的技术文档
- 验证当前事实
- 研究最新趋势

**可用工具：** 所有工具（包括 WebSearch, WebFetch）

### 2.4 高级用法

#### 并行任务执行

```json
// 同时启动多个独立的子智能体
[
  {
    "description": "分析前端代码",
    "prompt": "分析 src/frontend 目录下的所有组件...",
    "subagent_type": "Explore"
  },
  {
    "description": "分析后端代码",
    "prompt": "分析 src/backend 目录下的所有 API...",
    "subagent_type": "Explore"
  },
  {
    "description": "检查数据库模型",
    "prompt": "列出所有数据库模型定义...",
    "subagent_type": "Explore"
  }
]
```

**注意：** 必须在一个消息中发送多个 Task 调用才能实现并行。

#### 后台运行

```json
{
  "description": "长时间数据分析",
  "prompt": "分析 logs/ 目录下所有日志文件，统计错误频率...",
  "subagent_type": "Bash",
  "run_in_background": true
}
```

返回结果会包含 `output_file` 路径，稍后可用 `Read` 查看进度。

#### 限制工具权限

```json
{
  "description": "安全的代码审查",
  "prompt": "审查 src/auth.js 文件的安全性...",
  "subagent_type": "general-purpose",
  "allowed_tools": ["Read", "Grep"]  // 禁止写入操作
}
```

#### 恢复任务

```json
// 之前启动了一个长时间运行的任务，获得了 agentId: "agent-abc123"
{
  "description": "继续数据分析",
  "prompt": "继续之前的数据分析任务...",
  "subagent_type": "Bash",
  "resume": "agent-abc123"
}
```

---

## 第三部分：对比与选择指南

### 3.1 核心区别对比表

| 维度 | TaskCreate | Task |
|------|------------|------|
| **本质** | 元数据记录 | 进程启动 |
| **创建什么** | 任务卡片 | 子智能体 |
| **实际执行** | ❌ 否 | ✅ 是 |
| **返回值** | 任务 ID | 执行结果 |
| **并发能力** | N/A | ✅ 可并行运行多个 |
| **成本** | 极低 | 按 token 计费 |
| **持续时间** | 持久化存储 | 运行完即结束 |
| **使用频率** | 随时可调用 | 按需启动 |

### 3.2 决策流程图

```
用户请求
    │
    ▼
需要实际执行代码/命令/搜索？
    │
    ├── 是 ──→ 使用 Task 启动子智能体
    │              │
    │              ▼
    │         需要并行执行多个？
    │              │
    │              ├── 是 ──→ 在一个消息中发送多个 Task
    │              │
    │              └── 否 ──→ 发送单个 Task
    │
    └── 否 ──→ 只是规划/跟踪工作？
                   │
                   ▼
              使用 TaskCreate 记录任务
                   │
                   ▼
              任务状态变化时
              使用 TaskUpdate 更新
```

### 3.3 何时使用 TaskCreate

✅ **使用场景：**

1. **项目初始化规划**
   ```
   用户：帮我做一个电商网站
   → TaskCreate 创建：数据库设计、API开发、前端实现、测试等任务
   ```

2. **跟踪复杂任务的进度**
   ```
   正在进行多步骤重构
   → TaskUpdate 标记每步完成状态
   ```

3. **记录已完成的工作**
   ```
   对话很长，需要记录上下文
   → TaskCreate 记录已完成的里程碑
   ```

4. **建立任务依赖关系**
   ```
   任务B必须在任务A完成后才能开始
   → TaskCreate + addBlockedBy
   ```

❌ **不使用：**
- 需要实际执行代码或命令时
- 需要获取实时信息时

### 3.4 何时使用 Task

✅ **使用场景：**

1. **代码探索**
   ```
   用户：这个错误从哪里抛出的？
   → Task + Explore agent 搜索代码库
   ```

2. **并行分析**
   ```
   需要同时分析前端、后端、数据库
   → 并行启动 3 个 Task
   ```

3. **执行耗时操作**
   ```
   需要运行测试套件或构建
   → Task + Bash agent
   ```

4. **隔离风险操作**
   ```
   不确定的代码修改，想先探索
   → Task 让子智能体先研究，再决定
   ```

5. **获取最新信息**
   ```
   查询最新的库版本或文档
   → Task + research-agent
   ```

❌ **不使用：**
- 只是做笔记或标记状态时
- 可以直接快速完成的工作（避免 overhead）

---

## 第四部分：组合使用模式

### 4.1 模式一：先规划，后执行

```
用户：帮我重构这个项目的认证系统

步骤1：规划
├── TaskCreate: 分析现有认证代码
├── TaskCreate: 设计新架构
├── TaskCreate: 实施重构 (blockedBy: 前两个)
└── TaskCreate: 验证测试 (blockedBy: 实施重构)

步骤2：执行（用 Task 启动实际工作）
├── Task: Explore agent 分析现有代码
│   └── 返回分析结果
├── 根据分析结果修改设计
├── Task: general-purpose agent 执行重构
│   └── 实际修改代码
└── Task: Bash agent 运行测试
    └── 返回测试结果

步骤3：更新状态
├── TaskUpdate: 标记任务完成
└── TaskList: 显示下一步可执行任务
```

### 4.2 模式二：敏捷迭代

```
循环直到完成：
1. TaskList() 查看当前待办
2. 选择最高优先级任务
3. TaskUpdate(任务ID, status: "in_progress")
4. Task(子智能体执行具体工作)
5. TaskUpdate(任务ID, status: "completed")
```

### 4.3 模式三：任务委托

```
父智能体（主控）：
├── TaskCreate: 创建任务A
├── TaskCreate: 创建任务B
└── TaskList() → 获取任务列表

并行执行：
├── Task(探索任务A的代码) → 结果A
└── Task(探索任务B的代码) → 结果B

整合结果：
├── 分析两个子智能体的返回
├── TaskUpdate(任务A, completed)
├── TaskUpdate(任务B, completed)
└── 向用户汇报综合结果
```

### 4.4 模式四：长时间任务跟踪

```
步骤1：创建任务
TaskCreate({
  subject: "执行全量数据迁移",
  description: "迁移 users 表数据到新schema",
  activeForm: "执行数据迁移中"
})

步骤2：后台启动执行
Task({
  description: "数据迁移",
  prompt: "执行数据迁移脚本...",
  run_in_background: true  // 不阻塞主对话
})

步骤3：继续其他工作
（与用户讨论其他话题）

步骤4：检查进度
Read(后台任务返回的 output_file)

步骤5：完成后更新
TaskUpdate(任务ID, status: "completed")
```

---

## 第五部分：完整示例

### 示例：实现用户注册功能

**用户输入：**
> "帮我实现一个完整的用户注册功能，包括前后端"

**完整处理流程：**

```json
// ========== 第一阶段：规划 ==========

// 1.1 创建所有任务
TaskCreate({
  "subject": "分析现有代码结构",
  "description": "了解项目架构，确定：\n- 技术栈\n- 目录结构\n- 现有的用户相关代码\n- 数据库使用情况",
  "activeForm": "分析代码结构中"
})
// 返回: task-001

TaskCreate({
  "subject": "设计用户数据模型",
  "description": "设计数据库表结构：\n- users 表字段\n- 索引设计\n- 密码加密策略",
  "activeForm": "设计数据模型中",
  "addBlockedBy": ["task-001"]
})
// 返回: task-002

TaskCreate({
  "subject": "实现后端注册API",
  "description": "实现 POST /api/register：\n- 参数校验\n- 邮箱唯一性检查\n- 密码哈希\n- 用户创建\n- 返回JWT token",
  "activeForm": "实现后端API中",
  "addBlockedBy": ["task-002"]
})
// 返回: task-003

TaskCreate({
  "subject": "实现前端注册页面",
  "description": "创建注册页面：\n- 表单UI\n- 客户端校验\n- API调用\n- 错误处理\n- 成功跳转",
  "activeForm": "实现前端页面中",
  "addBlockedBy": ["task-003"]
})
// 返回: task-004

TaskCreate({
  "subject": "编写测试",
  "description": "- 后端API单元测试\n- 前端组件测试\n- 端到端注册流程测试",
  "activeForm": "编写测试中",
  "addBlockedBy": ["task-004"]
})
// 返回: task-005

// ========== 第二阶段：执行 ==========

// 2.1 启动第一个任务（无依赖）
TaskUpdate({
  "taskId": "task-001",
  "status": "in_progress"
})

Task({
  "description": "探索项目结构",
  "prompt": "请探索这个项目的技术栈和架构：\n1. 查看 package.json / requirements.txt / go.mod 等确定技术栈\n2. 查看目录结构\n3. 搜索是否有现有的用户相关代码\n4. 查看数据库配置和迁移文件\n\n请返回详细的发现报告。",
  "subagent_type": "Explore"
})

// 2.2 子智能体返回结果后
TaskUpdate({
  "taskId": "task-001",
  "status": "completed"
})

TaskUpdate({
  "taskId": "task-002",
  "status": "in_progress"
})

// 基于发现结果，设计数据模型...
// (继续执行后续任务)

// ========== 第三阶段：跟踪 ==========

// 3.1 随时查看整体进度
TaskList()

// 返回：
// ┌──────────┬─────────────────────┬───────────┬─────────┐
// │ ID       │ Subject             │ Status    │ Blocked │
// ├──────────┼─────────────────────┼───────────┼─────────┤
// │ task-001 │ 分析现有代码结构    │ completed │         │
// │ task-002 │ 设计用户数据模型    │ completed │         │
// │ task-003 │ 实现后端注册API     │ in_progr  │         │
// │ task-004 │ 实现前端注册页面    │ pending   │ task-003│
// │ task-005 │ 编写测试            │ pending   │ task-004│
// └──────────┴─────────────────────┴───────────┴─────────┘
```

---

## 第六部分：常见误区与最佳实践

### 6.1 常见误区

#### ❌ 误区1：用 TaskCreate 代替 Task

```
错误理解：
"TaskCreate 可以创建任务让系统去执行"

正确理解：
TaskCreate 只是记录，不执行任何操作
```

#### ❌ 误区2：对简单任务使用 Task

```
用户：这个变量在哪定义的？

低效做法：
→ Task + Explore agent （启动 overhead 高）

正确做法：
→ 直接 Grep("变量名") 快速查找
```

#### ❌ 误区3：忘记更新任务状态

```
问题：
TaskCreate 创建任务 → Task 执行完成 → 没有 TaskUpdate

后果：
TaskList() 显示任务还是 pending，状态不同步
```

#### ❌ 误区4：阻塞关系设置错误

```
错误：
Task A (前端) blockedBy: [Task B (后端)]
但实际上前端可以先写 UI，不需要等后端

正确：
Task C (集成) blockedBy: [Task A, Task B]
```

#### ❌ 误区5：过于细粒度的 TaskCreate

```
过度规划：
├── TaskCreate: 创建 users 表
├── TaskCreate: 创建 username 索引
├── TaskCreate: 创建 email 索引
└── ... (每个字段一个任务)

正确做法：
└── TaskCreate: 设计并创建 users 表（包含所有细节）
```

### 6.2 最佳实践

#### ✅ 实践1：合适的任务粒度

- **太细：** 每个小改动都创建任务
- **太粗：** "完成整个项目" 作为一个任务
- **合适：** 一个可交付的功能点（如"实现注册API"）

#### ✅ 实践2：并行化独立任务

```
低效：
Task(分析前端) → 等待完成 → Task(分析后端)

高效：
在一个消息中同时发送：
Task(分析前端) + Task(分析后端) + Task(分析数据库)
```

#### ✅ 实践3：使用 metadata 扩展

```json
TaskCreate({
  "subject": "实现支付功能",
  "description": "...",
  "metadata": {
    "priority": "high",
    "estimated_hours": 8,
    "sprint": "2024-Q1",
    "tags": ["payment", "stripe"]
  }
})
```

#### ✅ 实践4：选择合适的 agent 类型

| 任务类型 | 推荐 agent |
|----------|------------|
| 探索代码库 | Explore |
| 设计方案 | Plan |
| 执行 git/命令 | Bash |
| 综合任务 | general-purpose |
| 查询 Claude Code | claude-code-guide |
| 查最新信息 | research-agent |

#### ✅ 实践5：清晰的 prompt 编写

```
差的 prompt：
"修复 bug"

好的 prompt：
"用户报告登录时偶尔报错 'Session expired'。
请：
1. 找到所有与 session 相关的代码
2. 分析 session 过期逻辑
3. 找出导致误报的代码位置
4. 提出修复方案

相关文件可能在 src/auth/ 目录下"
```

#### ✅ 实践6：及时清理完成的任务

虽然任务会持久保存，但在长对话中：
- 定期 TaskList() 查看当前状态
- 完成的任务可以保留作为记录
- 或通过 TaskUpdate 清理不再需要的元数据

---

## 第七部分：参数速查表

### TaskCreate

```json
{
  "subject": "任务标题",           // 必填
  "description": "详细描述",       // 必填
  "activeForm": "进行中显示文本",  // 可选
  "metadata": {                    // 可选
    "key": "value"
  }
}
```

### TaskUpdate

```json
{
  "taskId": "任务ID",              // 必填
  "status": "completed",           // pending|in_progress|completed
  "subject": "新标题",             // 可选
  "description": "新描述",         // 可选
  "activeForm": "新状态文本",      // 可选
  "owner": "负责人",               // 可选
  "metadata": {                    // 可选（合并模式）
    "priority": null               // 删除 priority 键
  },
  "addBlockedBy": ["task-1"],      // 可选（添加阻塞）
  "addBlocks": ["task-2"]          // 可选（添加被阻塞）
}
```

### Task (子智能体)

```json
{
  "description": "简短描述",       // 必填
  "prompt": "详细指令",            // 必填
  "subagent_type": "Explore",      // 必填
  "model": "sonnet",               // 可选 (sonnet/opus/haiku)
  "max_turns": 100,                // 可选
  "resume": "agent-id",            // 可选
  "run_in_background": false,      // 可选
  "allowed_tools": ["Read"]        // 可选
}
```

---

## 总结

| 场景 | 工具选择 | 理由 |
|------|----------|------|
| 记录待办事项 | TaskCreate | 纯元数据，快速持久化 |
| 跟踪工作进度 | TaskUpdate | 状态流转可视化 |
| 查看项目全貌 | TaskList | 依赖关系一目了然 |
| 实际执行代码 | Task | 启动子智能体工作 |
| 并行分析任务 | Task (多个) | 同时启动多个 agent |
| 获取最新信息 | Task + research-agent | 联网搜索能力 |
| 设计方案 | Task + Plan agent | 结构化设计输出 |

**核心口诀：**
- 要做笔记 → `TaskCreate`
- 要干活 → `Task`
- 看进度 → `TaskList`
- 改状态 → `TaskUpdate`
