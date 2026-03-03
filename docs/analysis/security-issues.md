# 安全问题详细分析

> 文档位置: docs/analysis/security-issues.md
> 生成日期: 2026-03-04

---

## 目录

1. [Bash 命令执行安全](#1-bash-命令执行安全)
2. [文件操作安全](#2-文件操作安全)
3. [权限系统安全](#3-权限系统安全)
4. [网络访问安全](#4-网络访问安全)
5. [认证和授权](#5-认证和授权)
6. [敏感信息保护](#6-敏感信息保护)

---

## 1. Bash 命令执行安全

### 1.1 当前实现分析

**文件**: `src/agent-v2/security/bash-policy.ts`, `src/agent-v2/tool/bash.ts`

#### 1.1.1 策略模式

```typescript
// guarded (默认) - 白名单模式
const GUARDED_COMMANDS = new Set([
    'git', 'npm', 'pnpm', 'yarn', 'node', 'python3', 'python',
    'docker', 'kubectl', 'make', 'bash', 'sh', 'powershell'
]);

// permissive - 黑名单模式
const BLOCKED_COMMANDS = new Set([
    'sudo', 'su', 'passwd', 'visudo', 'useradd', 'userdel',
    'shutdown', 'reboot', 'mkfs', 'fdisk', 'diskutil'
]);
```

#### 1.1.2 危险模式检测

```typescript
const DANGEROUS_PATTERNS = [
    { pattern: /\brm\s+-rf\s+\/(\s|$)/i, reason: 'Root deletion' },
    { pattern: /:\(\)\s*\{\s*:\|:&\s*\};:/, reason: 'Fork bomb' },
    { pattern: /\b(curl|wget)[^|\n]*\|\s*(sh|bash|zsh)\b/i, reason: 'Remote script' },
];
```

---

### 1.2 安全漏洞

#### 漏洞 1.2.1: shell: true 允许命令注入

**严重程度**: 🔴 严重

**问题代码**:
```typescript
// bash.ts
const result = await execaCommand(command, {
    shell: true,  // ⚠️ 允许 shell 解析
    timeout: this.timeoutMs,
});
```

**攻击向量**:

```bash
# 1. 环境变量注入
PATH=./malicious:$PATH ls

# 2. 命令替换
cat $(whoami).txt

# 3. 引号逃逸
echo "test" && malicious_command

# 4. Here document
cat <<EOF | bash
malicious command
EOF
```

**修复建议**:

```typescript
// 方案1: 使用 shell: false
const result = await execaCommand(command, {
    shell: false,  // 禁用 shell
    timeout: this.timeoutMs,
});

// 方案2: 严格参数化
async function safeExec(command: string, args: string[]) {
    const allowedCommands = new Set(['git', 'npm', 'node']);
    const cmd = command.split(' ')[0];
    if (!allowedCommands.has(cmd)) {
        throw new Error(`Command not allowed: ${cmd}`);
    }
    return execa(cmd, args, { shell: false });
}
```

---

#### 漏洞 1.2.2: 危险命令在白名单

**严重程度**: 🔴 严重

**问题**: 白名单包含可执行任意代码的命令

```typescript
// 这些命令都允许执行任意代码!
'node', 'python', 'npm', 'docker', 'kubectl', 'make'
```

**攻击示例**:

```bash
# 通过 npm 注入恶意脚本
npm init -y && npm install && npm run preinstall

# 通过 docker 逃逸
docker run --privileged -v /:/host alpine chroot /host

# 通过 make 执行 shell
cat > Makefile <<EOF
.PHONY: all
all:
\t$(shell whoami > /tmp/pwned)
EOF
make
```

**修复建议**:

```typescript
// 严格限制命令和参数
const STRICT_ALLOWED_COMMANDS = new Set([
    'git',           // 只允许特定子命令
    'docker',        // 需要更多检查
]);

// 使用命令行解析库
import { parseArgs } from 'util';

function validateGitCommand(args: string[]): boolean {
    const allowed = new Set([
        'status', 'log', 'diff', 'show', 'branch', 'checkout', 'pull'
    ]);
    // 解析命令
    const { values } = parseArgs({ args, allowPositionals: true });
    const subcommand = values._?.[0];
    return allowed.has(subcommand);
}
```

---

#### 漏洞 1.2.3: 模式检测不完整

**严重程度**: 🟡 中

**缺失的检测**:
- `>` 重定向
- `>>` 追加写入
- 环境变量赋值
- 命令替换 `` `command` ``
- `$()` 替换
- Here documents

**修复建议**:

```typescript
const ADDITIONAL_DANGEROUS_PATTERNS = [
    // 重定向到敏感路径
    { pattern: />\s*(\/etc\/|\/root\/|\/proc\/)/, reason: 'Redirect to sensitive path' },
    
    // 环境变量注入
    { pattern: /[A-Z_]+=.*\$/, reason: 'Environment variable injection' },
    
    // 命令替换
    { pattern: /\$\(.*\)/, reason: 'Command substitution' },
    { pattern: /`.*`/, reason: 'Backtick command substitution' },
];
```

---

## 2. 文件操作安全

### 2.1 当前实现分析

**文件**: `src/agent-v2/tool/file.ts`

#### 2.1.1 防护机制

```typescript
// 1. 路径规范化
const normalizedPath = path.normalize(filePath);

// 2. URL 解码
const decodedPath = decodeURIComponent(normalizedPath);

// 3. 空字节检测
if (decodedPath.includes('\0')) {
    throw new Error('Null byte injection');
}

// 4. 敏感目录检查
const deniedPatterns = [
    /^\/etc\//, /^\/root\//, /^\/var\/log\//, /^\/proc\//,
    /\/\.ssh\//, /\/\.aws\//, /\/\.azure\//
];

// 5. 符号链接解析
const realPath = fs.realpathSync(filePath);
```

---

### 2.2 安全漏洞

#### 漏洞 2.2.1: 环境变量可禁用安全检查

**严重程度**: 🔴 严重

```typescript
// 禁用敏感目录保护
AGENT_DISABLE_SENSITIVE_DIR_PROTECTION=true

// 启用绝对路径访问
AGENT_ALLOW_ABSOLUTE_PATHS=true
```

**修复建议**: 移除这些环境变量，或限制仅开发环境可用

---

#### 漏洞 2.2.2: 允许访问任意绝对路径

**严重程度**: 🔴 严重

```typescript
if (allowAbsolutePaths && path.isAbsolute(normalizedInput)) {
    return finalPath;  // ⚠️ 允许任何绝对路径
}
```

**修复建议**: 严格限制绝对路径白名单

---

#### 漏洞 2.2.3: 敏感目录黑名单不完整

**严重程度**: 🟡 中

**缺失的敏感路径**:
- `~/.kube/config` - Kubernetes 凭证
- `~/.aws/credentials` - AWS 凭证
- `~/.azure/` - Azure 凭证
- `~/.config/` - 各种配置
- `/tmp/` - 临时文件

**修复建议**: 扩展黑名单

```typescript
const SENSITIVE_PATTERNS = [
    // SSH
    /\/\.ssh\//i,
    
    // 云凭证
    /\/\.aws\//i,
    /\/\.azure\//i,
    /\/\.gcp\//i,
    /\/\.kube\//i,
    
    // 密钥文件
    /\.pem$/i,
    /\.key$/i,
    /\.p12$/i,
    /\.pfx$/i,
    
    // 配置
    /\/\.config\//i,
    /\.env$/i,
    
    // 系统
    /^\/etc\//i,
    /^\/root\//i,
    /^\/var\/log\//i,
    /^\/proc\//i,
];
```

---

#### 漏洞 2.2.4: TOCTOU 竞态条件

**严重程度**: 🟡 中

```typescript
// 检查和操作之间存在时间窗口
const fullPath = this.resolvePath(filePath);  // 检查通过

// 攻击者可以在这期间修改文件或符号链接

if (!fs.existsSync(fullPath)) { ... }  // 重新检查
```

**修复建议**: 使用原子操作

```typescript
// 使用 O_NOFOLLOW 打开文件
const fd = fs.openSync(filePath, 'r', 0);

// 或使用锁
import { lock } from 'proper-lockfile';

await lock(filePath, { retries: 0 });
try {
    // 操作文件
} finally {
    await unlock(filePath);
}
```

---

## 3. 权限系统安全

### 3.1 当前实现分析

**文件**: `src/agent-v2/security/permission-engine.ts`

#### 3.1.1 规则评估

```typescript
evaluate(request: PermissionRequest): PermissionDecision {
    const matched = this.matchRules(request);
    if (!matched) {
        return { effect: 'allow', source: 'default' };  // ⚠️ 默认允许
    }
    // ...
}
```

---

### 3.2 安全漏洞

#### 漏洞 3.2.1: 默认 Allow 策略

**严重程度**: 🔴 严重

**问题**: 未匹配的请求默认允许

**修复建议**:

```typescript
evaluate(request: PermissionRequest): PermissionDecision {
    const matched = this.matchRules(request);
    if (!matched) {
        return { effect: 'deny', source: 'default', reason: 'No matching rule' };
    }
    // ...
}
```

---

#### 漏洞 3.2.2: 环境变量控制权限

**严重程度**: 🟡 中

```typescript
const denyTools = parseToolList(process.env.AGENT_PERMISSION_DENY_TOOLS);
const allowTools = parseToolList(process.env.AGENT_PERMISSION_ALLOW_TOOLS);
```

**问题**: 运行环境的用户可以修改权限配置

**修复建议**: 移除环境变量配置，或使用配置文件

---

## 4. 网络访问安全

### 4.1 当前实现分析

**文件**: `src/agent-v2/tool/web-fetch.ts`

#### 4.1.1 SSRF 防护

```typescript
const BLOCKED_HOSTS = [
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i,
    /^10\./,
    /^192\.168\./,
    /^169\.254\./,
    /^(metadata\.google\.internal|metadata\.azure)$/i,
];
```

---

### 4.2 安全漏洞

#### 漏洞 4.2.1: DNS Rebinding 攻击

**严重程度**: 🟡 中

**攻击场景**:

1. 攻击者注册域名 `evil.com` 指向 `127.0.0.1`
2. 请求通过 SSRF 检查
3. DNS 缓存过期后，`evil.com` 指向内网 IP

**修复建议**:

```typescript
// 方案1: 验证最终 IP
async function validateURL(url: string): Promise<boolean> {
    const target = new URL(url);
    const ip = await dns.resolve4(target.hostname);
    
    if (isPrivateIP(ip)) {
        throw new Error('Private IP not allowed');
    }
    
    // 锁定 IP 5 秒
    await dnsCache.set(target.hostname, ip, 5000);
    return true;
}

// 方案2: 强制 DNS 解析到 IP
const controller = new DNSCacheController({ ttl: 1000 });
await controller.resolve(url);
```

---

#### 漏洞 4.2.2: IPv6 处理不完整

**严重程度**: 🟡 中

**问题**: 未处理完整的 IPv6 内网地址

**修复建议**:

```typescript
const BLOCKED_IPV6 = [
    '::1',                    // 本地
    'fc00::/7',              // 私有地址 (fc00::/7)
    'fe80::/10',             // 链路本地
    '2001:db8::/32',         // 文档地址
];
```

---

#### 漏洞 4.2.3: 开放重定向

**严重程度**: 🟡 中

**问题**: 未验证最终重定向目标

```typescript
const response = await fetch(url, { redirect: 'follow' });
// 可能被重定向到内网
```

**修复建议**:

```typescript
// 禁用自动重定向，手动验证每个跳转
const visited = new Set<string>();
let currentUrl = url;

while (visited.size < 10) {
    const parsed = new URL(currentUrl);
    
    // 检查是否为内网
    if (isPrivateURL(parsed)) {
        throw new Error('Redirect to private IP');
    }
    
    const response = await fetch(currentUrl, { redirect: 'manual' });
    
    if (response.status !== 301 && response.status !== 302) {
        break;
    }
    
    const location = response.headers.get('location');
    if (!location) break;
    
    currentUrl = new URL(location, parsed.origin).href;
    visited.add(currentUrl);
}
```

---

## 5. 认证和授权

### 5.1 当前状态

**问题**: Agent 服务无认证机制

```typescript
// 任何人都可以调用
app.post('/agent/run', async (req, res) => {
    const result = await agent.run(req.body.message);
    res.json(result);
});
```

### 5.2 修复建议

#### 5.2.1 API Key 认证

```typescript
import crypto from 'crypto';

const apiKeys = new Map<string, { userId: string; permissions: string[] }>();

function authenticate(req: Request): { userId: string } | null {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return null;
    
    const keyData = apiKeys.get(apiKey);
    if (!keyData) return null;
    
    return { userId: keyData.userId };
}

app.post('/agent/run', authenticate, async (req, res) => {
    // 认证通过
});
```

#### 5.2.2 JWT 认证

```typescript
import jwt from 'jsonwebtoken';

function verifyJWT(token: string): jwt.JwtPayload {
    return jwt.verify(token, process.env.JWT_SECRET!) as jwt.JwtPayload;
}
```

#### 5.2.3 基于角色的授权

```typescript
const rolePermissions = {
    admin: ['*'],
    developer: ['read_file', 'write_file', 'bash', 'grep', 'glob'],
    viewer: ['read_file', 'grep', 'glob'],
};

function authorize(action: string, userRole: string): boolean {
    const perms = rolePermissions[userRole];
    return perms.includes('*') || perms.includes(action);
}
```

---

## 6. 敏感信息保护

### 6.1 当前实现

**文件**: `src/agent-v2/security/index.ts`

```typescript
const SENSITIVE_FIELDS = ['apiKey', 'api_key', 'password', 'token', 'secret'];

function sanitize(obj: unknown): unknown {
    // 递归处理，替换敏感字段为 [REDACTED]
}
```

### 6.2 改进建议

#### 6.2.1 增强脱敏

```typescript
const SENSITIVE_PATTERNS = [
    // API Key 模式
    /sk-[a-zA-Z0-9]{20,}/,  // OpenAI
    /glc-[a-zA-Z0-9-]+/,    // GLM
    /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/,  // JWT
    
    // 密码模式
    /password["']?\s*[:=]\s*["']?[^"'{\n]+["']?/i,
    
    // 密钥模式
    /-----BEGIN (RSA |EC )?PRIVATE KEY-----/,
];

function enhancedSanitize(obj: unknown): unknown {
    if (typeof obj === 'string') {
        for (const pattern of SENSITIVE_PATTERNS) {
            obj = obj.replace(pattern, '[REDACTED]');
        }
        return obj;
    }
    // 递归处理对象
}
```

#### 6.2.2 密钥管理

```typescript
// 使用密钥管理服务
import { SecretsManager } from 'aws-sdk';

class SecretManager {
    async get(keyName: string): Promise<string> {
        // 从 AWS Secrets Manager 获取
        const result = await secretsManager.getSecretValue({
            SecretId: `agent/${keyName}`
        });
        return result.SecretString;
    }
}

// 不在代码中存储密钥
const apiKey = await secretsManager.get('openai-api-key');
```

---

## 总结: 安全加固建议

### 立即修复 (P0)

| 漏洞 | 修复方案 |
|-----|---------|
| shell: true | 改用 shell: false |
| 默认 Allow | 改为默认 Deny |
| 环境变量禁用安全 | 移除或限制 |
| 危险命令白名单 | 严格限制 |

### 高优先级 (P1)

| 漏洞 | 修复方案 |
|-----|---------|
| SSRF 防护不完整 | 添加 DNS rebinding 防护 |
| 敏感目录不完整 | 扩展黑名单 |
| 无认证机制 | 添加 API Key/JWT |

### 中优先级 (P2)

| 漏洞 | 修复方案 |
|-----|---------|
| TOCTOU 竞态 | 添加文件锁 |
| 命令替换检测 | 扩展模式匹配 |
| IPv6 不完整 | 添加 IPv6 黑名单 |

---

*文档版本: 1.0*
*最后更新: 2026-03-04*
