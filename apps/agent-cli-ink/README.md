# agent-cli-ink

基于 React + Ink 的终端 AI Agent 交互界面。

## 特性

- **流式输出**：实时展示 AI 响应
- **斜杠命令**：支持 `/help`, `/clear`, `/reset`, `/pause`, `/resume`, `/abort`, `/exit`, `/prune`
- **键盘快捷键**：
  - `Ctrl+S`：暂停输出
  - `Ctrl+Q`：恢复输出
  - `Esc`：中止当前任务
- **代码差异高亮**：直观展示代码变更
- **工具调用可视化**：展示工具执行过程和结果

## 快速开始

### 开发模式

```bash
npm run dev
```

### 构建生产版本

```bash
npm run build
```

### 运行构建产物

```bash
npm start
```

## CLI 参数

```bash
agent-cli-ink [options]
```

| 参数 | 描述 |
|------|------|
| `--model <name>` | 指定使用的模型 |
| `--cwd <path>` | 工作目录 |
| `--language <lang>` | 语言设置 |
| `--keep` | 保留会话状态 |

## 项目结构

```
agent-cli-ink/
├── src/
│   ├── index.tsx              # CLI 入口
│   ├── app.tsx                # 主应用组件
│   ├── types.ts               # 类型定义
│   ├── agent-chat-react/      # 状态管理
│   │   ├── index.ts
│   │   ├── context.tsx        # React Context
│   │   ├── types.ts           # UI 消息类型
│   │   ├── use-agent-chat.ts  # Hook
│   │   ├── reducer.ts         # 状态 Reducer
│   │   ├── reducer-helpers.ts # 辅助函数
│   │   └── selectors.ts       # 选择器
│   ├── commands/              # 命令路由
│   │   └── router.ts          # 斜杠命令解析
│   ├── components/            # UI 组件
│   │   ├── composer.tsx       # 输入框
│   │   ├── timeline.tsx       # 时间线容器
│   │   ├── timeline-item.tsx  # 时间线条目
│   │   ├── status-bar.tsx     # 状态栏
│   │   └── spinner.tsx        # 加载动画
│   └── runtime/               # 运行时集成
│       └── use-agent-runtime.ts
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

## 架构设计

### 数据流

```
用户输入 → Composer → useAgentRuntime → Agent-V2
                                    ↓
                              消息转换
                                    ↓
                              Timeline 渲染
```

### 状态管理

采用 Redux 风格的 Reducer + Context 模式：

- **AgentChatProvider**：全局状态提供者
- **useAgentChat**：状态 Hook
- **reducer.ts**：状态更新逻辑
- **selectors.ts**：状态选择器

### 消息类型

| 类型 | 描述 |
|------|------|
| `user` | 用户输入消息 |
| `assistant` | AI 响应消息 |
| `tool` | 工具调用信息 |
| `code_patch` | 代码差异 |
| `error` | 错误信息 |
| `system` | 系统通知 |

## 技术栈

- **UI Framework**: React 19 + Ink
- **Language**: TypeScript
- **Build Tool**: tsup
- **Runtime**: Node.js (ESM)

## 开发

### 类型检查

```bash
npm run typecheck
```

### 环境变量

支持 `.env.development` 配置。

## 许可证

MIT
