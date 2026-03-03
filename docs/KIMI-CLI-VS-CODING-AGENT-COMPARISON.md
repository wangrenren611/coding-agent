# Kimi-CLI vs Coding-Agent 深度对比报告

> 生成时间: 2026-03-03  
> 对比项目: D:\work\kimi-cli vs D:\work\coding-agent

---

## 目录

1. [执行摘要](#一执行摘要)
2. [架构对比](#二架构对比)
3. [核心组件对比](#三核心组件对比)
4. [幻觉处理机制对比](#四幻觉处理机制对比)
5. [系统提示词对比](#五系统提示词对比)
6. [错误处理与重试对比](#六错误处理与重试对比)
7. [工具系统对比](#七工具系统对比)
8. [会话与上下文管理对比](#八会话与上下文管理对比)
9. [评分总结](#九评分总结)
10. [结论与建议](#十结论与建议)

---

## 一、执行摘要

### 1.1 项目基本信息

| 维度 | Kimi-CLI | Coding-Agent |
|------|----------|--------------|
| **开发语言** | Python 3.11+ | TypeScript 5.3+ |
| **运行时** | Node.js (via Python) | Node.js 20+ |
| **架构模式** | Soul + Runtime 组合模式 | 协调器模式 (Coordinator) |
| **底层框架** | kosong (自研) | 自研 Agent-v2 |
| **LLM 提供商** | Kimi (Moonshot) | GLM/Kimi/MiniMax |
| **代码行数** | ~15,000 行 | ~8,000 行 |
| **工具数量** | 20+ (含 MCP) | 16+ |

### 1.2 核心差异一览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           核心差异对比                                       │
│                                                                             │
│  Kimi-CLI                          │  Coding-Agent                          │
│  ──────────────────────────────────┼───────────────────────────────────────│
│  • Python 生态                      │  • TypeScript 生态                     │
│  • kosong 抽象层                    │  • 紧凑的单体架构                       │
│  • Wire SPMC 消息系统               │  • EventBus 事件系统                    │
│  • 轻量级幻觉防护                   │  • 多层幻觉检测 + 恢复                   │
│  • 简洁提示词 (~140行)              │  • 详细提示词 (~500行)                   │
│  • MCP 工具集成                     │  • 内置工具注册表                        │
│  • D-Mail 时间旅行机制              │  • 无                                   │
│  • YOLO 自动审批模式                │  • Plan Mode 只读模式                    │
│  • 子代理劳动力市场                 │  • Task 子代理委托                       │
│  • Jinja2 模板提示词                │  • 硬编码提示词                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 二、架构对比

### 2.1 分层架构

#### Kimi-CLI 架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Entry Points                                      │
│        cli/__main__.py  │  app.py  │  web/app.py  │  acp/server.py          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼─────────────────────────────────────────┐
│                            Core Layer                                       │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │  KimiSoul    │    │    Agent     │    │   Runtime    │                  │
│  │  (执行引擎)   │    │  (配置实体)   │    │  (运行时)     │                  │
│  └──────────────┘    └──────────────┘    └──────────────┘                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼─────────────────────────────────────────┐
│                        Infrastructure Layer                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │   Context    │    │    Wire      │    │   Session    │                  │
│  │  (上下文管理) │    │  (事件总线)   │    │  (会话持久化) │                  │
│  └──────────────┘    └──────────────┘    └──────────────┘                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼─────────────────────────────────────────┐
│                        Integration Layer                                    │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │  KimiToolset │    │     LLM      │    │     MCP      │                  │
│  │  (工具管理)   │    │  (模型抽象)   │    │  (外部工具)   │                  │
│  └──────────────┘    └──────────────┘    └──────────────┘                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼─────────────────────────────────────────┐
│                          kosong Library                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │   generate   │    │    step      │    │ ChatProvider │                  │
│  │  (生成流)     │    │  (步骤执行)   │    │  (提供商抽象) │                  │
│  └──────────────┘    └──────────────┘    └──────────────┘                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Coding-Agent 架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           应用层                                            │
│                    CLI / Web UI / API                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼─────────────────────────────────────────┐
│                          Agent 层                                           │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                          Agent (协调器)                                │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │ │
│  │  │  AgentState │  │  LLMCaller  │  │ToolExecutor │  │   Session   │  │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼─────────────────────────────────────────┐
│                         Provider 层                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │ProviderRegistry│  │  HTTPClient  │    │   Adapters   │                  │
│  │  (注册表)      │    │  (请求封装)   │    │  (GLM/Kimi)  │                  │
│  └──────────────┘    └──────────────┘    └──────────────┘                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼─────────────────────────────────────────┐
│                         LLM 服务层                                          │
│           GLM (智谱)  │  Kimi (月之暗面)  │  MiniMax                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 架构模式对比

| 维度 | Kimi-CLI | Coding-Agent |
|------|----------|--------------|
| **设计模式** | 组合模式 + 依赖注入 | 协调器模式 + 事件驱动 |
| **核心抽象** | Soul (执行引擎) + Agent (配置) | Agent (协调器) |
| **消息传递** | Wire (SPMC) | EventBus (发布订阅) |
| **状态管理** | Runtime + Session | AgentState + Session |
| **持久化** | 文件系统 (JSON) | 文件系统/MongoDB (可插拔) |
| **可测试性** | 高 (不可变设计) | 高 (依赖注入 + ITimeProvider) |

### 2.3 设计哲学差异

| 维度 | Kimi-CLI | Coding-Agent |
|------|----------|--------------|
| **复杂度** | 较高 (多层抽象) | 适中 (紧凑架构) |
| **扩展性** | 高 (MCP + Skills) | 中等 (内置工具) |
| **灵活性** | 高 (Jinja2 模板) | 中等 (硬编码) |
| **防御性** | 轻量级 | 重度防御 |

---

## 三、核心组件对比

### 3.1 Agent 核心实现

#### Kimi-CLI Agent 类

```python
@dataclass(frozen=True, slots=True, kw_only=True)
class Agent:
    """The loaded agent."""
    name: str
    system_prompt: str
    toolset: Toolset
    runtime: Runtime
```

**特点**：
- 不可变设计 (`frozen=True`)
- 内存优化 (`slots=True`)
- 清晰的职责分离

#### Coding-Agent Agent 类

```typescript
class Agent {
    private agentState: AgentState;
    private llmCaller: LLMCaller;
    private toolExecutor: ToolExecutor;
    private session: Session;
    private eventBus: EventBus;
    
    async execute(userMessage: string | ContentPart[]): Promise<void>;
    private async runLoop(): Promise<void>;
}
```

**特点**：
- 协调器角色
- 事件驱动通信
- 完整的错误恢复

### 3.2 主循环对比

#### Kimi-CLI 主循环

```python
async def _agent_loop(self) -> TurnOutcome:
    step_no = 0
    while True:
        step_no += 1
        if step_no > max_steps_per_turn:
            raise MaxStepsReached()
        
        # 自动压缩检查
        if should_auto_compact(...):
            await self.compact_context()
        
        # 执行单步
        step_outcome = await self._step()
        
        # 处理 D-Mail (时间旅行)
        if dmail := self._denwa_renji.fetch_pending_dmail():
            raise BackToTheFuture(dmail.checkpoint_id, messages)
        
        if step_outcome is not None:
            return step_outcome
```

#### Coding-Agent 主循环

```typescript
private async runLoop(): Promise<void> {
    while (true) {
        // 1. 检查中止状态
        if (this.agentState.isAborted()) break;

        // 2. 完成检测
        const completion = await evaluateCompletion({...});
        if (completion.done) break;

        // 3. 重试检查
        if (this.agentState.isRetryExceeded()) {
            throw new AgentMaxRetriesExceededError();
        }

        // 4. 循环次数检查
        if (!this.agentState.canContinue()) {
            throw new AgentLoopExceededError();
        }

        // 5. 处理重试
        if (this.agentState.needsRetry()) {
            await this.handleRetry();
        }

        // 6. 执行 LLM 调用
        await this.executeLLMCall(options);
    }
}
```

### 3.3 核心组件映射

| Kimi-CLI | Coding-Agent | 功能 |
|----------|--------------|------|
| `KimiSoul` | `Agent` | 执行引擎/协调器 |
| `Runtime` | `AgentState` + 配置 | 运行时状态 |
| `Context` | `Session` | 上下文管理 |
| `Wire` | `EventBus` | 事件通信 |
| `KimiToolset` | `ToolRegistry` | 工具管理 |
| `kosong.step` | `LLMCaller` | LLM 调用 |
| `Session` | `MemoryManager` | 持久化 |
| `Approval` | Plan Mode | 操作控制 |
| `DenwaRenji` | - | 时间旅行 |

---

## 四、幻觉处理机制对比

### 4.1 防护层次对比

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        幻觉防护层次对比                                      │
│                                                                             │
│  Kimi-CLI                              Coding-Agent                         │
│  ─────────────────────────────────────┼────────────────────────────────────│
│                                       │                                    │
│  第一层：提示词约束 (轻量)              │  第一层：提示词约束 (详细)           │
│  ┌─────────────────────────────┐     │  ┌─────────────────────────────┐   │
│  │ • "avoid hallucination"     │     │  │ • Anti-Hallucination Rules  │   │
│  │ • 依赖模型自觉               │     │  │ • Cognitive Boundaries      │   │
│  │ • 无 Few-shot 示例          │     │  │ • Few-shot Examples         │   │
│  └─────────────────────────────┘     │  └─────────────────────────────┘   │
│                                       │                                    │
│  第二层：工具验证 (基础)               │  第二层：输入验证                    │
│  ┌─────────────────────────────┐     │  ┌─────────────────────────────┐   │
│  │ • 路径验证                   │     │  │ • InputValidator            │   │
│  │ • 文件存在性检查             │     │  │ • 查询长度限制               │   │
│  └─────────────────────────────┘     │  └─────────────────────────────┘   │
│                                       │                                    │
│  第三层：无运行时验证                 │  第三层：响应验证 (运行时)           │
│  ┌─────────────────────────────┐     │  ┌─────────────────────────────┐   │
│  │ • 无                         │     │  │ • ResponseValidator         │   │
│  │ • 依赖模型                   │     │  │ • 重复词检测                 │   │
│  └─────────────────────────────┘     │  │ • 无意义模式检测             │   │
│                                       │  │ • 幻觉高频词检测             │   │
│                                       │  │ • 编码问题检测               │   │
│                                       │  └─────────────────────────────┘   │
│                                       │                                    │
│  第四层：无恢复机制                   │  第四层：响应恢复                    │
│  ┌─────────────────────────────┐     │  ┌─────────────────────────────┐   │
│  │ • 无                         │     │  │ • ResponseRecovery          │   │
│  │ • 直接失败                   │     │  │ • partial / retry / abort   │   │
│  └─────────────────────────────┘     │  │ • 工具调用优先恢复           │   │
│                                       │  │ • 内容质量评分               │   │
│                                       │  └─────────────────────────────┘   │
│                                       │                                    │
│  第五层：无                           │  第五层：工具调用校验                │
│                                       │  ┌─────────────────────────────┐   │
│                                       │  │ • ToolCallValidationError   │   │
│                                       │  │ • Zod Schema 验证           │   │
│                                       │  │ • ToolCallRepairer          │   │
│                                       │  └─────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 幻觉检测能力对比

| 检测维度 | Kimi-CLI | Coding-Agent |
|---------|----------|--------------|
| **重复词检测** | ❌ 无 | ✅ 正则匹配 |
| **无意义模式** | ❌ 无 | ✅ 5种模式 |
| **幻觉词汇** | ❌ 无 | ✅ 高频词列表 |
| **编码问题** | ❌ 无 | ✅ UTF-8 检测 |
| **长度限制** | ❌ 无 | ✅ 50000 字符 |
| **增量验证** | ❌ 无 | ✅ 窗口验证 |

### 4.3 Kimi-CLI 幻觉处理分析

**系统提示词中的唯一反幻觉指令**：

```markdown
# Ultimate Reminders

- Try your best to avoid any hallucination. Do fact checking before 
  providing any factual information.
```

**特点**：
- 单条软性约束
- 依赖模型自觉执行
- 无运行时验证机制

**研究指导中的隐式防护**：

```markdown
# General Guidelines for Research and Data Processing

- Search on the Internet if possible, with carefully-designed search 
  queries to improve efficiency and accuracy.
- Once you generate or edit any images, videos or other media files, 
  try to read it again before proceed, to ensure that the content is 
  as expected.
```

### 4.4 Coding-Agent 幻觉处理分析

**多层检测模式**：

```typescript
// 无意义模式检测
const KNOWN_NONSENSE_PATTERNS = [
    /(\b\w+\b)(\s+\1){4,}/gi,           // 重复单词
    /(.{5,50})\1{3,}/g,                  // 重复短语
    /([a-zA-Z])\1{10,}/g,                // 重复字母
    /[.,!?;:]{20,}/g,                    // 重复标点
    /\b(Alpha|Daemon|Gamma|Beta|Omega|Lambda)\b.../gi,  // 幻觉词汇
];

// 恢复策略
type RecoveryStrategy = 'partial' | 'retry' | 'abort';
```

**响应恢复流程**：

```
验证失败
    │
    ├── 有完整工具调用 → partial 策略 (保留工具调用)
    │
    ├── 内容质量 >= 0.3 → partial 策略 (保留部分内容)
    │
    ├── 可能通过压缩恢复 → retry 策略 (压缩上下文后重试)
    │
    └── 无法恢复 → abort 策略 (中止)
```

### 4.5 幻觉处理评分

| 维度 | Kimi-CLI | Coding-Agent |
|------|----------|--------------|
| **提示词约束** | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| **输入验证** | ⭐⭐ | ⭐⭐⭐⭐ |
| **运行时验证** | ⭐ | ⭐⭐⭐⭐⭐ |
| **恢复机制** | ⭐ | ⭐⭐⭐⭐ |
| **工具验证** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **综合评分** | **2.0/5** | **4.4/5** |

---

## 五、系统提示词对比

### 5.1 结构对比

#### Kimi-CLI 提示词结构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Kimi-CLI 系统提示词 (~140行)                          │
│                                                                             │
│  1. 角色定义 (5行)                                                          │
│     "You are Kimi Code CLI..."                                             │
│                                                                             │
│  2. 提示与工具使用 (20行)                                                   │
│     • 工具调用规范                                                          │
│     • 并行调用建议                                                          │
│                                                                             │
│  3. 编码指南 (25行)                                                         │
│     • 从零构建规范                                                          │
│     • 现有代码修改规范                                                      │
│                                                                             │
│  4. 研究与数据处理 (15行)                                                   │
│     • 搜索指导                                                              │
│     • 多媒体处理                                                            │
│                                                                             │
│  5. 工作环境 (20行)                                                         │
│     • 操作系统、日期时间                                                    │
│     • 工作目录                                                              │
│                                                                             │
│  6. 项目信息 (25行)                                                         │
│     • AGENTS.md 机制                                                        │
│                                                                             │
│  7. Skills 技能系统 (20行)                                                  │
│     • 技能发现与使用                                                        │
│                                                                             │
│  8. Ultimate Reminders (10行)                                               │
│     • 核心行为约束                                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Coding-Agent 提示词结构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Coding-Agent 系统提示词 (~500行)                        │
│                                                                             │
│  1. 身份定义 (10行)                                                         │
│     • 名称、角色、语言约束                                                  │
│                                                                             │
│  2. Primary Objective (5行)                                                 │
│     • 正确、可执行的结果                                                    │
│     • 验证事实优于流利猜测                                                  │
│                                                                             │
│  3. Anti-Hallucination Rules (15行)                                         │
│     • 不声称未观察到的内容                                                  │
│     • 不编造路径/API/堆栈                                                   │
│     • 明确说明不确定                                                        │
│     • 分离事实与推断                                                        │
│                                                                             │
│  4. Cognitive Boundaries (10行)                                             │
│     • 仅基于上下文和工具输出                                                │
│     • 无工具无法检查用户机器                                                │
│     • 缺失上下文时说明差距                                                  │
│                                                                             │
│  5. Communication Style (10行)                                              │
│     • 简洁、直接、技术精确                                                  │
│     • GitHub Markdown                                                       │
│                                                                             │
│  6. Professional Objectivity (5行)                                          │
│     • 真相优于同意                                                          │
│     • 挑战薄弱假设                                                          │
│                                                                             │
│  7. Tool Contract (Strict) (20行)                                           │
│     • 仅运行时工具名                                                        │
│     • 精确参数名                                                            │
│     • 工具快速映射表                                                        │
│                                                                             │
│  8. Response Examples (Few-shot) (10行)                                     │
│     • Bad vs Good 示例                                                      │
│                                                                             │
│  9. Task Management & Subagent Usage (50行)                                 │
│     • 复杂任务升级                                                          │
│     • 状态工作流                                                            │
│                                                                             │
│  10. Error Handling (10行)                                                  │
│      • 报告确切错误 + 下一步                                                │
│      • 不静默重试                                                           │
│                                                                             │
│  11. Anti-Repetition Rules (CRITICAL) (15行)                                │
│      • 不重复调用相同参数                                                   │
│      • 卡住检测：3次相同动作 → 升级                                         │
│                                                                             │
│  12. File Modification Best Practices (30行)                                │
│      • batch_replace > precise_replace > write_file                         │
│      • 恢复工作流                                                           │
│                                                                             │
│  13. Security & Privacy Boundaries (15行)                                   │
│      • 最小化敏感数据暴露                                                   │
│      • 提示注入防御                                                         │
│                                                                             │
│  14. Git Safety (15行)                                                      │
│      • 不更新 git config                                                    │
│      • 不强制推送到 main/master                                             │
│      • 不自动提交                                                           │
│                                                                             │
│  15. Completion Safety (5行)                                                │
│      • 不以空响应结束                                                       │
│      • 约束满足前不声称完成                                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 关键约束对比

| 约束类型 | Kimi-CLI | Coding-Agent |
|---------|----------|--------------|
| **反幻觉** | 1 条软约束 | 详细规则 + Few-shot |
| **认知边界** | 隐含 | 独立章节明确 |
| **工具契约** | 简要说明 | 严格定义 + 快速映射 |
| **错误处理** | 隐含 | 明确策略 |
| **防重复** | 无 | 关键规则 + 卡住检测 |
| **完成安全** | 无 | 独立章节 |
| **Git 安全** | 需确认 | 详细禁止列表 |
| **文件修改** | 无指导 | 详细最佳实践 |

### 5.3 提示词模板机制对比

#### Kimi-CLI (Jinja2 模板)

```python
@dataclass(frozen=True, slots=True, kw_only=True)
class BuiltinSystemPromptArgs:
    KIMI_NOW: str           # 当前日期时间
    KIMI_WORK_DIR: KaosPath # 工作目录
    KIMI_WORK_DIR_LS: str   # 目录列表
    KIMI_AGENTS_MD: str     # AGENTS.md 内容
    KIMI_SKILLS: str        # 可用技能
```

```markdown
# system.md
Today's date and time: {{ KIMI_NOW }}
Working directory: {{ KIMI_WORK_DIR }}
{% if KIMI_AGENTS_MD %}
# Project Context (from AGENTS.md)
{{ KIMI_AGENTS_MD }}
{% endif %}
```

#### Coding-Agent (硬编码)

```typescript
export const operatorPrompt = ({ directory, language, planMode }): string => {
    return `
Working directory: ${directory}
Platform: ${process.platform}
Today's date: ${date}

${fs.readFileSync('CLAUDE.md')}
`;
};
```

### 5.4 提示词评分

| 维度 | Kimi-CLI | Coding-Agent |
|------|----------|--------------|
| **结构清晰度** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **约束完整性** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **示例指导** | ⭐⭐ | ⭐⭐⭐⭐ |
| **模板灵活性** | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| **安全约束** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **综合评分** | **3.6/5** | **4.6/5** |

---

## 六、错误处理与重试对比

### 6.1 错误分类对比

#### Kimi-CLI 错误分类

```python
@staticmethod
def _is_retryable_error(exception: BaseException) -> bool:
    if isinstance(exception, (APIConnectionError, APITimeoutError)):
        return not bool(getattr(exception, "_kimi_recovery_exhausted", False))
    if isinstance(exception, APIEmptyResponseError):
        return True
    return isinstance(exception, APIStatusError) and exception.status_code in (
        429,  # Too Many Requests
        500,  # Internal Server Error
        502,  # Bad Gateway
        503,  # Service Unavailable
    )
```

**可重试错误**：
- `APIConnectionError` - 连接错误
- `APITimeoutError` - 超时错误
- `APIEmptyResponseError` - 空响应
- `APIStatusError` (429, 500, 502, 503) - 服务端错误

#### Coding-Agent 错误分类

```
AgentError (基类)
├── AgentAbortedError       # 任务被中止
├── AgentBusyError          # Agent 忙碌
├── AgentMaxRetriesExceededError  # 超过最大重试次数
├── AgentLoopExceededError  # 超过最大循环次数
├── AgentConfigurationError # 配置错误
├── AgentValidationError    # 验证错误
├── LLMRequestError        # LLM 请求错误
├── LLMResponseInvalidError # LLM 响应无效
└── LLMRetryableError      # 可重试错误
    └── LLMRateLimitError  # 速率限制

Provider 层错误
├── LLMRetryableError      # 可重试
├── LLMPermanentError      # 永久性
│   ├── LLMAuthError
│   ├── LLMNotFoundError
│   └── LLMBadRequestError
└── LLMAbortedError        # 被取消
```

### 6.2 重试策略对比

| 维度 | Kimi-CLI | Coding-Agent |
|------|----------|--------------|
| **重试框架** | tenacity | 自研 |
| **退避策略** | 指数退避 + 抖动 | 固定/自适应 |
| **最大重试** | 3 次/步骤 | 20 次/会话 |
| **最大循环** | 100 步/轮 | 3000 次/会话 |
| **连接恢复** | ✅ RetryableChatProvider | ✅ 连接恢复 |

#### Kimi-CLI 重试配置

```python
@tenacity.retry(
    retry=retry_if_exception(self._is_retryable_error),
    wait=wait_exponential_jitter(initial=0.3, max=5, jitter=0.5),
    stop=stop_after_attempt(self._loop_control.max_retries_per_step),
    reraise=True,
)
async def _kosong_step_with_retry() -> StepResult:
    ...
```

#### Coding-Agent 重试配置

```typescript
const AGENT_DEFAULTS = {
    LOOP_MAX: 3000,           // 最大循环次数
    MAX_RETRIES: 20,          // 最大重试次数
    RETRY_DELAY_MS: 10000,    // 默认重试延迟 10 秒
    IDLE_TIMEOUT_MS: 180000,  // 空闲超时 3 分钟
};
```

### 6.3 特殊恢复机制

#### Kimi-CLI: D-Mail 时间旅行

```python
class DenwaRenji:
    def send_dmail(self, dmail: DMail):
        """发送 D-Mail 到指定检查点"""
        self._pending_dmail = dmail

# 主循环中处理
if dmail := self._denwa_renji.fetch_pending_dmail():
    raise BackToTheFuture(dmail.checkpoint_id, messages)

# 捕获并回滚
except BackToTheFuture as e:
    await self._context.revert_to(e.checkpoint_id)
    await self._context.append_message(e.messages)
```

#### Coding-Agent: 响应恢复

```typescript
class ResponseRecovery {
    attemptRecovery(context: RecoveryContext): RecoveryResult {
        // 1. 优先使用完整工具调用
        if (completeToolCalls.length > 0) {
            return { strategy: 'partial', partialResponse };
        }
        
        // 2. 评估内容质量
        const qualityScore = this.evaluateContentQuality(content);
        if (qualityScore >= 0.3) {
            return { strategy: 'partial', partialResponse };
        }
        
        // 3. 建议压缩后重试
        if (this.shouldRetryWithCompaction(context)) {
            return { strategy: 'retry', needsCompaction: true };
        }
        
        // 4. 无法恢复
        return { strategy: 'abort', error };
    }
}
```

### 6.4 错误处理评分

| 维度 | Kimi-CLI | Coding-Agent |
|------|----------|--------------|
| **错误分类** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **重试策略** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **恢复机制** | ⭐⭐⭐⭐ (D-Mail) | ⭐⭐⭐⭐ (响应恢复) |
| **超时控制** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **综合评分** | **3.5/5** | **4.5/5** |

---

## 七、工具系统对比

### 7.1 工具注册对比

#### Kimi-CLI: KimiToolset

```python
class KimiToolset:
    def __init__(self):
        self._tool_dict: dict[str, ToolType] = {}
        self._hidden_tools: set[str] = set()
        self._mcp_servers: dict[str, MCPServerInfo] = {}
    
    def load_tools(self, tool_paths: list[str], dependencies: dict):
        for tool_path in tool_paths:
            tool = self._load_tool(tool_path, dependencies)
            self.add(tool)
    
    async def load_mcp_tools(self, mcp_configs: list[MCPConfig]):
        # 动态加载 MCP 工具
```

#### Coding-Agent: ToolRegistry

```typescript
class ToolRegistry {
    private tools: Map<string, BaseTool<z.ZodType>> = new Map();
    private toolTimeout: number = 300000;
    
    register(tools: BaseTool<z.ZodType>[]): void;
    validateToolCalls(toolCalls: ToolCall[]): void;
    async execute(toolCalls: ToolCall[], context?: ExecutionContext): Promise<ToolExecutionResult[]>;
    toLLMTools(): Array<ToolSchema>;
}
```

### 7.2 工具对比表

| 工具类型 | Kimi-CLI | Coding-Agent |
|---------|----------|--------------|
| **文件读取** | Read | read_file |
| **文件写入** | Write | write_file |
| **精确编辑** | Edit | precise_replace, batch_replace |
| **文件搜索** | Glob | glob |
| **内容搜索** | Grep | grep |
| **命令执行** | Shell | bash |
| **网络搜索** | WebSearch | web_search |
| **网页抓取** | WebFetch | web_fetch |
| **LSP** | - | lsp |
| **子代理** | Task (multiagent) | task, task_* |
| **技能** | Skills | skill |
| **MCP** | ✅ 支持 | ❌ 不支持 |
| **Plan Mode** | - | plan_create |

### 7.3 审批/控制机制对比

#### Kimi-CLI: Approval + YOLO

```python
class Approval:
    async def request(self, sender: str, action: str, description: str) -> bool:
        # YOLO 模式自动批准
        if self._state.yolo:
            return True
        
        # 已自动批准的动作
        if action in self._state.auto_approve_actions:
            return True
        
        # 发送审批请求
        request = ApprovalRequest(...)
        return await approved_future
```

#### Coding-Agent: Plan Mode

```typescript
// 白名单：允许的只读工具
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
    'read_file', 'glob', 'grep', 'lsp',
    'web_search', 'web_fetch',
    'plan_create', 'task', 'task_*', 'skill',
]);

// 黑名单：禁止的写操作
export const BLOCKED_TOOL_PATTERNS: readonly RegExp[] = [
    /^write_file$/, /^precise_replace$/, /^batch_replace$/, /^bash$/,
];
```

### 7.4 工具系统评分

| 维度 | Kimi-CLI | Coding-Agent |
|------|----------|--------------|
| **工具数量** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **扩展性 (MCP)** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **验证机制** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **超时控制** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **综合评分** | **4.25/5** | **4.25/5** |

---

## 八、会话与上下文管理对比

### 8.1 会话管理对比

#### Kimi-CLI Session

```python
@dataclass(slots=True, kw_only=True)
class Session:
    id: str
    work_dir: KaosPath
    context_file: Path
    wire_file: WireFile
    state: SessionState
    title: str
    updated_at: float
```

#### Coding-Agent Session

```typescript
class Session {
    private messages: Message[] = [];
    private readonly compaction?: Compaction;
    private readonly memoryManager?: IMemoryManager;
    
    async initialize(): Promise<void>;
    addMessage(message: Message): string;
    getMessages(): Message[];
    async compactBeforeLLMCall(): Promise<boolean>;
    async sync(): Promise<void>;
}
```

### 8.2 上下文压缩对比

| 维度 | Kimi-CLI | Coding-Agent |
|------|----------|--------------|
| **触发阈值** | 85% | 90% |
| **保留消息** | 动态 | 40 条 |
| **摘要结构** | 6 部分 | 8 部分 |
| **LLM 压缩** | ✅ | ✅ |

#### Kimi-CLI 压缩

```python
def should_auto_compact(token_count, max_context_size, trigger_ratio, reserved_context_size):
    return (
        token_count >= max_context_size * trigger_ratio  # 85%
        or token_count + reserved_context_size >= max_context_size
    )
```

#### Coding-Agent 压缩

```typescript
export class Compaction {
    private readonly triggerRatio: number = 0.9;  // 90%
    private readonly keepMessagesNum: number = 40;
    
    async compact(messages: Message[], ...): Promise<CompactionResult>;
}
```

### 8.3 持久化对比

| 维度 | Kimi-CLI | Coding-Agent |
|------|----------|--------------|
| **存储后端** | 文件系统 | 文件系统 / MongoDB / 混合 |
| **存储格式** | JSON | JSON |
| **异步持久化** | ✅ | ✅ (队列) |
| **压缩记录** | ❌ | ✅ |

### 8.4 上下文管理评分

| 维度 | Kimi-CLI | Coding-Agent |
|------|----------|--------------|
| **会话管理** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **压缩机制** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **持久化** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **综合评分** | **3.67/5** | **4.33/5** |

---

## 九、评分总结

### 9.1 综合评分

| 维度 | Kimi-CLI | Coding-Agent | 优势方 |
|------|----------|--------------|--------|
| **架构设计** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 平局 |
| **幻觉处理** | ⭐⭐ | ⭐⭐⭐⭐⭐ | Coding-Agent |
| **系统提示词** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Coding-Agent |
| **错误处理** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Coding-Agent |
| **工具系统** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Kimi-CLI |
| **会话管理** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 平局 |
| **扩展性** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | Kimi-CLI |
| **安全性** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Coding-Agent |
| **总分** | **28/40** | **33/40** | **Coding-Agent** |

### 9.2 优势分析

#### Kimi-CLI 优势

1. **MCP 工具集成** - 支持外部工具协议，扩展性强
2. **Skills 系统** - 动态技能发现和加载
3. **D-Mail 时间旅行** - 独特的上下文回滚机制
4. **Jinja2 模板** - 灵活的提示词模板系统
5. **YOLO 模式** - 自动审批加速工作流

#### Coding-Agent 优势

1. **多层幻觉检测** - 提示词 + 运行时验证 + 恢复机制
2. **详细系统提示词** - 完整的约束和 Few-shot 示例
3. **错误分类体系** - 细粒度错误类型和恢复策略
4. **响应恢复机制** - partial/retry/abort 三级策略
5. **可插拔存储** - 文件系统/MongoDB/混合存储

---

## 十、结论与建议

### 10.1 核心结论

#### 幻觉处理

| 项目 | 策略 | 效果评估 |
|------|------|---------|
| **Kimi-CLI** | 依赖模型自觉 + 工具层验证 | 轻量级，依赖 LLM 能力 |
| **Coding-Agent** | 多层防御 + 运行时验证 + 恢复机制 | 重度防御，主动检测 |

**结论**: Coding-Agent 在幻觉处理方面更成熟，提供了完整的检测-验证-恢复链路。

#### 系统提示词

| 项目 | 特点 | 适用场景 |
|------|------|---------|
| **Kimi-CLI** | 简洁 (~140行)，模板化 | 依赖模型能力，快速迭代 |
| **Coding-Agent** | 详细 (~500行)，结构化 | 强约束场景，安全要求高 |

**结论**: Coding-Agent 的系统提示词更完善，特别是 Anti-Hallucination Rules 和 Few-shot 示例。但 Kimi-CLI 的模板化设计更灵活。

### 10.2 互相借鉴建议

#### Kimi-CLI 可借鉴 Coding-Agent

1. **增加运行时幻觉检测**
   ```python
   class ResponseValidator:
       NONSENSE_PATTERNS = [...]
       def validate(self, content: str) -> ValidationResult:
           # 检测重复词、无意义模式等
   ```

2. **增强系统提示词**
   - 添加 Anti-Hallucination Rules 专门章节
   - 增加 Few-shot 示例
   - 明确 Cognitive Boundaries

3. **实现响应恢复机制**
   ```python
   class ResponseRecovery:
       def attempt_recovery(self, context) -> RecoveryResult:
           # partial / retry / abort 策略
   ```

#### Coding-Agent 可借鉴 Kimi-CLI

1. **实现 MCP 工具协议**
   ```typescript
   interface MCPServer {
       list_tools(): Promise<Tool[]>;
       call_tool(name: string, args: any): Promise<any>;
   }
   ```

2. **采用模板化提示词**
   ```typescript
   class PromptLoader {
       async load(template: string, args: Record<string, string>): Promise<string> {
           // Jinja2 风格模板渲染
       }
   }
   ```

3. **实现 D-Mail 时间旅行**
   ```typescript
   class TimeTravel {
       send_dmail(checkpoint_id: number, messages: Message[]): void;
       fetch_pending_dmail(): DMail | null;
   }
   ```

4. **添加 Skills 系统**
   ```typescript
   class SkillManager {
       async discover_skills(roots: string[]): Promise<Skill[]>;
       async load_skill(name: string): Promise<Skill>;
   }
   ```

### 10.3 最终评价

| 项目 | 推荐场景 |
|------|---------|
| **Kimi-CLI** | 需要高扩展性、MCP 集成、灵活模板的场景 |
| **Coding-Agent** | 需要强约束、高安全性、防幻觉的场景 |

**综合推荐**: 

- 如果追求 **稳定性和安全性**，选择 **Coding-Agent**
- 如果追求 **灵活性和扩展性**，选择 **Kimi-CLI**
- 最佳方案是 **融合两者优点**: Kimi-CLI 的架构 + Coding-Agent 的幻觉处理

---

## 附录：关键文件路径

### Kimi-CLI 关键文件

| 功能 | 文件路径 |
|------|---------|
| Agent 定义 | `src/kimi_cli/soul/agent.py` |
| 主循环实现 | `src/kimi_cli/soul/kimisoul.py` |
| 工具集管理 | `src/kimi_cli/soul/toolset.py` |
| 上下文管理 | `src/kimi_cli/soul/context.py` |
| Wire 事件系统 | `src/kimi_cli/wire/__init__.py` |
| 系统提示词 | `src/kimi_cli/agents/default/system.md` |
| 上下文压缩 | `src/kimi_cli/soul/compaction.py` |
| 审批机制 | `src/kimi_cli/soul/approval.py` |

### Coding-Agent 关键文件

| 功能 | 文件路径 |
|------|---------|
| Agent 协调器 | `src/agent-v2/agent/agent.ts` |
| 响应验证器 | `src/agent-v2/agent/response-validator.ts` |
| 响应恢复 | `src/agent-v2/agent/core/response-recovery.ts` |
| 错误分类器 | `src/agent-v2/agent/error-classifier.ts` |
| 工具注册表 | `src/agent-v2/tool/registry.ts` |
| 会话管理 | `src/agent-v2/session/index.ts` |
| 上下文压缩 | `src/agent-v2/session/compaction.ts` |
| 系统提示词 | `src/agent-v2/prompts/system.ts` |
| 安全模块 | `src/agent-v2/security/index.ts` |

---

**报告完成** ✅
