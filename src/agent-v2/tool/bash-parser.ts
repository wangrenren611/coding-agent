// @ts-ignore - bash-parser 是 CommonJS 模块
import parse from 'bash-parser'
// =============================================================================
// 安全模式常量
// =============================================================================

/**
 * 危险命令集合
 * 这些命令可能对系统造成破坏性影响
 */
const DANGEROUS_COMMANDS = new Set([
    'rm',      // 删除文件/目录
    'rmdir',   // 删除空目录
    'mkfs',    // 创建文件系统
    'dd',      // 磁盘复制/转换
    'format',  // 格式化磁盘
    'fdisk',   // 磁盘分区
    'mkswap',  // 创建交换空间
    'swapoff', // 关闭交换空间
    'blockdev',// 块设备操作
]);

/**
 * 危险标志集合
 * 用于检测 rm 等命令的危险组合
 */
const DANGEROUS_FLAGS = new Set(['rf', 'fr', 'f']);

/**
 * 系统权限提升命令
 * 这些命令需要额外权限，需要警告用户
 */
const SYSTEM_MODIFIERS = new Set(['sudo', 'su', 'doas', 'run0']);

// =============================================================================
// 语法高亮用的 ANSI 颜色代码
// =============================================================================


// =============================================================================
// 类型定义
// =============================================================================

/**
 * 命令信息
 */
export interface CommandInfo {
    /** 原始命令字符串 */
    raw: string;
    /** 命令名称（如 echo, ls） */
    program?: string;
    /** 命令参数列表 */
    arguments: string[];
    /** 是否包含管道操作 */
    pipes: boolean;
    /** 是否后台执行 */
    background: boolean;
    /** 重定向列表（如 > file, 2>&1） */
    redirections: string[];
}

/**
 * 安全问题
 */
export interface SecurityIssue {
    /** 严重级别 */
    level: 'warning' | 'danger' | 'critical';
    /** 问题描述 */
    message: string;
    /** 问题位置（可选） */
    position?: { row: number; column: number };
}

/**
 * 解析结果
 */
export interface ParseResult {
    /** 语法是否有效 */
    valid: boolean;
    /** 错误信息（如果语法无效） */
    error?: string;
    /** 命令结构信息 */
    info?: CommandInfo;
    /** 安全问题列表 */
    security?: SecurityIssue[];
    /** 带语法高亮的命令 */
    highlighted?: string;
}

// =============================================================================
// BashParser 类
// =============================================================================

/**
 * Bash 命令解析器
 *
 * 使用 bash-parser 进行 AST 解析，同时收集：
 * - 命令结构信息
 * - 安全问题
 * - 语法高亮片段
 *
 * @class BashParser
 * @example
 * ```ts
 * const parser = new BashParser();
 * const result = parser.parse('ls -la');
 * ```
 */
export class BashParser {
    /** 是否已完成初始化 */
    private ready = false;

    /**
     * 初始化解析器
     * bash-parser 不需要初始化，此方法仅为兼容性保留
     */
    async init(): Promise<void> {
        this.ready = true;
    }

    /**
     * 解析 bash 命令
     *
     * 执行以下操作：
     * 1. 检查语法错误（通过 try-catch 捕获 SyntaxError）
     * 2. 遍历 AST 收集所有信息
     * 3. 生成语法高亮输出
     *
     * @param command - 要解析的 bash 命令
     * @returns 解析结果
     */
    parse(command: string): ParseResult {
        // 空命令直接返回
        if (!command || !command.trim()) return { valid: true, highlighted: '' };

        try {
            // 生成 AST
            const ast = parse(command);

            // 遍历 AST 收集所有数据（结构、安全、高亮）
            const data = this.traverse(ast, command);

            return {
                valid: true,
                info: data.info,
                security: data.security.length > 0 ? data.security : undefined,
            };
        } catch (err) {
            // 捕获语法错误
            if (err instanceof SyntaxError) {
                return {
                    valid: false,
                    error: `Syntax error: ${err.message}`,
                    highlighted: command,
                };
            }
            throw err;
        }
    }

    /**
     * 遍历 AST 收集所有数据
     *
     * 这是核心方法，一次遍历同时收集：
     * - 命令结构信息（program、arguments、pipes 等）
     * - 安全问题（危险命令、sudo 等）
     * - 语法高亮片段（带颜色信息的位置）
     *
     * Bash-parser AST 节点类型：
     * - Script: 根节点，包含 commands 数组
     * - Command: 命令节点，包含 name 和 suffix
     * - Pipeline: 管道操作，包含 commands 数组
     * - List: 命令列表（用 ;, &&, || 分隔）
     * - Subshell: 子shell (command)
     * - Word: 普通词，可能包含 expansion
     * - ParameterExpansion: ${VAR} 参数展开
     * - CommandExpansion: $(cmd) 命令替换
     * - ArithmeticExpansion: $((expr)) 算术展开
     * - Redirect: 重定向操作，包含 op 和 file
     * - async: 后台执行标志
     *
     * @param root - AST 根节点
     * @param source - 原始命令字符串
     * @returns 包含 info、security、segments 的数据对象
     */
    private traverse(root: any, source: string) {
        // 初始化结果收集器
        const info: CommandInfo = {
            raw: source,
            arguments: [],
            pipes: false,
            background: false,
            redirections: [],
        };
        const security: SecurityIssue[] = [];
        const segments: Array<{ start: number; end: number; color: string }> = [];

        /**
         * 递归访问 AST 节点
         *
         * @param node - 当前节点
         * @param parent - 父节点（用于判断上下文）
         */
        const visit = (node: any, parent: any = null) => {
            if (!node || typeof node !== 'object') return;

            const type = node.type;
            const text = node.text;

            // 根据节点类型收集信息
            switch (type) {
                case 'Command':
                    // 命令节点：包含 name 和 suffix
                    if (node.name && node.name.text) {
                        if (!info.program) info.program = node.name.text;
                    }
                    if (node.suffix && Array.isArray(node.suffix)) {
                        for (const suffix of node.suffix) {
                            visit(suffix, node);
                        }
                    }
                    if (node.async) {
                        info.background = true;
                    }
                    break;

                case 'Word':
                    // 普通词
                    if (text) {
                        info.arguments.push(text);
                    }
                    // 检查是否包含展开
                    if (node.expansion && Array.isArray(node.expansion)) {
                        for (const exp of node.expansion) {
                            visit(exp, node);
                        }
                    }
                    break;

                case 'ParameterExpansion':
                    // 参数展开 ${VAR}
                    if (node.parameter) {
                        security.push({
                            level: 'warning',
                            message: 'Command contains parameter expansion',
                        });
                    }
                    break;

                case 'ArithmeticExpansion':
                    // 算术展开 $((expr))
                    security.push({
                        level: 'warning',
                        message: 'Command contains arithmetic expansion',
                    });
                    break;

                case 'CommandExpansion':
                    // 命令替换 $(cmd)
                    security.push({
                        level: 'warning',
                        message: 'Command contains command substitution',
                    });
                    break;

                case 'Pipeline':
                    // 管道操作
                    info.pipes = true;
                    if (node.commands && Array.isArray(node.commands)) {
                        for (const cmd of node.commands) {
                            visit(cmd, node);
                        }
                    }
                    break;

                case 'List':
                    // 命令列表（用 ;, &&, || 分隔）
                    if (node.commands && Array.isArray(node.commands)) {
                        for (const cmd of node.commands) {
                            visit(cmd, node);
                        }
                    }
                    break;

                case 'Subshell':
                    // 子shell (command)
                    if (node.commands && Array.isArray(node.commands)) {
                        for (const cmd of node.commands) {
                            visit(cmd, node);
                        }
                    }
                    break;

                case 'Redirect':
                    // 重定向操作
                    if (node.op && node.op.text) {
                        info.redirections.push(node.op.text);
                    }
                    break;
            }

            // 对命令名称进行安全分析
            if (type === 'Command' && node.name && node.name.text) {
                const cmdText = node.name.text;
                // 提取基础命令名（去除 - 前缀和 = 赋值）
                const baseCmd = cmdText.replace(/^-+/, '').split('=')[0];

                // 检查权限提升命令
                if (SYSTEM_MODIFIERS.has(cmdText)) {
                    security.push({
                        level: 'warning',
                        message: `Command uses '${cmdText}' - elevated privileges`,
                    });
                }

                // 检查危险命令
                if (DANGEROUS_COMMANDS.has(baseCmd)) {
                    security.push({
                        level: 'danger',
                        message: `Dangerous command detected: ${baseCmd}`,
                    });
                }

                // 特殊检查：rm 命令的危险标志
                if (baseCmd === 'rm' && node.suffix && Array.isArray(node.suffix)) {
                    for (const suffix of node.suffix) {
                        if (suffix.type === 'Word' && suffix.text && suffix.text.startsWith('-')) {
                            const flags = suffix.text.slice(1);
                            if ([...DANGEROUS_FLAGS].some((df) => flags.includes(df))) {
                                security.push({
                                    level: 'critical',
                                    message: `Command uses rm with dangerous flag: ${suffix.text}`,
                                });
                            }
                        }
                    }
                }
            }
        };

        // 从根节点开始遍历
        if (root.commands && Array.isArray(root.commands)) {
            for (const cmd of root.commands) {
                visit(cmd, null);
            }
        }

        return { info, security, segments };
    }

}

// =============================================================================
// 单例实例
// =============================================================================

/**
 * 单例解析器实例
 * 避免重复初始化 tree-sitter（开销较大）
 */
let instance: BashParser | null = null;

/**
 * 获取 BashParser 单例实例
 *
 * @returns 初始化后的解析器实例
 */
export async function getBashParser(): Promise<BashParser> {
    if (!instance) {
        instance = new BashParser();
        await instance.init();
    }
    return instance;
}
