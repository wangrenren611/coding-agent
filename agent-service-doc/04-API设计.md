# 企业级 Agent 服务端 - API 设计

> 版本: 1.0.0
> 最后更新: 2026-03-04
> 作者: Claude

---

## 1. API 概述

### 1.1 设计原则

| 原则 | 描述 |
|------|------|
| **RESTful** | 遵循 REST 设计风格 |
| **版本化** | 使用 URL 版本控制 (v1) |
| **安全** | 所有 API 需要认证 |
| **一致** | 统一的请求/响应格式 |
| **可扩展** | 支持分页、过滤、排序 |

### 1.2 Base URL

```
生产环境: https://api.agent-service.com/v1
测试环境: https://api-staging.agent-service.com/v1
开发环境: http://localhost:3000/v1
```

### 1.3 认证方式

| 方式 | Header | 用途 |
|------|--------|------|
| API Key | `X-API-Key: sk_xxxx` | 服务间调用 |
| JWT | `Authorization: Bearer <token>` | 用户/客户端调用 |

---

## 2. 通用规范

### 2.1 请求头

```
Content-Type: application/json
Accept: application/json
X-API-Key: <your-api-key>
Authorization: Bearer <jwt-token>
X-Request-ID: <uuid>           # 可选，用于追踪
X-Correlation-ID: <uuid>       # 可选，用于关联日志
```

### 2.2 响应格式

#### 成功响应

```json
{
  "success": true,
  "data": { ... },
  "requestId": "req_abc123",
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

#### 分页响应

```json
{
  "success": true,
  "data": {
    "items": [...],
    "pagination": {
      "total": 100,
      "limit": 20,
      "offset": 0,
      "hasMore": true
    }
  },
  "requestId": "req_abc123",
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

#### 错误响应

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Session not found",
    "details": {
      "sessionId": "sess_xxx"
    }
  },
  "requestId": "req_abc123",
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

### 2.3 错误码

> **说明**: 错误码遵循术语表规范，采用 `{前缀}_{具体错误}` 的格式。

| 分类 | 错误码 | HTTP 状态码 | 描述 |
|------|--------|-------------|------|
| **认证** | `AUTH_UNAUTHORIZED` | 401 | 未认证 |
| **认证** | `AUTH_INVALID_TOKEN` | 401 | Token 无效 |
| **认证** | `AUTH_TOKEN_EXPIRED` | 401 | Token 已过期 |
| **权限** | `AUTH_FORBIDDEN` | 403 | 无权限 |
| **权限** | `AUTH_INSUFFICIENT_PERMISSION` | 403 | 权限不足 |
| **配额** | `QUOTA_EXCEEDED` | 429 | 配额超限 |
| **限流** | `RATE_LIMITED` | 429 | 请求过于频繁 |
| **资源** | `SESSION_NOT_FOUND` | 404 | 会话不存在 |
| **资源** | `MESSAGE_NOT_FOUND` | 404 | 消息不存在 |
| **验证** | `VALIDATION_ERROR` | 400 | 请求参数错误 |
| **业务** | `SESSION_INVALID_OPERATION` | 400 | 操作无效 |
| **服务器** | `INTERNAL_ERROR` | 500 | 服务器内部错误 |

---

## 3. 会话管理 API

### 3.1 创建会话

```
POST /sessions
```

**请求体:**

```json
{
  "systemPrompt": "You are a helpful AI assistant.",
  "model": "gpt-4",
  "tools": ["read_file", "bash", "grep"],
  "temperature": 0.7,
  "maxTokens": 4096,
  "metadata": {
    "customField": "value"
  },
  "expiresIn": 86400
}
```

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `systemPrompt` | string | 是 | 系统提示词 |
| `model` | string | 否 | 模型名称 (默认: gpt-4) |
| `tools` | string[] | 否 | 启用的工具列表 |
| `temperature` | number | 否 | 温度参数 (0-2) |
| `maxTokens` | number | 否 | 最大输出 Token |
| `metadata` | object | 否 | 自定义元数据 |
| `expiresIn` | number | 否 | 过期秒数 (可选) |

**响应 (201 Created):**

```json
{
  "success": true,
  "data": {
    "id": "sess_abc123",
    "status": "active",
    "config": {
      "systemPrompt": "You are a helpful AI assistant.",
      "model": "gpt-4",
      "tools": ["read_file", "bash", "grep"],
      "temperature": 0.7,
      "maxTokens": 4096
    },
    "usage": {
      "promptTokens": 0,
      "completionTokens": 0,
      "totalTokens": 0,
      "requestCount": 0
    },
    "createdAt": "2026-03-04T10:00:00.000Z",
    "updatedAt": "2026-03-04T10:00:00.000Z",
    "lastActiveAt": "2026-03-04T10:00:00.000Z",
    "expiresAt": "2026-03-05T10:00:00.000Z"
  },
  "requestId": "req_abc123",
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

### 3.2 获取会话

```
GET /sessions/:sessionId
```

**响应 (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "sess_abc123",
    "status": "active",
    "config": {
      "systemPrompt": "You are a helpful AI assistant.",
      "model": "gpt-4",
      "tools": ["read_file", "bash", "grep"],
      "temperature": 0.7,
      "maxTokens": 4096
    },
    "usage": {
      "promptTokens": 1500,
      "completionTokens": 500,
      "totalTokens": 2000,
      "requestCount": 10
    },
    "createdAt": "2026-03-04T10:00:00.000Z",
    "updatedAt": "2026-03-04T10:05:00.000Z",
    "lastActiveAt": "2026-03-04T10:05:00.000Z"
  },
  "requestId": "req_abc123",
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

### 3.3 更新会话

```
PATCH /sessions/:sessionId
```

**请求体:**

```json
{
  "systemPrompt": "You are a coding assistant.",
  "model": "gpt-4-turbo",
  "tools": ["read_file", "bash", "grep", "glob"],
  "temperature": 0.5,
  "maxTokens": 2048,
  "metadata": {
    "project": "my-project"
  }
}
```

**响应 (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "sess_abc123",
    "status": "active",
    "config": {
      "systemPrompt": "You are a coding assistant.",
      "model": "gpt-4-turbo",
      "tools": ["read_file", "bash", "grep", "glob"],
      "temperature": 0.5,
      "maxTokens": 2048
    },
    "updatedAt": "2026-03-04T10:10:00.000Z"
  },
  "requestId": "req_abc123",
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

### 3.4 删除会话

```
DELETE /sessions/:sessionId
```

**响应 (204 No Content)**

### 3.5 列出会话

```
GET /sessions
```

**查询参数:**

| 参数 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `status` | string | - | 过滤: ACTIVE, IDLE, ARCHIVED, DELETED |
| `limit` | number | 20 | 每页数量 (1-100) |
| `offset` | number | 0 | 偏移量 |
| `orderBy` | string | createdAt | 排序字段 |
| `order` | string | desc | 排序方向: asc, desc |
| `createdAfter` | ISO8601 | - | 创建时间起始 |
| `createdBefore` | ISO8601 | - | 创建时间结束 |

**响应 (200 OK):**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "sess_abc123",
        "status": "active",
        "model": "gpt-4",
        "usage": {
          "totalTokens": 2000,
          "requestCount": 10
        },
        "createdAt": "2026-03-04T10:00:00.000Z",
        "lastActiveAt": "2026-03-04T10:05:00.000Z"
      }
    ],
    "pagination": {
      "total": 50,
      "limit": 20,
      "offset": 0,
      "hasMore": true
    }
  },
  "requestId": "req_abc123",
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

### 3.6 归档会话

```
POST /sessions/:sessionId/archive
```

**响应 (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "sess_abc123",
    "status": "archived",
    "archivedAt": "2026-03-04T10:15:00.000Z"
  },
  "requestId": "req_abc123",
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

---

## 4. 消息交互 API

### 4.1 发送消息 (非流式)

```
POST /sessions/:sessionId/messages
```

**请求体:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "请帮我分析这个代码文件"
    }
  ],
  "model": "gpt-4",
  "tools": ["read_file", "bash"]
}
```

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `content` | Content[] | 是 | 消息内容 |
| `content[].type` | string | 是 | 类型: text, image_url, file |
| `content[].text` | string | 是 | 文本内容 (type=text) |
| `content[].image_url.url` | string | 是 | 图片 URL (type=image_url) |
| `model` | string | 否 | 覆盖会话模型 |
| `tools` | string[] | 否 | 覆盖会话工具 |

**响应 (200 OK):**

```json
{
  "success": true,
  "data": {
    "message": {
      "id": "msg_abc123",
      "role": "assistant",
      "content": "我来帮你分析这个代码文件。...",
      "model": "gpt-4",
      "usage": {
        "promptTokens": 1500,
        "completionTokens": 500,
        "totalTokens": 2000
      },
      "createdAt": "2026-03-04T10:00:00.000Z"
    },
    "toolCalls": [
      {
        "id": "call_xyz",
        "tool": "read_file",
        "arguments": {
          "filePath": "/path/to/file.ts"
        }
      }
    ]
  },
  "requestId": "req_abc123",
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

### 4.2 发送消息 (流式 SSE)

```
GET /sessions/:sessionId/messages/stream
```

**请求体:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "请帮我分析这个代码文件"
    }
  ],
  "stream": true
}
```

**响应 (200 OK, Content-Type: text/event-stream):**

```
event: message_start
data: {"messageId": "msg_abc123", "role": "assistant"}

event: content_delta
data: {"delta": "我来", "index": 0}

event: content_delta
data: {"delta": "帮你", "index": 1}

event: content_delta
data: {"delta": "分析", "index": 2}

event: tool_call_start
data: {"id": "call_xyz", "name": "read_file"}

event: tool_call_delta
data: {"arguments": "{\"filePath\":\""}

event: tool_call_delta
data: {"arguments": "\"/path/to/file.ts\""}

event: tool_call_end
data: {"id": "call_xyz"}

event: message_delta
data: {
  "usage": {
    "promptTokens": 1500,
    "completionTokens": 500,
    "totalTokens": 2000
  }
}

event: message_end
data: {"finishReason": "stop"}
```

#### 事件类型

| 事件 | 描述 |
|------|------|
| `message_start` | 消息开始 |
| `content_delta` | 内容增量 |
| `tool_call_start` | 工具调用开始 |
| `tool_call_delta` | 工具调用参数增量 |
| `tool_call_end` | 工具调用结束 |
| `tool_result` | 工具执行结果 |
| `message_delta` | 消息元数据增量 |
| `message_end` | 消息结束 |
| `error` | 错误 |

### 4.3 获取消息历史

```
GET /sessions/:sessionId/messages
```

**查询参数:**

| 参数 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `limit` | number | 50 | 每页数量 |
| `offset` | number | 0 | 偏移量 |
| `role` | string | - | 过滤: SYSTEM, USER, ASSISTANT, TOOL |
| `includeSummary` | boolean | false | 包含摘要消息 |

**响应 (200 OK):**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "msg_001",
        "role": "system",
        "content": "You are a helpful AI assistant.",
        "createdAt": "2026-03-04T10:00:00.000Z"
      },
      {
        "id": "msg_002",
        "role": "user",
        "content": "请帮我分析代码",
        "createdAt": "2026-03-04T10:00:01.000Z"
      },
      {
        "id": "msg_003",
        "role": "assistant",
        "content": "好的，我来帮你分析...",
        "toolCalls": [
          {
            "id": "call_001",
            "type": "function",
            "function": {
              "name": "read_file",
              "arguments": "{\"filePath\": \"/src/main.ts\"}"
            }
          }
        ],
        "createdAt": "2026-03-04T10:00:02.000Z"
      }
    ],
    "pagination": {
      "total": 100,
      "limit": 50,
      "offset": 0,
      "hasMore": true
    }
  },
  "requestId": "req_abc123",
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

### 4.4 删除消息

```
DELETE /sessions/:sessionId/messages/:messageId
```

**响应 (204 No Content)**

---

## 5. 上下文管理 API

### 5.1 获取当前上下文

```
GET /sessions/:sessionId/context
```

**响应 (200 OK):**

```json
{
  "success": true,
  "data": {
    "sessionId": "sess_abc123",
    "version": 15,
    "messages": [...],
    "stats": {
      "totalTokens": 50000,
      "messageCount": 30,
      "lastCompactionAt": "2026-03-04T09:00:00.000Z"
    },
    "updatedAt": "2026-03-04T10:00:00.000Z"
  },
  "requestId": "req_abc123",
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

### 5.2 手动触发压缩

```
POST /sessions/:sessionId/compact
```

**响应 (200 OK):**

```json
{
  "success": true,
  "data": {
    "success": true,
    "summaryMessage": {
      "id": "msg_summary_001",
      "role": "assistant",
      "type": "summary",
      "content": "用户需要帮助分析代码文件..."
    },
    "messagesBefore": 100,
    "messagesAfter": 45,
    "tokensBefore": 150000,
    "tokensAfter": 45000,
    "compactedAt": "2026-03-04T10:00:00.000Z"
  },
  "requestId": "req_abc123",
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

### 5.3 创建上下文快照

```
POST /sessions/:sessionId/snapshot
```

**响应 (201 Created):**

```json
{
  "success": true,
  "data": {
    "snapshotId": "snap_abc123",
    "sessionId": "sess_abc123",
    "messageCount": 50,
    "totalTokens": 75000,
    "createdAt": "2026-03-04T10:00:00.000Z"
  },
  "requestId": "req_abc123",
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

---

## 6. 工具管理 API

### 6.1 列出可用工具

```
GET /tools
```

**响应 (200 OK):**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "name": "read_file",
        "description": "Read contents of a file",
        "category": "file",
        "parameters": {
          "type": "object",
          "properties": {
            "filePath": {
              "type": "string",
              "description": "Path to the file"
            }
          },
          "required": ["filePath"]
        }
      },
      {
        "name": "bash",
        "description": "Execute shell commands",
        "category": "bash",
        "securityLevel": "sandboxed"
      }
    ]
  },
  "requestId": "req_abc123",
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

### 6.2 直接执行工具

```
POST /tools/execute
```

**请求体:**

```json
{
  "tool": "bash",
  "arguments": {
    "command": "ls -la"
  },
  "sessionId": "sess_abc123"
}
```

**响应 (200 OK):**

```json
{
  "success": true,
  "data": {
    "tool": "bash",
    "result": {
      "output": "total 64\ndrwxr-xr-x   5 user  staff  160 Mar  4 10:00 .\ndrwxr-xr-x   5 user  staff  160 Mar  4 10:00 ..",
      "exitCode": 0
    },
    "duration": 150
  },
  "requestId": "req_abc123",
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

---

## 7. 认证 API

### 7.1 创建 API Key

```
POST /api-keys
```

**请求体:**

```json
{
  "name": "My API Key",
  "permissions": [
    "session:create",
    "session:read",
    "message:send"
  ],
  "expiresIn": 90
}
```

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `name` | string | 是 | API Key 名称 |
| `permissions` | string[] | 是 | 权限列表，格式为 `resource:action` |
| `expiresIn` | number | 否 | 过期天数 |

**响应 (201 Created):**

```json
{
  "success": true,
  "data": {
    "id": "key_abc123",
    "key": "sk_abc123xyz...",  // 仅此一次返回
    "name": "My API Key",
    "permissions": [
      "session:create",
      "session:read",
      "message:send"
    ],
    "expiresAt": "2026-06-02T10:00:00.000Z",
    "createdAt": "2026-03-04T10:00:00.000Z"
  },
  "requestId": "req_abc123",
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

### 7.2 列出 API Keys

```
GET /api-keys
```

**响应 (200 OK):**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "key_abc123",
        "name": "My API Key",
        "keyPrefix": "sk_abc123",
        "permissions": ["session:create", "session:read"],
        "lastUsedAt": "2026-03-04T10:00:00.000Z",
        "usageCount": 100,
        "expiresAt": "2026-06-02T10:00:00.000Z",
        "createdAt": "2026-03-04T10:00:00.000Z"
      }
    ]
  },
  "requestId": "req_abc123",
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

### 7.3 撤销 API Key

```
DELETE /api-keys/:keyId
```

**响应 (204 No Content)**

### 7.4 获取 Access Token

```
POST /auth/token
```

**请求体:**

```json
{
  "grant_type": "client_credentials",
  "client_id": "user@example.com",
  "client_secret": "your_password"
}
```

或者

```json
{
  "grant_type": "refresh_token",
  "refresh_token": "your_refresh_token"
}
```

**响应 (200 OK):**

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "tokenType": "Bearer",
    "expiresIn": 900
  },
  "requestId": "req_abc123",
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

### 7.5 刷新 Token

```
POST /auth/refresh
```

**请求体:**

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**响应 (200 OK):**

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "tokenType": "Bearer",
    "expiresIn": 900
  },
  "requestId": "req_abc123",
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

### 7.6 注销 Token

```
POST /auth/revoke
```

**请求体:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**响应 (204 No Content)**

---

## 8. 管理 API

### 8.1 获取使用统计

```
GET /admin/usage
```

**查询参数:**

| 参数 | 类型 | 描述 |
|------|------|------|
| `startDate` | ISO8601 | 起始日期 |
| `endDate` | ISO8601 | 结束日期 |
| `granularity` | string | 粒度: day, month |

**响应 (200 OK):**

```json
{
  "success": true,
  "data": {
    "summary": {
      "totalTokens": 1000000,
      "totalRequests": 5000,
      "totalSessions": 100,
      "activeUsers": 50
    },
    "byModel": {
      "gpt-4": {
        "promptTokens": 800000,
        "completionTokens": 200000
      },
      "gpt-3.5-turbo": {
        "promptTokens": 50000,
        "completionTokens": 10000
      }
    },
    "byDay": [
      {
        "date": "2026-03-01",
        "tokens": 50000,
        "requests": 250
      },
      {
        "date": "2026-03-02",
        "tokens": 60000,
        "requests": 300
      }
    ]
  },
  "requestId": "req_abc123",
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

### 8.2 获取系统指标

```
GET /admin/metrics
```

**响应 (200 OK):**

```json
{
  "success": true,
  "data": {
    "system": {
      "cpuUsage": 45.2,
      "memoryUsage": 62.8,
      "eventLoopLag": 5
    },
    "database": {
      "pgConnections": 25,
      "pgMaxConnections": 100,
      "queryDurationP99": 50
    },
    "cache": {
      "redisHitRate": 0.95,
      "redisMemoryUsed": "256MB"
    },
    "api": {
      "requestsPerMinute": 120,
      "avgResponseTime": 150,
      "errorRate": 0.01
    }
  },
  "requestId": "req_abc123",
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

### 8.3 获取租户信息

```
GET /admin/tenant
```

**响应 (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "tenant_abc123",
    "name": "Acme Corp",
    "plan": "pro",
    "status": "active",
    "quotas": {
      "maxSessions": 200,
      "requestsPerMinute": 300,
      "tokensPerDay": 10000000
    },
    "usage": {
      "sessions": 50,
      "requestsToday": 5000,
      "tokensToday": 2500000
    },
    "createdAt": "2026-01-01T00:00:00.000Z"
  },
  "requestId": "req_abc123",
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

### 8.4 获取租户信息

```
GET /tenants/:tenantId
```

**响应 (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "tenant_abc123",
    "name": "Acme Corp",
    "slug": "acme-corp",
    "email": "admin@acme.com",
    "plan": "PRO",
    "customQuotas": {},
    "status": "ACTIVE",
    "features": {
      "customTools": true,
      "apiAccess": true
    },
    "settings": {},
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-03-04T10:00:00.000Z"
  },
  "requestId": "req_abc123",
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

### 8.5 更新租户

```
PATCH /tenants/:tenantId
```

**请求体:**

```json
{
  "name": "Acme Corp Updated",
  "customQuotas": {
    "maxSessions": 500
  },
  "features": {
    "customTools": true,
    "apiAccess": true
  }
}
```

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `name` | string | 否 | 租户名称 |
| `customQuotas` | object | 否 | 自定义配额 |
| `features` | object | 否 | 功能开关 |

**响应 (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "tenant_abc123",
    "name": "Acme Corp Updated",
    "status": "ACTIVE",
    "updatedAt": "2026-03-04T10:00:00.000Z"
  },
  "requestId": "req_abc123",
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

---

## 10. 健康检查 API

### 10.1 健康检查

```
GET /health
```

**响应 (200 OK):**

```json
{
  "status": "healthy",
  "timestamp": "2026-03-04T10:00:00.000Z",
  "version": "1.0.0"
}
```

### 9.2 就绪检查

```
GET /health/ready
```

**响应 (200 OK):**

```json
{
  "status": "ready",
  "checks": {
    "database": "ok",
    "redis": "ok"
  },
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

### 9.3 存活检查

```
GET /health/live
```

**响应 (200 OK):**

```json
{
  "status": "alive",
  "timestamp": "2026-03-04T10:00:00.000Z"
}
```

---

## 11. 完整 API 路由列表

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| **会话管理** | | | |
| POST | /sessions | 创建会话 | ✅ |
| GET | /sessions | 列出会话 | ✅ |
| GET | /sessions/:sessionId | 获取会话 | ✅ |
| PATCH | /sessions/:sessionId | 更新会话 | ✅ |
| DELETE | /sessions/:sessionId | 删除会话 | ✅ |
| POST | /sessions/:sessionId/archive | 归档会话 | ✅ |
| **租户管理** | | | |
| GET | /tenants/:tenantId | 获取租户信息 | ✅ |
| PATCH | /tenants/:tenantId | 更新租户 | ✅ |
| **消息交互** | | | |
| POST | /sessions/:sessionId/messages | 发送消息 | ✅ |
| GET | /sessions/:sessionId/messages/stream | 流式发送 | ✅ |
| GET | /sessions/:sessionId/messages | 获取消息历史 | ✅ |
| DELETE | /sessions/:sessionId/messages/:messageId | 删除消息 | ✅ |
| **上下文管理** | | | |
| GET | /sessions/:sessionId/context | 获取上下文 | ✅ |
| POST | /sessions/:sessionId/compact | 压缩上下文 | ✅ |
| POST | /sessions/:sessionId/snapshot | 创建快照 | ✅ |
| **工具管理** | | | |
| GET | /tools | 列出工具 | ✅ |
| POST | /tools/execute | 执行工具 | ✅ |
| **认证** | | | |
| POST | /api-keys | 创建 API Key | ✅ |
| GET | /api-keys | 列出 API Keys | ✅ |
| DELETE | /api-keys/:keyId | 撤销 API Key | ✅ |
| POST | /auth/token | 获取 Token | - |
| POST | /auth/refresh | 刷新 Token | ✅ |
| POST | /auth/revoke | 注销 Token | ✅ |
| **管理** | | | |
| GET | /admin/usage | 使用统计 | ✅ |
| GET | /admin/metrics | 系统指标 | ✅ |
| GET | /admin/tenant | 租户信息 | ✅ |
| **健康检查** | | | |
| GET | /health | 健康检查 | - |
| GET | /health/ready | 就绪检查 | - |
| GET | /health/live | 存活检查 | - |

---

## 12. 总结

本文档详细定义了企业级 Agent 服务端的所有 REST API，包括：

- 统一的请求/响应格式
- 完整的错误码定义
- 会话管理 API
- 消息交互 API (支持流式)
- 上下文管理 API
- 工具管理 API
- 认证授权 API
- 管理 API
- 健康检查 API

**后续文档：**
- [数据模型设计文档](./05-数据模型设计.md) - 数据库表结构
- [工具执行设计文档](./06-工具执行设计.md) - 工具注册与执行
- [部署运维设计文档](./07-部署运维设计.md) - Docker/K8s 配置

---

*本文档是 API 设计的完整规范，实现时请严格遵循。*
