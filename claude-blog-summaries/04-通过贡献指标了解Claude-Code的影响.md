# 通过贡献指标了解 Claude Code 的影响

**发布日期**：2026年1月29日  
**分类**：Claude Code  
**阅读时间**：5 分钟

## 概述

Anthropic 今天在 Claude Code 中引入了贡献指标（现已处于公共测试版）。工程团队现在可以衡量 Claude Code 如何影响其团队速度，跟踪在 Claude 帮助下合并的 PR 和提交的代码。

## 内部验证数据

### Anthropic 的使用经验
- 工程团队在 Anthropic 广泛使用 Claude Code
- 贡献数据帮助量化其影响
- 随着 Claude Code 采用率内部增加，每位工程师每天合并的 PR 数量增加了 67%
- 跨团队，70-90% 的代码现在是在 Claude Code 辅助下编写的

### 为什么 PR 的重要性
虽然 PR 本身是开发者速度的不完整衡量指标，但 Anthropic 发现它们是工程团队关心的内容的接近代理：
- 更快地发布功能
- 修复错误
- 更快地让用户满意

## 贡献指标功能

### 数据收集方法
通过与 GitHub 集成，贡献指标提供以下数据点：

1. **合并的拉取请求（Pull Requests Merged）**
   - 跟踪有和没有 Claude Code 辅助下创建的 PR

2. **提交的代码（Code Committed）**
   - 查看有和没有 Claude Code 辅助下提交到仓库的代码行

3. **每用户贡献数据**
   - 识别跨团队的采用模式

### 计算方法
- 通过将 Claude Code 会话活动与 GitHub 提交和 PR 匹配来计算贡献数据
- 保守计算方法
- 仅在 Claude Code 参与度高置信度时才将代码计为辅助

### 仪表板访问
- 指标显示在现有的 Claude Code 分析仪表板中
- 工作区管理员和所有者可访问
- 无需外部工具或数据流水线
- 只需安装 Claude GitHub App 并向组织的 GitHub 账户进行身份验证

## 集成设置

### 如何启用贡献指标
1. 为组织安装 [Claude GitHub App](https://github.com/apps/claude)
2. 导航到 [Admin settings > Claude Code](http://claude.ai/admin-settings/claude-code) 并开启 GitHub Analytics
3. 向 GitHub 组织进行身份验证

### 自动化
- 指标在团队使用 Claude Code 时自动开始填充
- 无需手动配置或数据管道

## 指标的应用

### 与现有 KPI 配合使用
- 与 DORA 指标结合使用
- 与冲刺速度结合使用
- 或其他工程度量标准一起使用
- 有助于了解将 Claude Code 引入团队的方向性变化

### 管理洞察
- 识别团队中的采用模式
- 了解哪些开发者从 Claude Code 中受益最多
- 跟踪 Claude Code 随时间的采用和影响

## 相关资源

- [详细文档](https://code.claude.com/docs/en/analytics)
- GitHub App：[github.com/apps/claude](https://github.com/apps/claude)

## 总结

贡献指标为希望量化 Claude Code 对其开发工作影响的工程团队和组织提供了宝贵工具。通过自动跟踪 PR 和代码提交，团队可以：

1. **量化生产力提升**
2. **识别采用模式**
3. **证明 AI 辅助编程的价值**
4. **与现有工程 KPI 配合**

该功能目前处于公共测试版，可供 Claude Team 和 Enterprise 客户使用。
