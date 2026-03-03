# 部署到服务端的问题分析

> 文档位置: docs/analysis/deployment-issues.md
> 生成日期: 2026-03-04

---

## 目录

1. [存储问题](#1-存储问题)
2. [Session 管理问题](#2-session-管理问题)
3. [安全问题](#3-安全问题)
4. [性能问题](#4-性能问题)
5. [日志和监控问题](#5-日志和监控问题)
6. [多实例部署问题](#6-多实例部署问题)

---

## 1. 存储问题

### 1.1 当前架构

```
src/agent-v2/memory/adapters/
├── file/           # 文件存储 (默认)
├── mongodb/       # MongoDB 存储
└── hybrid/        # 混合存储
```

### 1.2 问题分析

#### 问题 1.2.1: 文件存储不适用于容器环境

**症状**:
```bash
# 容器重启后数据丢失
docker run -v /data myagent  # 如果是临时卷
#
docker 或-compose down -v       # 清理卷，数据丢失
```

**风险**:
- Session 数据丢失
- 历史记录丢失
- 用户上下文丢失

**解决方案**:

```yaml
# docker-compose.yml
services:
  agent:
    volumes:
      - agent-data:/app/data  # 持久卷
    environment:
      - AGENT_STORAGE_TYPE=mongodb
      - MONGODB_URI=mongodb://mongo:27017

volumes:
  agent-data:
```

#### 问题 1.2.2: MongoDB 存储无连接池配置

**当前代码**: `src/agent-v2/memory/adapters/mongodb/driver.ts`

```typescript
// 默认行为: 每个操作创建新连接
async getConnection() {
    return await MongoClient.connect(this.uri);
}
```

**风险**:
- 高并发时连接数爆炸
- MongoDB 服务器负载过高

**解决方案**:

```typescript
// 配置连接池
const client = new MongoClient(uri, {
    maxPoolSize: 10,        // 最大连接数
    minPoolSize: 2,        // 最小连接数
    maxIdleTimeMS: 30000,  // 空闲超时
});
```

#### 问题 1.2.3: 无自动备份机制

**当前状态**:
- 文件存储: 仅在写入失败时使用 .bak 恢复
- MongoDB: 无备份功能

**风险**: 
- 误操作无法恢复
- 数据损坏无法修复

**解决方案**:

```typescript
// 定时备份任务
import { CronJob } from 'cron';

const backupJob = new CronJob('0 2 * * *', async () => {
    await backupMongoDB();
    await cleanupOldBackups();  // 保留 7 天
});

backupJob.start();
```

---

### 1.3 推荐存储配置

| 环境 | 存储类型 | 配置 |
|-----|---------|------|
| 开发 | 文件 | 默认 |
| 测试 | MongoDB | 单实例 |
| 生产 | MongoDB + Redis | 集群 + 哨兵 |
| 大规模 | MongoDB 集群 | 分片 |

---

## 2. Session 管理问题

### 2.1 当前架构

```typescript
// session 存储在内存 + 文件/MongoDB
class Session {
    messages: Message[];      // 内存
    metadata: SessionMeta;   // 持久化
}
```

### 2.2 问题分析

#### 问题 2.2.1: 内存 Session 重启丢失

**症状**:
```bash
# 优雅重启
kill -TERM <pid>  # Session 数据丢失

# 滚动更新
kubectl rolling-update  # Session 数据丢失
```

**解决方案**:

```typescript
// 使用 Redis 存储 Session
import Redis from 'ioredis';

class RedisSessionStore implements SessionStore {
    constructor(private redis: Redis) {}
    
    async load(sessionId: string): Promise<Session | null> {
        const data = await this.redis.get(`session:${sessionId}`);
        return data ? JSON.parse(data) : null;
    }
    
    async save(session: Session, ttl: number = 86400): Promise<void> {
        await this.redis.setex(
            `session:${session.id}`,
            ttl,
            JSON.stringify(session)
        );
    }
}
```

#### 问题 2.2.2: Session 无限增长

**症状**:
```bash
# 长期运行后内存爆炸
top
# PID    USER   PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND
# 12345  node   20   0  2.5g   2.1g   100M S   5.0 26.5  123:45.45 node
```

**原因**:
- 上下文无限累积
- 无 TTL 过期
- 无自动压缩

**解决方案**:

```typescript
// 配置 Session TTL
const AGENT_CONFIG = {
    session: {
        maxAge: 24 * 60 * 60 * 1000,  // 24 小时
        autoCompaction: true,
        compactionThreshold: 10000,    // 超过 10000 条消息自动压缩
    }
};

// 定时清理过期 Session
setInterval(() => {
    sessionStore.cleanupExpired();
}, 60 * 60 * 1000);  // 每小时
```

#### 问题 2.2.3: 多实例 Session 不共享

**症状**:
```bash
# 用户请求到实例 A，创建 Session
curl -X POST http://instance-a:3000/agent
  
# 用户请求到实例 B，看不到之前的 Session
curl http://instance-b:3000/agent
# 返回: Session not found
```

**解决方案**: 使用分布式缓存

```typescript
// Redis Session Store
class DistributedSessionManager {
    constructor(
        private redis: Redis,
        private localCache: Map<string, Session> = new Map()
    ) {}
    
    async getSession(sessionId: string): Promise<Session> {
        // 先查本地缓存
        if (this.localCache.has(sessionId)) {
            return this.localCache.get(sessionId);
        }
        
        // 查 Redis
        const data = await this.redis.get(`session:${sessionId}`);
        if (data) {
            const session = JSON.parse(data);
            this.localCache.set(sessionId, session);
            return session;
        }
        
        return null;
    }
}
```

---

## 3. 安全问题

### 3.1 命令执行风险

#### 问题 3.1.1: shell: true 允许注入

**当前代码**: `src/agent-v2/tool/bash.ts`

```typescript
execaCommand(command, { shell: true });
```

**攻击向量**:
```bash
# 环境变量注入
AGENT_PERMISSION_DENY_TOOLS= npm run build

# 命令替换
echo "malicious" | bash
```

**生产环境建议**:

```typescript
// 1. 严格限制可用命令
const ALLOWED_COMMANDS = new Set([
    'git', 'npm', 'pnpm', 'yarn', 'node', 'python3'
]);

// 2. 使用 shell: false
execaCommand('npm', ['install'], { shell: false });

// 3. 添加执行超时
execaCommand('npm', ['install'], {
    shell: false,
    timeout: 5 * 60 * 1000,  // 5 分钟超时
    killSignal: 'SIGKILL'
});
```

#### 问题 3.1.2: 文件访问无限制

**症状**:
```bash
# 可以访问系统敏感文件
read_file filePath: "/etc/passwd"
read_file filePath: "~/.ssh/id_rsa"
```

**生产环境建议**:

```typescript
// 严格限制工作目录
const config = {
    file: {
        allowedRoots: ['/app/workspace'],
        deniedPatterns: [
            /^\/etc\//,
            /^\/root\//,
            /^\/var\//,
            /^\/proc\//,
            /\/\.ssh\//,
            /\.pem$/,
        ]
    }
};
```

### 3.2 API 认证问题

#### 问题: 无 API 认证机制

**当前**: 任何人都可以调用 Agent

```bash
# 无认证调用
curl -X POST http://agent:3000/run -d '{"message": "hello"}'
# 返回: {"sessionId": "xxx", ...}
```

**生产环境建议**:

```typescript
// 1. API Key 认证
app.use('/agent', (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || !isValidKey(apiKey)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
});

// 2. JWT 认证
app.use('/agent', authenticateJWT);

// 3. IP 白名单
app.use('/agent', (req, res, next) => {
    const ip = req.ip;
    if (!isAllowedIP(ip)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
});
```

### 3.3 敏感信息泄露

#### 问题: 日志可能包含敏感信息

```typescript
// 可能泄露
logger.info('API call', { apiKey: 'sk-xxx' });
logger.info('User request', { password: '123456' });
```

**生产环境建议**:

```typescript
// 1. 敏感字段自动脱敏
logger.addMaskedFields(['apiKey', 'password', 'token', 'secret']);

// 2. 环境变量存储密钥
// .env 文件
AGENT_API_KEY=sk-xxx  # 不要在代码中硬编码

// 3. 使用密钥管理服务
import { SecretsManager } from 'aws-sdk';
const secret = await secretsManager.getSecretValue({ SecretId: 'agent-api-key' });
```

---

## 4. 性能问题

### 4.1 启动加载慢

#### 问题: 启动时全量加载数据

```typescript
// bootstrap.ts
cache.sessions = await stores.sessions.loadAll();    // 全部加载!
cache.contexts = await stores.contexts.loadAll();    // 全部加载!
cache.histories = await stores.histories.loadAll();  // 全部加载!
```

**症状**:
```bash
# 启动时间 30 秒+
node agent.js
# [INFO] Starting agent... (0s)
# [INFO] Loading sessions... (15s)
# [INFO] Loading contexts... (10s)
# [INFO] Ready! (25s)
```

**解决方案**:

```typescript
// 1. 按需加载
async function loadSession(sessionId: string) {
    // 只有访问时才加载
    return await stores.sessions.load(sessionId);
}

// 2. 懒加载 + 缓存
class LazySessionStore {
    private cache = new LRUCache<string, Session>({ max: 100 });
    
    async get(sessionId: string): Promise<Session> {
        if (this.cache.has(sessionId)) {
            return this.cache.get(sessionId);
        }
        const session = await this.stores.sessions.load(sessionId);
        this.cache.set(sessionId, session);
        return session;
    }
}

// 3. 启动预热 (可选)
async function warmUp() {
    // 只加载活跃 Session
    const activeSessions = await stores.sessions.getActiveSessions();
    await Promise.all(activeSessions.map(s => lazyStore.get(s.id)));
}
```

### 4.2 内存占用高

#### 问题: 大会话占用大量内存

```typescript
// context 无限增长
context.messages.push(newMessage);  // 持续累积
```

**解决方案**:

```typescript
// 1. 消息数量限制
const MAX_MESSAGES = 1000;

// 2. 智能压缩
async function compressContext(context: Context): Promise<Context> {
    if (context.messages.length > MAX_MESSAGES) {
        return await createSummary(context);
    }
    return context;
}

// 3. Token 限制
const MAX_TOKENS = 128000;
async function truncateToTokenLimit(context: Context): Promise<Context> {
    let tokenCount = await countTokens(context);
    while (tokenCount > MAX_TOKENS) {
        context.messages.shift();  // 移除最旧消息
        tokenCount = await countTokens(context);
    }
    return context;
}
```

### 4.3 并发能力不足

#### 问题: 单实例处理能力有限

```bash
# 单实例测试
wrk -t4 -c100 -d60s http://agent:3000/run
# Requests/sec: 50.23  # 低于预期
```

**解决方案**:

```yaml
# kubernetes deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agent
spec:
  replicas: 3  # 多副本
  template:
    spec:
      containers:
      - name: agent
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "2000m"
---
apiVersion: v1
kind: Service
metadata:
  name: agent
spec:
  type: LoadBalancer
  selector:
    app: agent
  ports:
  - port: 80
    targetPort: 3000
```

---

## 5. 日志和监控问题

### 5.1 日志问题

#### 问题 5.1.1: 本地日志可能打满磁盘

```bash
# 磁盘满导致服务崩溃
df -h
# Filesystem      Size  Used Avail Use% Mounted on
# /dev/sda1       100G   100G     0 100% /app
```

**解决方案**:

```typescript
// 1. 限制日志文件大小
const fileTransport = new FileTransport({
    filepath: './logs/agent.log',
    rotation: {
        enabled: true,
        maxSize: 10 * 1024 * 1024,  // 10MB
        maxFiles: 5,
    }
});

// 2. 接入日志收集系统
// Filebeat -> Logstash -> Elasticsearch -> Kibana

// 3. 使用标准输出
// Docker/K8s 环境使用 stdout
const consoleTransport = new ConsoleTransport({
    format: 'json',
    stream: process.stdout
});
```

#### 问题 5.1.2: 无日志查询能力

**解决方案**:

```typescript
// 1. 暴露日志查询 API
app.get('/agent/logs', async (req, res) => {
    const { sessionId, level, startTime, endTime } = req.query;
    const logs = await queryLogs({ sessionId, level, startTime, endTime });
    res.json(logs);
});

// 2. 接入日志服务
// - ELK Stack
// - Loki + Grafana
// - CloudWatch Logs
```

### 5.2 监控问题

#### 问题 5.2.1: 无指标暴露

**解决方案**:

```typescript
// 使用 prom-client 暴露指标
import client from 'prom-client';

const register = new client.Registry();
register.setDefaultLabels({ app: 'agent' });

// 添加默认指标
client.collectDefaultMetrics({ register });

// 自定义指标
const httpRequestDuration = new client.Histogram({
    name: 'agent_http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.1, 0.5, 1, 2, 5, 10]
});

// 暴露 /metrics 端点
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.send(await register.metrics());
});
```

#### 问题 5.2.2: 无健康检查

**解决方案**:

```typescript
// 健康检查端点
app.get('/health', (req, res) => {
    const checks = {
        mongodb: mongoClient.isConnected(),
        redis: redis.status === 'ready',
        disk: diskSpace.available > 1 * 1024 * 1024 * 1024  // 1GB
    };
    
    const healthy = Object.values(checks).every(v => v);
    res.status(healthy ? 200 : 503).json({
        status: healthy ? 'healthy' : 'unhealthy',
        checks,
        timestamp: new Date().toISOString()
    });
});

// 就绪检查
app.get('/ready', async (req, res) => {
    const ready = await checkAllConnections();
    res.status(ready ? 200 : 503).json({ ready });
});
```

---

## 6. 多实例部署问题

### 6.1 状态共享

| 问题 | 解决方案 |
|-----|---------|
| Session 不共享 | Redis 分布式缓存 |
| 权限缓存不一致 | Redis + TTL |
| 工具注册不一致 | 配置中心/数据库 |

### 6.2 负载均衡

```yaml
# nginx.conf
upstream agent_backend {
    least_conn;  # 最少连接数
    
    server agent-1:3000 weight=1;
    server agent-2:3000 weight=1;
    server agent-3:3000 weight=1;
    
    keepalive 32;
}

server {
    location /agent/ {
        proxy_pass http://agent_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        
        # Session 亲和性 (可选)
        # ip_hash;  # 基于 IP 的会话保持
    }
}
```

### 6.3 配置管理

```typescript
// 使用配置中心
import { ConfigService } from 'aws-sdk';

class AgentConfig {
    private config: Record<string, any> = {};
    
    async load() {
        // 从配置中心加载
        const result = await configService.getParameter({ Name: '/agent/config' });
        this.config = JSON.parse(result.Parameter.Value);
    }
    
    get(key: string): any {
        return this.config[key];
    }
}
```

---

## 总结: 部署检查清单

### 部署前检查

- [ ] 使用非 root 用户运行容器
- [ ] 配置资源限制 (CPU/内存)
- [ ] 配置持久化存储
- [ ] 启用日志轮转
- [ ] 配置 API 认证
- [ ] 配置 Session 存储 (Redis)
- [ ] 暴露监控指标端点
- [ ] 配置健康检查
- [ ] 设置 Session TTL
- [ ] 配置备份策略

### 部署后检查

- [ ] 日志正常输出
- [ ] 监控指标可采集
- [ ] 健康检查通过
- [ ] Session 跨实例共享
- [ ] 并发能力满足需求
- [ ] 内存使用稳定
- [ ] 磁盘使用可控
