# Glob、Grep、Bash 工具深度解析

> 文档生成时间：2026-01-31
> 适用版本：Claude Code (glm-4.7)
> 相关文档：
> - [所有工具系统提示词完整版](./claude-code-all-tools-prompts.md)

---

## 目录

1. [三个工具的核心区别](#一三个工具的核心区别)
2. [Glob 工具详解](#二-glob-工具详解)
3. [Grep 工具详解](#三-grep-工具详解)
4. [Bash 工具详解](#四-bash-工具详解)
5. [内联脚本执行](#五内联脚本执行)
6. [决策流程图](#六决策流程图)
7. [实战示例](#七实战示例)

---

## 一、三个工具的核心区别

### 1.1 本质区别

```
┌─────────────────────────────────────────────────────────────────┐
│                    Glob vs Grep vs Bash                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │
│  │    Glob     │    │    Grep     │    │    Bash     │        │
│  │             │    │             │    │             │        │
│  │  按文件名   │    │  按文件内容 │    │  执行命令   │        │
│  │  查找文件   │    │  搜索文件   │    │             │        │
│  │             │    │             │    │  Git/NPM/    │        │
│  │  **/*.js    │    │  "function" │    │  Docker/等   │        │
│  │             │    │             │    │             │        │
│  └─────────────┘    └─────────────┘    └─────────────┘        │
│                                                                 │
│  类比：                                                           │
│  ───────────────────────────────────────────────────────────   │
│  Glob → 在目录中按"文件名"找文件                                │
│  Grep → 在文件中按"内容"找文字                                  │
│  Bash → 执行任何终端命令                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 快速对比表

| 维度 | Glob | Grep | Bash |
|------|------|------|------|
| **搜索对象** | 文件名/路径 | 文件内容 | 执行命令 |
| **典型用途** | 找所有 .js 文件 | 找包含"TODO"的文件 | git/npm/docker |
| **返回结果** | 文件路径列表 | 匹配行/文件列表 | 命令输出 |
| **支持模式** | glob 通配符 | 正则表达式 | shell 命令 |
| **能否执行** | ❌ | ❌ | ✅ |
| **能否修改** | ❌ | ❌ | ✅ |

### 1.3 使用优先级

```
系统提示词明确要求：

❌ 不要用 Bash 执行文件操作
✅ 优先使用专用工具

Bash 的 grep/rg → 用 Grep 工具
Bash 的 find → 用 Glob 工具
Bash 的 cat/head/tail → 用 Read 工具
```

---

## 二、Glob 工具详解

### 2.1 系统提示词（完整）

```
- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing
  and grepping, use the Agent tool instead
- You can call multiple tools in a single response. It is always better to speculatively
  perform multiple searches in parallel if potentially useful.
```

### 2.2 核心特点

| 特点 | 说明 |
|------|------|
| **快速** | 适用于任何规模的代码库 |
| **排序** | 按修改时间返回结果 |
| **模式匹配** | 支持 glob 通配符 |
| **并行友好** | 鼓励并行调用多个搜索 |

### 2.3 Glob 模式语法

| 模式 | 匹配 | 示例 |
|------|------|------|
| `*` | 任意字符（不含路径分隔符） | `*.js` → 所有.js文件 |
| `**` | 任意路径（含子目录） | `**/*.js` → 所有目录下的.js |
| `?` | 单个字符 | `file?.txt` → file1.txt, fileA.txt |
| `[]` | 字符集 | `[abc].js` → a.js, b.js, c.js |
| `!` | 否定 | `!*.test.js` → 排除测试文件 |

### 2.4 参数说明

```javascript
Glob(
  pattern: string,    // 必需：glob 匹配模式
  path?: string       // 可选：搜索目录，默认当前工作目录
)
```

### 2.5 使用场景

| 场景 | 命令 | 说明 |
|------|------|------|
| 找所有JS文件 | `**/*.js` | 递归搜索所有目录 |
| 找特定目录的文件 | `src/**/*.ts` | 只在src目录下 |
| 找测试文件 | `**/*.test.js` | 查找测试文件 |
| 找配置文件 | `*.json` | 当前目录的JSON |
| 找多种类型 | 并行调用 | 一次调用多个Glob |

### 2.6 使用示例

```javascript
// 基础用法
Glob(pattern: "**/*.js")

// 指定目录
Glob(pattern: "**/*.ts", path: "/home/user/project")

// 并行搜索多个模式（推荐）
Glob(pattern: "**/*.js")
Glob(pattern: "**/*.ts")
Glob(pattern: "**/*.json")

// 复杂模式
Glob(pattern: "src/**/*.{js,ts}")   // src下所有js和ts
Glob(pattern: "**/[A-Z]*.js")       // 大写开头的js文件
```

### 2.7 什么时候不用 Glob

| 应该用其他工具 | 场景 |
|---------------|------|
| 用 `Grep` | 需要按内容搜索文件 |
| 用 `Read` | 已知确切文件路径 |
| 用 `Task(Explore)` | 开放式探索代码库 |

---

## 三、Grep 工具详解

### 3.1 系统提示词（完整）

```
A powerful search tool built on ripgrep

Usage:
- ALWAYS use Grep for search tasks. NEVER invoke `grep` or `rg` as a Bash command.
  The Grep tool has been optimized for correct permissions and access.
- Supports full regex syntax (e.g., "log.*Error", "function\s+\w+")
- Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter
  (e.g., "js", "py", "rust", "go", "java", etc.). More efficient than include for
  common file types.
- Output modes: "content" shows matching lines (supports -A/-B/-C context, -n line
  numbers, head_limit), "files_with_matches" shows only file paths (default),
  "count" shows match counts (supports head_limit). Defaults to "files_with_matches".
- Use Task tool for open-ended searches requiring multiple rounds
- Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping
  (use interface\{\\} to find interface{} in Go code)
- Multiline matching: By default patterns match within single lines only.
  For cross-line patterns like struct \{[\s\S]*?field`, use multiline: true
```

### 3.2 核心特点

| 特点 | 说明 |
|------|------|
| **基于 ripgrep** | 优化了权限和访问 |
| **正则表达式** | 完整的 regex 支持 |
| **多种输出模式** | content/files_with_matches/count |
| **文件过滤** | 支持 glob 或 type 参数 |
| **多行匹配** | 支持跨行搜索 |

### 3.3 参数完整说明

```javascript
Grep(
  pattern: string,           // 必需：正则表达式模式
  path?: string,             // 可选：搜索路径
  glob?: string,             // 可选：文件过滤（glob模式）
  type?: string,             // 可选：文件类型（js, py, rust, go, java等）
  output_mode?: string,      // 可选：content/files_with_matches/count
  n?: boolean,               // 可选：显示行号，默认true
  i?: boolean,               // 可选：忽略大小写
  C?: number,                // 可选：上下文行数（前后各N行）
  A?: number,                // 可选：后置行数（匹配后N行）
  B?: number,                // 可选：前置行数（匹配前N行）
  head_limit?: number,       // 可选：结果数量限制
  offset?: number,           // 可选：偏移量（跳过前N个结果）
  multiline?: boolean        // 可选：多行匹配，默认false
)
```

### 3.4 输出模式详解

| 模式 | 说明 | 返回内容 |
|------|------|----------|
| `files_with_matches` | 默认模式 | 只返回文件路径列表 |
| `content` | 内容模式 | 返回匹配的行（支持上下文） |
| `count` | 计数模式 | 返回每个文件的匹配次数 |

### 3.5 上下文参数

```javascript
// C - 同时显示前后N行
Grep(pattern: "Error", C: 3)
// 输出：匹配行 + 前3行 + 后3行

// A - 只显示后N行
Grep(pattern: "Error", A: 5)
// 输出：匹配行 + 后5行

// B - 只显示前N行
Grep(pattern: "Error", B: 2)
// 输出：匹配行 + 前2行
```

### 3.6 使用场景

| 场景 | 命令示例 |
|------|----------|
| 查找包含TODO的文件 | `Grep(pattern: "TODO")` |
| 搜索函数定义 | `Grep(pattern: "function\\s+\\w+", type: "js")` |
| 带上下文搜索 | `Grep(pattern: "Error", C: 3, type: "js")` |
| 忽略大小写 | `Grep(pattern: "import.*react", i: true)` |
| 多行匹配 | `Grep(pattern: "struct\\s*\\{[\\s\\S]*?field", multiline: true)` |
| 限制结果数量 | `Grep(pattern: "TODO", head_limit: 20)` |

### 3.7 正则表达式注意事项

```
⚠️ 重要：使用 ripgrep 语法

1. 字面量花括号需要转义：
   错误：interface\{.*\}
   正确：interface\{\\}.*\{\\}

2. 匹配特殊字符：
   - . → 任意字符
   - \. → 字面量的点
   - \s → 空白字符
   - \w → 单词字符
   - \d → 数字

3. 常用模式：
   - "function\s+\w+" → function 定义
   - "import.*from" → import 语句
   - "class\s+\w+" → class 定义
   - "\{\\}" → 花括号字面量
```

### 3.8 使用示例

```javascript
// 基础搜索 - 找包含"TODO"的文件
Grep(pattern: "TODO")

// 按类型搜索 - 在JS文件中找"export"
Grep(pattern: "export", type: "js")

// 正则表达式 - 找函数定义
Grep(pattern: "function\\s+\\w+", type: "js")

// 带上下文 - 找Error并显示前后3行
Grep(pattern: "Error", type: "js", C: 3)

// 忽略大小写
Grep(pattern: "import.*react", type: "js", i: true)

// 输出模式 - 显示匹配内容
Grep(pattern: "TODO", output_mode: "content", n: true)

// 限制结果
Grep(pattern: "console.log", type: "js", head_limit: 10)

// 多行匹配
Grep(pattern: "struct\\s*\\{[\\s\\S]*?field", multiline: true)

// 并行搜索多个模式（推荐）
Grep(pattern: "TODO", type: "js")
Grep(pattern: "FIXME", type: "js")
Grep(pattern: "XXX", type: "js")
```

### 3.9 什么时候不用 Grep

| 应该用其他工具 | 场景 |
|---------------|------|
| 用 `Glob` | 只按文件名查找 |
| 用 `Read` | 已知具体文件 |
| 用 `Task(Explore)` | 复杂的多轮搜索 |

---

## 四、Bash 工具详解

### 4.1 系统提示词（核心部分）

```
Executes a given bash command with optional timeout. Working directory persists between
commands; shell state (everything else) does not. The shell environment is initialized
from the user's profile (bash or zsh).

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc.
DO NOT use it for file operations (reading, writing, editing, searching, finding files) -
use the specialized tools instead.

Usage notes:
- The command argument is required.
- You can specify an optional timeout in milliseconds (up to 600000ms / 10 minutes).
  If not specified, commands timeout after 120000ms (2 minutes).
- It's very helpful if you write a clear, concise description of what the command does.
  For simple commands (git, npm, standard CLI tools), keep it brief (5-10 words).
  For commands harder to parse at a glance (piped commands, obscure flags, or anything
  hard to understand at a glance), add enough context to clarify what it does.
- You can use the `run_in_background` parameter to run the command in the background.
  Only use this if you don't need the result immediately and are OK being notified when
  it completes later. You do not need to check the output right away - you'll be notified
  when it finishes.
- Don't use '&' at the end of the command when using this parameter.

When issuing multiple commands:
- If the commands are independent and can run in parallel, use the Bash tool in parallel
  with multiple tool calls.
- If the commands depend on each other and must run sequentially, use a single Bash
  call with '&&' to chain them together (e.g., `mkdir foo && cd foo && ls`), or ';'
  if they can run sequentially but the later commands should run even if earlier ones fail.

Try to maintain your current working directory throughout the session by using absolute
paths and avoiding usage of `cd`. You may use `cd` if the User explicitly requests it.
```

### 4.2 核心特点

| 特点 | 说明 |
|------|------|
| **工作目录持久** | 目录状态保持，shell 状态不保持 |
| **环境初始化** | 从用户 profile（bash/zsh）初始化 |
| **超时控制** | 默认 120 秒，最大 600 秒 |
| **后台运行** | 支持 `run_in_background` |
| **并行执行** | 鼓励并行调用独立命令 |

### 4.3 参数说明

```javascript
Bash(
  command: string,               // 必需：要执行的命令
  description?: string,          // 可选：命令描述
  timeout?: number,              // 可选：超时时间（毫秒），最大600000
  run_in_background?: boolean    // 可选：是否后台运行
)
```

### 4.4 什么时候使用 Bash

| 场景 | 示例命令 |
|------|----------|
| **Git 操作** | `git status`, `git commit`, `git push` |
| **包管理** | `npm install`, `yarn add`, `pip install` |
| **容器操作** | `docker build`, `docker-compose up` |
| **编译构建** | `make`, `mvn package`, `gradle build` |
| **服务器** | `npm start`, `python server.py` |
| **测试** | `npm test`, `pytest` |
| **脚本执行** | `./deploy.sh`, `node script.js` |
| **系统操作** | `ls`, `cp`, `mv`, `mkdir`（复杂场景） |

### 4.5 什么时候**不**使用 Bash

| ❌ 不要用 Bash 做 | ✅ 应该用的工具 |
|------------------|----------------|
| `cat file.txt` | `Read(file_path)` |
| `echo "text" > file` | `Write(file_path, content)` |
| `sed 's/old/new/' file` | `Edit(file_path, old_string, new_string)` |
| `find . -name "*.js"` | `Glob(pattern: "**/*.js")` |
| `grep "pattern" file` | `Grep(pattern: "pattern")` |
| `head file.txt` | `Read(file_path, limit: 10)` |
| `tail file.txt` | `Read(file_path, offset: -10)` |

### 4.6 命令链接方式

```javascript
// && - 前一个成功才执行后一个
Bash(command: "mkdir foo && cd foo && ls")
// 如果 mkdir 失败，后续命令不执行

// ; - 顺序执行，无论前一个成功失败
Bash(command: "command1; command2; command3")
// 所有命令都会执行

// || - 前一个失败才执行后一个
Bash(command: "command1 || command2")
// command1 失败时执行 command2

// | - 管道，前一个的输出作为后一个的输入
Bash(command: "cat file.json | jq '.data[]'")
```

### 4.7 并行执行原则

```
系统提示词明确要求：

✅ 独立命令 - 并行调用
Bash(command: "git status")
Bash(command: "git diff")
Bash(command: "git log")
// 三个命令在一个消息中发送

❌ 依赖命令 - 必须串行
Bash(command: "mkdir foo && cd foo && ls")
// 使用 && 链接
```

### 4.8 使用示例

```javascript
// Git 操作
Bash(command: "git status", description: "Show working tree status")
Bash(command: "git diff", description: "Show unstaged changes")
Bash(command: "git log --oneline -10", description: "Show recent commits")

// NPM 操作
Bash(command: "npm install", description: "Install dependencies")
Bash(command: "npm run build", description: "Build the project")
Bash(command: "npm test", description: "Run tests")

// Docker 操作
Bash(command: "docker build -t myapp .", description: "Build Docker image")
Bash(command: "docker-compose up -d", description: "Start services")

// 后台运行
Bash(
  command: "npm test",
  description: "Run test suite in background",
  run_in_background: true
)

// 带超时
Bash(
  command: "npm run test:integration",
  description: "Run integration tests",
  timeout: 300000  // 5分钟
)

// 链式命令
Bash(command: "mkdir -p build/dist && npm run build && ls build/dist")

// 管道命令
Bash(command: "cat package.json | jq '.dependencies'")
```

### 4.9 Bash 描述规范

```
简单命令（5-10词）：
- "List files in current directory"
- "Show working tree status"
- "Install package dependencies"

复杂命令（需要更多上下文）：
- "Find and delete all .tmp files recursively"
- "Discard all local changes and match remote main"
- "Fetch JSON from URL and extract data array"
```

---

## 五、内联脚本执行

### 5.1 系统提示词相关说明

```
虽然没有专门的"内联脚本"提示词节，但根据 Bash 工具的定义：

Executes a given bash command with optional timeout.

这意味着可以执行任何 bash 命令，包括内联脚本：
- node -e "console.log('hello')"
- python -c "print('hello')"
- python3 -c "import json; print(json.dumps({'a': 1}))"
```

### 5.2 Node.js 内联脚本

```javascript
// 基础用法
Bash(command: 'node -e "console.log(\'Hello World\')"')

// 多行脚本（使用 \n）
Bash(command: 'node -e "const x = 10; console.log(x * 2)"')

// 处理 JSON
Bash(command: 'node -e "console.log(JSON.stringify({a: 1, b: 2}, null, 2))"')

// 从环境变量读取
Bash(command: 'node -e "console.log(process.env.NODE_ENV)"')

// 管道输出
Bash(command: 'cat data.json | node -e "let data=\'\';process.stdin.on(\'data\',c=>data+=c);process.stdin.on(\'end\',()=>console.log(JSON.parse(data).length))"')
```

### 5.3 Python 内联脚本

```javascript
// Python 3 基础
Bash(command: 'python3 -c "print(\'Hello World\')"')

// JSON 处理
Bash(command: 'python3 -c "import json; print(json.dumps({\'a\': 1}, indent=2))"')

// 多行脚本
Bash(command: 'python3 -c "import json; data = {\'x\': 1, \'y\': 2}; print(json.dumps(data))"')

// 数学计算
Bash(command: 'python3 -c "print(2 ** 10)"')
```

### 5.4 实用内联脚本示例

```javascript
// 1. JSON 格式化
Bash(command: 'cat file.json | node -e "console.log(JSON.stringify(JSON.parse(require(\'fs\').readFileSync(0)), null, 2))"')

// 2. 统计行数
Bash(command: 'node -e "console.log(require(\'fs\').readFileSync(\'file.txt\', \'utf8\').split(\'\\n\').length)"')

// 3. 提取 package.json 版本
Bash(command: 'node -e "console.log(require(\'./package.json\').version)"')

// 4. 批量重命名
Bash(command: 'node -e "const fs=require(\'fs\');fs.readdirSync(\'.\').filter(f=>f.endsWith(\'.js\')).forEach(f=>fs.renameSync(f,\'new_\'+f))"')

// 5. 简单 HTTP 请求
Bash(command: 'node -e "require(\'https\').get(\'https://api.github.com/users/github\', res=>{let data=\'\';res.on(\'data\',c=>data+=c);res.on(\'end\',()=>console.log(data))})"')

// 6. base64 编码
Bash(command: 'node -e "console.log(Buffer.from(\'hello\').toString(\'base64\'))"')

// 7. 生成时间戳
Bash(command: 'node -e "console.log(Date.now())"')

// 8. 读取环境变量
Bash(command: 'node -e "console.log(process.env.PATH || \'PATH not set\')"')
```

### 5.5 复杂内联脚本技巧

```javascript
// 使用 heredoc 保持可读性
Bash(command: 'node <<\'EOF\'
const data = require("./data.json");
const result = data.map(x => x.value * 2);
console.log(JSON.stringify(result));
EOF')

// 处理 stdin 输入
Bash(command: 'cat input.json | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(json.dumps({\'count\': len(data)}, indent=2))
"')

// 组合多个工具
Bash(command: 'cat package.json | grep "version" | node -e "console.log(require(\'fs\').readFileSync(0, \'utf8\').match(/\"version\": \"([^\"]+)\"/)[1])"')
```

---

## 六、决策流程图

### 6.1 工具选择决策树

```
┌─────────────────────────────────────────────────────────────────┐
│                      需要操作文件？                              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                ┌────────────┴────────────┐
                │                         │
                ▼                         ▼
        ┌───────────────┐         ┌───────────────┐
        │ 按文件名查找  │         │ 执行其他操作  │
        │     → Glob    │         └───────┬───────┘
        └───────────────┘                 │
                                         ▼
                                ┌─────────────────┐
                                │ 需要搜索内容？  │
                                └────────┬────────┘
                                         │
                            ┌────────────┴────────────┐
                            │                         │
                            ▼                         ▼
                    ┌───────────────┐         ┌───────────────┐
                    │ 按内容搜索    │         │ 执行命令      │
                    │     → Grep    │         │     → Bash    │
                    └───────────────┘         └───────────────┘
```

### 6.2 场景速查表

| 需求 | 使用工具 | 命令示例 |
|------|----------|----------|
| 找所有 .js 文件 | Glob | `**/*.js` |
| 找 src 下的 .ts | Glob | `src/**/*.ts` |
| 搜索"TODO" | Grep | `pattern: "TODO"` |
| 搜索函数定义 | Grep | `pattern: "function\\s+\\w+"` |
| Git 状态 | Bash | `git status` |
| 安装依赖 | Bash | `npm install` |
| 运行测试 | Bash | `npm test` |
| 读文件内容 | Read | (不是 Bash!) |

### 6.3 并行执行示例

```
✅ 正确：并行搜索多个模式
Grep(pattern: "TODO", type: "js")
Grep(pattern: "FIXME", type: "js")
Grep(pattern: "XXX", type: "js")

✅ 正确：并行执行独立 git 命令
Bash(command: "git status")
Bash(command: "git diff")
Bash(command: "git log --oneline -5")

❌ 错误：依赖命令必须串行
Bash(command: "git status")
Bash(command: "git commit -m 'msg'")  // 需要先status确认
// 正确做法：用 && 链接
Bash(command: "git add . && git commit -m 'msg'")
```

---

## 七、实战示例

### 7.1 场景一：探索项目结构

```javascript
// 任务：了解一个 Node.js 项目的结构

// 步骤1：找到所有关键文件
Glob(pattern: "package.json")
Glob(pattern: "*.md")
Glob(pattern: "src/**/*.js")
Glob(pattern: "test/**/*.js")

// 步骤2：搜索特定模式
Grep(pattern: "export\\s+default", type: "js")
Grep(pattern: "TODO|FIXME", type: "js", i: true)

// 步骤3：读取关键文件
Read(file_path: "/path/to/package.json")
Read(file_path: "/path/to/README.md")
```

### 7.2 场景二：查找所有测试文件

```javascript
// 方法1：使用 Glob
Glob(pattern: "**/*.test.js")
Glob(pattern: "**/*.spec.js")

// 方法2：使用 Grep
Grep(pattern: "describe\\(|it\\(", type: "js")

// 组合使用
Glob(pattern: "test/**/*.js")
Grep(pattern: "import.*test", type: "js")
```

### 7.3 场景三：查找所有 console.log

```javascript
// 找到所有包含 console.log 的 JS 文件
Grep(pattern: "console\\.log", type: "js")

// 显示上下文
Grep(pattern: "console\\.log", type: "js", C: 2, output_mode: "content")

// 限制结果
Grep(pattern: "console\\.log", type: "js", head_limit: 50)

// 并行搜索多种日志
Grep(pattern: "console\\.log", type: "js")
Grep(pattern: "console\\.error", type: "js")
Grep(pattern: "console\\.warn", type: "js")
```

### 7.4 场景四：Git 工作流

```javascript
// 并行获取状态
Bash(command: "git status")
Bash(command: "git diff")
Bash(command: "git log --oneline -10")

// 创建提交
Bash(command: "git add .")
Bash(command: "git commit -m \"$(cat <<'EOF'\nAdd new feature\n\nCo-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>\nEOF\n)\"")

// 推送到远程
Bash(command: "git push")
```

### 7.5 场景五：批量操作

```javascript
// 使用 Node.js 内联脚本批量重命名
Bash(command: `
node -e "
const fs = require('fs');
const files = fs.readdirSync('.');
files.filter(f => f.endsWith('.js')).forEach(f => {
  const newName = 'dist_' + f;
  fs.renameSync(f, newName);
  console.log('Renamed:', f, '→', newName);
});
"
`)

// 使用 Python 统计代码行数
Bash(command: `
python3 -c "
import os
total = 0
for root, dirs, files in os.walk('.'):
    for f in files:
        if f.endswith('.js'):
            path = os.path.join(root, f)
            with open(path) as file:
                lines = len(file.readlines())
                total += lines
                print(f'{path}: {lines} lines')
print(f'Total: {total} lines')
"
`)
```

### 7.6 场景六：调试和分析

```javascript
// 找到所有 Error 相关代码
Grep(pattern: "throw new Error", type: "js", C: 3, output_mode: "content")

// 检查环境变量使用
Grep(pattern: "process\\.env\\.", type: "js", output_mode: "content")

// 分析依赖关系
Bash(command: "cat package.json | node -e \"console.log(Object.keys(JSON.parse(require('fs').readFileSync(0)).dependencies).join('\\n'))\"")

// 检查未使用的依赖
Bash(command: "npx depcheck")
```

---

## 八、总结对比表

### 8.1 三个工具完整对比

| 维度 | Glob | Grep | Bash |
|------|------|------|------|
| **用途** | 按文件名查找 | 按内容搜索 | 执行命令 |
| **输入** | glob 模式 | 正则表达式 | shell 命令 |
| **输出** | 文件路径列表 | 匹配结果 | 命令输出 |
| **搜索范围** | 文件系统 | 文件内容 | N/A |
| **执行能力** | ❌ | ❌ | ✅ |
| **并行友好** | ✅ | ✅ | ✅ |
| **典型场景** | 找所有.js文件 | 找"TODO" | git/npm/docker |

### 8.2 选择决策表

| 你的需求 | 使用 | 示例 |
|----------|------|------|
| 找特定类型的文件 | Glob | `**/*.js` |
| 按文件名模式搜索 | Glob | `src/**/*.ts` |
| 在文件中搜索文字 | Grep | `pattern: "TODO"` |
| 搜索函数/类定义 | Grep | `pattern: "class\\s+\\w+"` |
| Git 操作 | Bash | `git status` |
| 安装依赖 | Bash | `npm install` |
| 运行脚本 | Bash | `npm run build` |
| 读文件 | Read | (不是 Bash!) |
| 写文件 | Write | (不是 Bash!) |

### 8.3 最佳实践

| DO (应该做) | DON'T (不应该做) |
|-------------|-----------------|
| Glob/Grep 用于搜索 | 用 Bash 的 grep/find |
| Bash 用于 git/npm | 用 Bash 操作文件 |
| 并行调用独立搜索 | 串行调用独立命令 |
| Read 读取文件 | 用 Bash 的 cat |
| Write 写入文件 | 用 Bash 的 echo > |

---

**文档结束**

> 本档详细解析了 Glob、Grep、Bash 三个工具的系统提示词、使用方法和决策逻辑。
