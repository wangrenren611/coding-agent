# CLAUDE.md

> Coding Agent 项目开发指南 

## 项目概述

Coding Agent 是一个生产级的 AI 编码助手框架，采用**协调器模式（Coordinator Pattern）**设计，将复杂的 Agent 逻辑分解为独立的可插拔组件。

### 核心特性

- **多轮对话**：完整的对话上下文管理
- **工具调用**：16+ 内置工具，支持自定义扩展
- **流式输出**：实时流式响应
- **自动重试**：智能错误分类，自动重试可恢复错误
- **上下文压缩**：智能压缩长对话，节省 token 消耗
- **多 Provider 支持**：GLM、Kimi、MiniMax 等

### 技术栈

- **TypeScript 5.3+** - 主要开发语言，严格模式
- **Node.js 20+** - 运行环境
- **Vitest** - 单元测试框架
- **Zod** - 运行时类型验证



## 核心架构

### 分层架构

```
应用层 (CLI/Web UI/API)
        │
        ▼
Agent 层 (协调器、ReAct引擎、工具注册表)
        │
        ▼
Provider 层 (Provider注册表、HTTP客户端、适配器)
        │
        ▼
LLM 服务层 (GLM/Kimi/MiniMax)
```

### 核心组件

| 组件 | 职责 |
|------|------|
| **Agent** | 协调器，管理任务生命周期，协调各组件工作 |
| **LLMCaller** | 封装 LLM 调用逻辑，处理流式响应 |
| **ToolExecutor** | 工具执行调度，超时控制，结果处理 |
| **Session** | 消息管理，上下文压缩，持久化触发 |
| **EventBus** | 事件发布订阅，组件间解耦通信 |
| **MemoryManager** | 持久化存储抽象，会话数据管理 |

## 开发命令

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建
pnpm build

# 运行测试
pnpm test

# 测试覆盖率
pnpm test:coverage

# 代码检查
pnpm lint

# 代码检查并修复
pnpm lint:fix

# 类型检查
pnpm typecheck

# 运行 CLI
pnpm cli
```

## 代码规范

### 文件修改最佳实践

1. **优先使用 batch_replace**：对同一文件进行多处修改时，使用 `batch_replace` 而非多次 `precise_replace`
2. **修改前先读取**：使用 `precise_replace` 或 `batch_replace` 前必须先 `read_file` 获取当前内容
3. **精确复制 oldText**：从 `read_file` 输出中精确复制要替换的文本，包括缩进和空格

### 工具选择优先级

1. `batch_replace` - 多处修改同一文件（首选）
2. `precise_replace` - 单处修改
3. `write_file` - 大规模重构（最后手段）

### TypeScript 规范

- 使用严格模式
- 所有公共 API 必须有类型注解
- 使用 `import type` 导入仅类型
- 避免使用 `any`，使用 `unknown` 并进行类型守卫

### 测试规范

- 测试文件放在源文件同级目录，命名为 `*.test.ts`
- 使用 Vitest 的 `describe`、`it`、`expect`
- 每个测试应该独立，不依赖其他测试的状态


## 内置工具列表

| 工具 | 名称 | 功能 |
|------|------|------|
| ReadFileTool | `read_file` | 读取文件内容，支持图片、PDF |
| WriteFileTool | `write_file` | 写入文件 |
| SurgicalEditTool | `precise_replace` | 精确文本替换 |
| BatchReplaceTool | `batch_replace` | 批量文本替换 |
| GrepTool | `grep` | 正则代码搜索 |
| GlobTool | `glob` | 文件模式匹配 |
| BashTool | `bash` | Shell 命令执行 |
| WebSearchTool | `web_search` | 网络搜索 |
| WebFetchTool | `web_fetch` | 网页内容抓取 |
| LspTool | `lsp` | 语言服务器协议 |
| TaskTool | `task` | 子 Agent 任务委托 |

## 环境配置

创建 `.env` 文件：

```env
# GLM (智谱)
GLM_API_KEY=your_api_key

# Kimi (月之暗面)
KIMI_API_KEY=your_api_key

# MiniMax
MINIMAX_API_KEY=your_api_key
MINIMAX_GROUP_ID=your_group_id

# Tavily (Web 搜索)
TAVILY_API_KEY=your_api_key
```

## 常见问题

### 如何添加新工具

1. 在 `src/agent-v2/tool/` 创建新文件
2. 继承 `BaseTool` 类
3. 在 `src/agent-v2/tool/index.ts` 导出
4. 添加测试文件

```typescript
import { BaseTool, ToolResult } from './base';
import { z } from 'zod';

export class MyTool extends BaseTool<typeof MySchema> {
  name = 'my_tool';
  description = '工具描述';
  
  schema = z.object({
    param: z.string().describe('参数描述'),
  });

  async execute(params: { param: string }): Promise<ToolResult> {
    return { success: true, output: 'result' };
  }
}
```

### 如何添加新 Provider

1. 在 `src/providers/adapters/` 创建适配器
2. 在 `src/providers/registry/model-config.ts` 添加模型配置
3. 在 `src/providers/index.ts` 导出创建函数

### 如何恢复会话

```typescript
const agent = new Agent({
  provider,
  memoryManager,
  sessionId: 'previous-session-id',
});
```

## 注意事项

### 安全相关

- 文件操作限制在工作目录内
- 危险命令需要用户确认
- 敏感信息（API Key）不记录到日志

### 性能相关

- 大文件使用分块读取
- 长对话启用上下文压缩
- 工具结果可缓存

### 错误处理

- Agent 有自动重试机制
- 错误分类：可恢复错误 vs 不可恢复错误
- 重试次数和延迟可配置

---

## Git 提交规范

### CI 检查流程

**提交代码前必须执行完整的 CI 检查**：

```bash
# 1. 格式检查
pnpm format:check

# 2. 类型检查
pnpm typecheck

# 3. 代码检查
pnpm lint

# 4. 单元测试
pnpm test

# 5. 构建检查（可选）
pnpm build
```

### 完整提交流程

```bash
# Step 1: 确保在正确的分支
git checkout feature/your-feature-branch

# Step 2: 执行格式化（修复格式问题）
pnpm format

# Step 3: 执行所有 CI 检查
pnpm format:check && pnpm typecheck && pnpm lint

# Step 4: 运行测试
pnpm test

# Step 5: 暂存修改的文件
git add <具体文件路径>

# Step 6: 提交代码（使用规范的 commit message）
git commit -m "feat(module): 简短描述"

# Step 7: 合并到目标分支（如 develop）
git checkout develop
git merge feature/your-feature-branch

# Step 8: 推送到远程
git push origin develop
git push origin feature/your-feature-branch
```

### Commit Message 规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```
<type>(<scope>): <subject>

<body>

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

#### Type 类型

| Type | 说明 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat(truncation): 实现工具输出截断模块` |
| `fix` | Bug 修复 | `fix(agent): 修复重试逻辑错误` |
| `docs` | 文档更新 | `docs(readme): 更新安装说明` |
| `style` | 代码格式（不影响功能） | `style: fix prettier formatting issues` |
| `refactor` | 代码重构 | `refactor(tool): 重构工具注册表` |
| `test` | 测试相关 | `test(truncation): 添加边界条件测试` |
| `chore` | 构建/工具相关 | `chore: 更新依赖版本` |

#### Scope 范围

常用 scope：
- `agent` - Agent 核心
- `tool` - 工具系统
- `truncation` - 截断模块
- `permission` - 权限系统
- `provider` - Provider 层
- `session` - 会话管理
- `memory` - 持久化存储
- `cli` - CLI 应用

### 分支命名规范

```
<type>/<description>

# 示例
feature/permission-truncation
fix/agent-retry-logic
refactor/tool-registry
docs/api-documentation
```

### CI 失败处理

如果 CI 失败，按以下步骤修复：

1. **Prettier 格式问题**
   ```bash
   pnpm format
   git add . && git commit -m "style: fix prettier formatting issues"
   ```

2. **TypeScript 类型错误**
   ```bash
   pnpm typecheck  # 查看具体错误
   # 修复后重新检查
   ```

3. **ESLint 错误**
   ```bash
   pnpm lint        # 查看错误
   pnpm lint:fix    # 自动修复可修复的问题
   ```

4. **测试失败**
   ```bash
   pnpm test        # 查看失败测试
   # 修复后重新运行
   ```

---

## Browser Automation
Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:
1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes
## 参考文档

- [README.md](./README.md) - 完整使用文档
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) - 技术架构文档
- [docs/IMPLEMENTATION.md](./docs/IMPLEMENTATION.md) - 实现细节