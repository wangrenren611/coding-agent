# MCP 使用指南

## 概述

Coding Agent 已经集成了 MCP (Model Context Protocol) 支持，可以使用外部 MCP 服务器提供的工具。

## 配置步骤

### 1. 创建 MCP 配置文件

在项目根目录创建 `.mcp.json` 文件：

```json
{
  "$schema": "https://github.com/modelcontextprotocol/spec/blob/main/schema/schema.json",
  "mcpServers": [
    {
      "name": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "description": "文件系统工具",
      "timeout": 120000
    }
  ]
}
```

### 2. 配置文件格式说明

#### 标准格式（推荐）

```json
{
  "mcpServers": [
    {
      "name": "服务器名称",
      "command": "启动命令",
      "args": ["参数 1", "参数 2"],
      "env": {
        "环境变量名": "值"
      },
      "timeout": 120000,
      "disabled": false
    }
  ]
}
```

#### Claude Desktop/Cursor 格式

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "your_token"
      }
    }
  }
}
```

### 3. 常用 MCP 服务器

#### 文件系统服务器

```json
{
  "name": "filesystem",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/files"]
}
```

#### GitHub 服务器

```json
{
  "name": "github",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": {
    "GITHUB_TOKEN": "your_github_token"
  }
}
```

#### 浏览器 DevTools 服务器

```json
{
  "name": "chrome-devtools",
  "command": "npx",
  "args": ["-y", "chrome-devtools-mcp@latest"]
}
```

#### PostgreSQL 数据库服务器

```json
{
  "name": "postgres",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/mydb"],
  "env": {
    "DATABASE_URL": "postgresql://localhost/mydb"
  }
}
```

### 4. 在 Agent 中使用

#### 默认启用 MCP

```typescript
import { Agent } from './src/agent-v2/agent/agent';
import { createProvider } from './providers';

const provider = createProvider({ name: 'kimi' });

const agent = new Agent({
  provider,
  // enableMcp: true,  // 默认启用，不需要设置
});

// MCP 工具会自动注册，LLM 可以直接调用
await agent.execute('帮我查看一下当前目录的文件结构');
```

#### 禁用 MCP

```typescript
const agent = new Agent({
  provider,
  enableMcp: false,  // 禁用 MCP
});
```

### 5. 验证 MCP 是否工作

#### 查看日志输出

Agent 会在初始化时输出 MCP 连接信息：

```
[Agent] Initializing MCP...
[MCP] Loading config { path: 'D:\\work\\coding-agent\\.mcp.json' }
[MCP] Config loaded { totalServers: 1, enabledServers: 1 }
[MCP] Connecting to server { serverName: 'filesystem' }
[MCP] Tools registered { serverName: 'filesystem', toolCount: 5 }
[Agent] MCP initialized {
  connectedServers: ['filesystem'],
  totalTools: 5,
  connections: [...]
}
```

#### 检查可用工具

```typescript
import { createDefaultToolRegistry } from './src/agent-v2/tool';
import { McpManager } from './src/agent-v2/mcp/manager';

async function checkMcpTools() {
  const toolRegistry = createDefaultToolRegistry({
    workingDirectory: process.cwd(),
  });

  // 初始化 MCP
  const manager = await McpManager.getInstance().initialize({ toolRegistry });

  // 获取所有工具
  const allTools = toolRegistry.toLLMTools();
  console.log('总工具数量:', allTools.length);

  // 获取 MCP 工具
  const mcpTools = allTools.filter(t => t.function.name.includes('_'));
  console.log('MCP 工具数量:', mcpTools.length);
  console.log('MCP 工具列表:', mcpTools.map(t => t.function.name));

  // 断开连接
  await manager.disconnectAll();
}
```

### 6. 常见问题

#### Q: MCP 服务器连接失败

**检查项：**
1. 确认 `.mcp.json` 文件存在且格式正确
2. 确认 `disabled: false` 或移除该字段
3. 确认网络可以访问 npm 仓库
4. 检查防火墙设置

#### Q: MCP 工具没有被注册

**检查项：**
1. 查看日志中的 `[MCP] Tools registered` 消息
2. 确认 MCP 服务器成功启动
3. 检查 MCP 服务器是否提供了有效的工具列表

#### Q: 如何禁用某个 MCP 服务器

在配置中设置 `disabled: true`：

```json
{
  "name": "chrome-devtools",
  "command": "npx",
  "args": ["-y", "chrome-devtools-mcp@latest"],
  "disabled": true
}
```

### 7. 配置文件搜索路径

MCP 配置文件会按以下顺序搜索：

1. `.mcp.json`
2. `mcp.json`
3. `.mcp/config.json`
4. `.claude/mcp.json`
5. `.config/mcp.json`

### 8. 环境变量支持

配置文件中支持使用环境变量：

```json
{
  "name": "github",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": {
    "GITHUB_TOKEN": "${GITHUB_TOKEN}",
    "API_KEY": "${API_KEY:-default_value}"
  }
}
```

- `${VAR_NAME}` - 使用环境变量
- `${VAR_NAME:-default}` - 使用默认值

## 示例配置

### 完整示例

```json
{
  "mcpServers": [
    {
      "name": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "timeout": 120000
    },
    {
      "name": "github",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      },
      "timeout": 120000
    },
    {
      "name": "chrome-devtools",
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"],
      "disabled": true
    }
  ]
}
```

## 注意事项

1. **首次启动较慢**：MCP 服务器首次启动时需要下载依赖，可能需要较长时间
2. **资源占用**：每个 MCP 服务器会占用一个独立进程
3. **超时设置**：建议设置合理的 `timeout` 值（默认 120000ms）
4. **安全性**：不要在配置文件中明文存储敏感信息，使用环境变量
