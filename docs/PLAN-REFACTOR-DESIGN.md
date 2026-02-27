# Plan 模块重构设计

## 问题分析

### 当前实现的问题

1. **过度设计**：
   - `PlanManager` 有 20+ 方法管理步骤状态
   - 6 个 Plan 工具（plan_create, plan_get, plan_list, plan_update, plan_step, plan_document）
   - 复杂的状态机（draft → active → completed → abandoned）
   - 步骤状态管理（pending → in_progress → completed → blocked → skipped）

2. **与 Claude Code 设计不一致**：
   - Claude Code 的 Plan 就是简单的 Markdown 文档
   - 存储在 `~/.claude/plans/` 目录
   - 文件名格式：`{adjective}-{verb}-{noun}.md`
   - Agent 自己阅读文档并执行

3. **不必要的复杂性**：
   - `context-builder.ts` 自定义构建 Plan 上下文
   - Agent 需要学习 plan_step、plan_update 等工具
   - 程序需要维护 Plan 状态同步

### Claude Code 原始设计

```
~/.claude/plans/
├── polished-foraging-emerson.md    # Provider 架构重构计划
├── swift-hiking-waters.md          # 另一个计划
└── ...
```

**文件内容结构**：
```markdown
# 计划标题

## 目标
计划的主要目标

## 现状分析
当前状态和问题

## 设计原则
指导原则

## 架构设计
技术设计

## 实施步骤
1. 步骤一
2. 步骤二
...

## 验证方式
如何验证完成
```

---

## 新设计方案

### 核心理念

> **Plan 就是一个 Markdown 文档，Agent 负责生成和执行，不需要复杂的状态管理。**

### 简化后的工作流程

```
┌─────────────────────────────────────────────────────────────┐
│                      Plan 工作流程                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐                                        │
│  │  Plan 模式       │                                        │
│  │  (planMode:true)│                                        │
│  └────────┬────────┘                                        │
│           │                                                 │
│           ▼                                                 │
│  ┌─────────────────┐                                        │
│  │  探索代码库      │  ← 只读工具：read_file, glob, grep     │
│  │  搜索资料        │  ← web_search, web_fetch              │
│  └────────┬────────┘                                        │
│           │                                                 │
│           ▼                                                 │
│  ┌─────────────────┐                                        │
│  │  生成 Plan MD   │  ← plan_create 工具                    │
│  │  存储到文件      │  ← 存储到 data/plans/ 目录            │
│  └────────┬────────┘                                        │
│           │                                                 │
│           ▼                                                 │
│  ┌─────────────────┐                                        │
│  │  执行模式        │                                        │
│  │  (planMode:false)│                                       │
│  └────────┬────────┘                                        │
│           │                                                 │
│           ▼                                                 │
│  ┌─────────────────┐                                        │
│  │  读取 Plan MD   │  ← read_file 读取文档                  │
│  │  按文档执行      │  ← Agent 自己决定如何执行             │
│  └─────────────────┘                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 新架构设计

### 目录结构

```
src/agent-v2/plan/
├── index.ts              # 统一导出
├── types.ts              # 简化的类型定义（保留）
├── storage.ts            # Plan 文件存储（简化）
├── tools.ts              # Plan 工具（只保留 plan_create）
└── plan-mode.ts          # Plan 模式权限控制（保留）

# 删除的文件
# context-builder.ts      # 不再需要
# manager.ts              # 不再需要
# agent-integration.ts    # 简化合并
# plan-task-integration.ts # 不再需要
# plan-execute-tool.ts    # 不再需要
```

### 存储结构

```
data/plans/
├── session-{sessionId}/
│   ├── plan.md                    # 当前 Plan 文档
│   └── metadata.json              # 元数据（可选）
└── ...
```

### 类型定义

```typescript
// types.ts - 大幅简化

/** Plan 元数据 */
export interface PlanMeta {
    id: string;              // 唯一标识
    title: string;           // 标题
    createdAt: string;       // 创建时间
    updatedAt: string;       // 更新时间
    sessionId: string;       // 关联的会话 ID
    filePath: string;        // MD 文件路径
}

/** Plan 创建参数 */
export interface CreatePlanParams {
    title: string;
    description: string;
    content: string;         // Markdown 内容
    sessionId: string;
}
```

### 存储接口

```typescript
// storage.ts - 简化

export interface PlanStorage {
    /** 创建 Plan（保存 MD 文件） */
    create(params: CreatePlanParams): Promise<PlanMeta>;
    
    /** 获取 Plan（读取 MD 文件） */
    get(planId: string): Promise<{ meta: PlanMeta; content: string } | null>;
    
    /** 列出所有 Plan */
    list(sessionId?: string): Promise<PlanMeta[]>;
    
    /** 删除 Plan */
    delete(planId: string): Promise<void>;
}

/** 文件存储实现 */
export class FilePlanStorage implements PlanStorage {
    constructor(private basePath: string) {}
    
    async create(params: CreatePlanParams): Promise<PlanMeta> {
        const id = generatePlanId();
        const filePath = path.join(this.basePath, params.sessionId, 'plan.md');
        
        // 确保 目录存在
        await fs.ensureDir(path.dirname(filePath));
        
        // 写入 MD 文件
        await fs.writeFile(filePath, params.content, 'utf-8');
        
        // 保存元数据
        const meta: PlanMeta = {
            id,
            title: params.title,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            sessionId: params.sessionId,
            filePath,
        };
        await this.saveMeta(meta);
        
        return meta;
    }
    
    async get(planId: string): Promise<{ meta: PlanMeta; content: string } | null> {
        const meta = await this.loadMeta(planId);
        if (!meta) return null;
        
        const content = await fs.readFile(meta.filePath, 'utf-8');
        return { meta, content };
    }
    
    // ... 其他方法
}
```

### 工具定义

```typescript
// tools.ts - 只保留一个工具

/** plan_create 工具 - 创建 Plan MD 文档 */
export class PlanCreateTool extends BaseTool<typeof PlanCreateSchema> {
    name = 'plan_create';
    description = '创建执行计划 Markdown 文档';
    
    schema = z.object({
        title: z.string().describe('计划标题'),
        content: z.string().describe('计划内容（Markdown 格式）'),
    });
    
    async execute(params: { title: string; content: string }): Promise<ToolResult> {
        const { title, content } = params;
        
        // 从上下文获取 sessionId
        const sessionId = this.getContext().sessionId;
        
        // 存储 Plan
        const meta = await this.storage.create({
            title,
            description: title,
            content,
            sessionId,
        });
        
        return {
            success: true,
            output: `计划已创建：${meta.title}\n文件路径：${meta.filePath}`,
        };
    }
}
```

### Plan 模式控制

```typescript
// plan-mode.ts - 保持不变

/** Plan 模式允许的工具 */
export const PLAN_MODE_ALLOWED_TOOLS = new Set([
    // 文件读取
    'read_file',
    'glob',
    'grep',
    
    // 网络
    'web_search',
    'web_fetch',
    
    // LSP
    'lsp',
    
    // Plan 工具
    'plan_create',
    
    // 任务管理（可选）
    'task_list',
    'task_get',
]);

/** 检查工具是否在 Plan 模式下允许 */
export function isToolAllowedInPlanMode(toolName: string): boolean {
    return PLAN_MODE_ALLOWED_TOOLS.has(toolName);
}
```

---

## 使用示例

### Demo 代码

```typescript
// demo-plan.ts - 简化版

async function runPlanDemo() {
    // ==================== 阶段 1: Plan 模式 ====================
    console.log('阶段 1: Plan 模式 - 分析需求并创建计划');
    
    const planAgent = new Agent({
        provider,
        systemPrompt: operatorPrompt({ directory: process.cwd(), language: 'Chinese' }),
        planMode: true,  // 只读工具 + plan_create
        // ...
    });
    
    // Agent 探索代码库，生成 Plan MD 文档
    await planAgent.execute(`
        分析需求并创建执行计划。
        
        使用 plan_create 工具创建计划文档。
    `);
    
    // ==================== 获取 Plan 文件路径 ====================
    const planFile = path.join(MEMORY_PATH, planAgent.getSessionId(), 'plan.md');
    
    // ==================== 阶段 2: 执行模式 ====================
    console.log('阶段 2: 执行模式 - 根据 Plan 执行');
    
    // 读取 Plan 文档
    const planContent = await fs.readFile(planFile, 'utf-8');
    
    const executionAgent = new Agent({
        provider,
        systemPrompt: operatorPrompt({ directory: process.cwd(), language: 'Chinese' }),
        // planMode: false (默认)
        // ...
    });
    
    // Agent 读取 Plan 并执行
    await executionAgent.execute(`
        这是执行计划：
        
        ${planContent}
        
        请按照计划执行，完成后报告结果。
    `);
}
```

### 生成的 Plan 文档示例

```markdown
# 用户认证功能实现计划

## 目标

为系统添加完整的用户认证功能，包括登录、注册、密码重置等。

## 现状分析

### 当前状态
- 项目使用 TypeScript + Node.js
- 已有基础的用户模型
- 缺少认证逻辑

### 依赖
- bcrypt（密码加密）
- jsonwebtoken（Token 管理）
- express（路由）

## 设计原则

1. 安全优先：密码加密存储，Token 安全传输
2. 可扩展：支持未来添加 OAuth
3. 测试覆盖：关键路径必须有测试

## 实施步骤

### 步骤 1：安装依赖
```bash
pnpm add bcrypt jsonwebtoken
pnpm add -D @types/bcrypt @types/jsonwebtoken
```

### 步骤 2：实现密码工具
- 创建 `src/auth/password.ts`
- 实现 hashPassword 和 comparePassword 函数

### 步骤 3：实现 Token 管理
- 创建 `src/auth/token.ts`
- 实现 generateToken 和 verifyToken 函数

### 步骤 4：实现认证中间件
- 创建 `src/auth/middleware.ts`
- 实现 authMiddleware 验证 Token

### 步骤 5：实现 API 端点
- POST /auth/register
- POST /auth/login
- POST /auth/logout
- POST /auth/reset-password

### 步骤 6：编写测试
- 单元测试：密码工具、Token 管理
- 集成测试：API 端点

## 验证方式

1. 运行测试：`pnpm test`
2. 手动测试 API 端点
3. 检查代码覆盖率

## 预期结果

- 用户可以注册新账户
- 用户可以登录获取 Token
- 用户可以使用 Token 访问受保护资源
- 用户可以重置密码
```

---

## 与当前实现的对比

| 方面 | 当前实现 | 新设计 |
|------|---------|--------|
| 复杂度 | 6 个工具，20+ 方法 | 1 个工具，4 个方法 |
| 状态管理 | 复杂状态机 | 无状态（纯文档） |
| Agent 职责 | 学习工具调用 | 自然阅读和执行 |
| 存储方式 | JSON + MD | 纯 MD 文件 |
| 与 Claude Code 一致性 | ❌ 不一致 | ✅ 一致 |
| 代码行数 | ~2000 行 | ~300 行 |

---

## 需要删除的文件/代码

### 删除整个文件
1. `src/agent-v2/plan/manager.ts` - 不再需要复杂管理
2. `src/agent-v2/plan/context-builder.ts` - 不再需要
3. `src/agent-v2/plan/agent-integration.ts` - 简化合并
4. `src/agent-v2/plan/plan-task-integration.ts` - 不再需要
5. `src/agent-v2/plan/plan-execute-tool.ts` - 不再需要

### 简化的文件
1. `src/agent-v2/plan/types.ts` - 只保留 PlanMeta 和 CreatePlanParams
2. `src/agent-v2/plan/storage.ts` - 简化为 4 个方法
3. `src/agent-v2/plan/tools.ts` - 只保留 plan_create

### 删除的测试文件
1. `src/agent-v2/plan/__tests__/manager.test.ts`
2. `src/agent-v2/plan/__tests__/context-builder.test.ts`
3. `src/agent-v2/plan/__tests__/plan-task-integration.test.ts`
4. `src/agent-v2/plan/__tests__/plan-execute-tool.test.ts`

---

## 实施步骤

### 阶段 1：删除多余代码（优先级：高）
1. 删除 manager.ts
2. 删除 context-builder.ts
3. 删除 plan-task-integration.ts
4. 删除 plan-execute-tool.ts
5. 删除相关测试文件

### 阶段 2：简化存储（优先级：高）
1. 重构 storage.ts - 只保留 create/get/list/delete
2. 删除步骤状态管理相关代码

### 阶段 3：简化工具（优先级：高）
1. 删除 plan_get, plan_list, plan_update, plan_step, plan_document 工具
2. 只保留 plan_create

### 阶段 4：简化类型（优先级：中）
1. 删除 PlanStatus, PlanPriority, PlanStepStatus 等枚举
2. 只保留 PlanMeta 和 CreatePlanParams

### 阶段 5：更新 Demo（优先级：中）
1. 更新 demo-plan.ts 使用新的简化 API

### 阶段 6：更新测试（优先级：中）
1. 编写新的简化测试

---

## 预期收益

1. **代码量减少 85%**：从 ~2000 行减少到 ~300 行
2. **更符合直觉**：Plan 就是文档，不需要学习复杂工具
3. **与 Claude Code 一致**：用户体验一致
4. **更易维护**：简单的设计更容易理解和维护
5. **更灵活**：Agent 自己决定如何执行，不受约束

---

## 总结

当前 Plan 实现过度工程化，引入了不必要的状态管理和工具调用复杂度。新设计回归本质：**Plan 就是一个 Markdown 文档**，Agent 负责生成和执行，程序只负责存储和读取。

这种设计：
- 更简单
- 更灵活
- 与 Claude Code 一致
- 更易维护
