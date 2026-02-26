# Coding Agent 企业官网实现计划

## 概述

创建一个单页企业官网，使用 HTML + TailwindCSS 技术栈，共 3 屏页面，展示 Coding Agent 项目的核心技术能力、功能特性和应用场景。

## 技术选型

- **HTML5** - 语义化结构
- **TailwindCSS** - 通过 CDN 引入，快速样式开发
- **Font Awesome** - 图标库（CDN）
- **Google Fonts** - Inter 字体

## 页面结构设计

### 第 1 屏：Hero Section（品牌展示区）

**内容模块：**
- 顶部导航栏（Logo + 导航链接）
- 主标题：Coding Agent - 企业级 AI 编码助手框架
- 副标题：基于 TypeScript 构建的多模态 LLM Agent 系统
- 核心卖点标签（3-4 个）
- CTA 按钮（立即开始 / 查看文档）
- 技术栈标识（TypeScript、Node.js 等）

**视觉设计：**
- 深色科技风格背景
- 渐变效果
- 动态粒子或代码流背景（可选）

### 第 2 屏：核心技术架构

**内容模块：**
- 章节标题：核心技术架构
- 分层架构图展示（4 层架构）
  - 应用层（CLI/Web UI/API）
  - Agent 层（协调器、ReAct 引擎、工具注册表）
  - Provider 层（Provider 注册表、HTTP 客户端、适配器）
  - LLM 服务层（GLM/Kimi/MiniMax）
- 核心组件卡片（6 个）
  - Agent 协调器
  - LLMCaller
  - ToolExecutor
  - Session 会话管理
  - EventBus 事件总线
  - MemoryManager 持久化存储

**视觉设计：**
- 架构图使用 SVG 或 CSS 绘制
- 组件卡片采用 Grid 布局
- 悬停动效

### 第 3 屏：功能特性与应用场景

**内容模块：**
- 章节标题：强大功能 · 无限可能
- 功能特性网格（8 个核心特性）
  - 多轮对话支持
  - 16+ 内置工具
  - 流式实时输出
  - 智能自动重试
  - 上下文压缩
  - 任务中止控制
  - 多 Provider 支持
  - 持久化存储
- 工具系统展示（分类展示）
  - 文件操作工具
  - 搜索工具
  - 执行工具
  - Web 工具
  - 代码智能工具
  - 任务管理工具
- 底部 CTA + 页脚信息

**视觉设计：**
- 特性卡片采用 Grid 布局
- 工具分类使用 Tab 或分组展示
- 底部渐变收尾

## 实施步骤

### Step 1: 创建项目目录结构
- 在 `D:\work\coding-agent` 下创建 `website/` 目录
- 创建基础文件结构

### Step 2: 创建 HTML 主文件
- 创建 `index.html`
- 引入 TailwindCSS CDN
- 引入 Font Awesome CDN
- 引入 Google Fonts
- 构建语义化 HTML 结构

### Step 3: 实现第 1 屏 Hero Section
- 导航栏组件
- Hero 内容区
- CTA 按钮
- 响应式适配

### Step 4: 实现第 2 屏 技术架构
- 架构图可视化
- 核心组件卡片
- 交互动效

### Step 5: 实现第 3 屏 功能特性
- 功能特性网格
- 工具系统展示
- 页脚信息

### Step 6: 优化与测试
- 响应式测试
- 浏览器兼容性测试
- 性能优化

## 交付物

| 文件 | 说明 |
|------|------|
| `website/index.html` | 主页面文件 |
| `website/css/custom.css` | 自定义样式（如需要） |
| `website/images/` | 图片资源目录 |

## 验收标准

- [ ] 页面共 3 屏，每屏内容清晰
- [ ] 使用 TailwindCSS 进行样式设计
- [ ] 响应式设计，适配桌面和移动端
- [ ] 包含项目核心技术内容介绍
- [ ] 包含功能特性展示
- [ ] 视觉风格统一，具有科技感
- [ ] 页面加载性能良好
- [ ] 无外部依赖（除 CDN 外）

## 注意事项

1. TailwindCSS 使用 CDN 方式引入，方便快速开发
2. 颜色方案采用科技蓝/深色主题
3. 确保所有技术描述准确，基于 README 和架构文档
4. 保持代码整洁，注释清晰