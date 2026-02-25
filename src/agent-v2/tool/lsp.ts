/**
 * LSP Tool - TypeScript Language Service 实现
 * 使用 TypeScript Compiler API 提供完整的代码智能功能
 */

import { z } from 'zod';
import { BaseTool, ToolContext, ToolResult } from './base';
import * as ts from 'typescript';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 支持的 LSP 操作
 */
const LSP_OPERATIONS = ['goToDefinition', 'findReferences', 'hover', 'documentSymbol', 'workspaceSymbol'] as const;

const schema = z.object({
    operation: z.enum(LSP_OPERATIONS).describe('The LSP operation to perform'),
    filePath: z.string().describe('The absolute or relative path to the file'),
    line: z.number().int().min(1).describe('The line number (1-based, as shown in editors)'),
    character: z.number().int().min(1).describe('The character offset (1-based, as shown in editors)'),
});

type LspInput = z.infer<typeof schema>;

/**
 * 语言服务缓存管理器
 */
class LanguageServiceManager {
    private static instance: LanguageServiceManager;
    private languageServices: Map<string, ts.LanguageService> = new Map();
    private serviceHosts: Map<string, ts.LanguageServiceHost> = new Map();
    private fileContents: Map<string, string> = new Map();
    private projectRoots: Map<string, string> = new Map();

    private constructor() {}

    static getInstance(): LanguageServiceManager {
        if (!LanguageServiceManager.instance) {
            LanguageServiceManager.instance = new LanguageServiceManager();
        }
        return LanguageServiceManager.instance;
    }

    /**
     * 清除所有缓存
     */
    clearAll(): void {
        this.languageServices.clear();
        this.serviceHosts.clear();
        this.fileContents.clear();
        this.projectRoots.clear();
    }

    /**
     * 获取或创建语言服务
     */
    async getLanguageService(filePath: string): Promise<ts.LanguageService | null> {
        const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

        // 查找项目根目录和 tsconfig.json
        const projectRoot = this.findProjectRoot(absolutePath);
        if (!projectRoot) {
            return null;
        }

        // 检查缓存
        const cached = this.languageServices.get(projectRoot);
        if (cached) {
            return cached;
        }

        // 创建新的语言服务
        const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, 'tsconfig.json');
        if (!configPath) {
            return null;
        }

        const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
        const parsedConfig = ts.parseJsonConfigFileContent(config, ts.sys, projectRoot);

        // 创建内存中的文件系统
        const fileVersions = new Map<string, { version: number }>();

        const host: ts.LanguageServiceHost = {
            getCompilationSettings: () => parsedConfig.options,
            getScriptFileNames: () => {
                return parsedConfig.fileNames;
            },
            getScriptVersion: (fileName) => {
                const version = fileVersions.get(fileName);
                return version ? String(version.version) : '0';
            },
            getScriptSnapshot: (fileName) => {
                // 先检查内存缓存
                if (this.fileContents.has(fileName)) {
                    return ts.ScriptSnapshot.fromString(this.fileContents.get(fileName)!);
                }
                // 然后尝试从文件系统读取
                if (!ts.sys.fileExists(fileName)) {
                    return undefined;
                }
                return ts.ScriptSnapshot.fromString(ts.sys.readFile(fileName) || '');
            },
            getCurrentDirectory: () => projectRoot,
            getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
            readFile: (fileName) => {
                if (this.fileContents.has(fileName)) {
                    return this.fileContents.get(fileName)!;
                }
                return ts.sys.readFile(fileName);
            },
            fileExists: (fileName) => {
                return this.fileContents.has(fileName) || ts.sys.fileExists(fileName);
            },
        };

        const languageService = ts.createLanguageService(host, ts.createDocumentRegistry());

        this.languageServices.set(projectRoot, languageService);
        this.serviceHosts.set(projectRoot, host);
        this.projectRoots.set(absolutePath, projectRoot);

        return languageService;
    }

    /**
     * 为孤立文件创建临时语言服务
     */
    async createStandaloneLanguageService(filePath: string, content: string): Promise<ts.LanguageService> {
        const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
        const dir = path.dirname(absolutePath);

        // 缓存文件内容
        this.fileContents.set(absolutePath, content);

        const fileVersions = new Map<string, { version: number }>();
        fileVersions.set(absolutePath, { version: 1 });

        const host: ts.LanguageServiceHost = {
            getCompilationSettings: () => ({
                target: ts.ScriptTarget.Latest,
                module: ts.ModuleKind.ESNext,
                moduleResolution: ts.ModuleResolutionKind.NodeNext,
                strict: false,
                esModuleInterop: true,
                skipLibCheck: true,
            }),
            getScriptFileNames: () => [absolutePath],
            getScriptVersion: (fileName) => {
                const version = fileVersions.get(fileName);
                return version ? String(version.version) : '0';
            },
            getScriptSnapshot: (fileName) => {
                if (fileName === absolutePath) {
                    return ts.ScriptSnapshot.fromString(content);
                }
                // 尝试读取其他文件（如 node_modules 中的类型定义）
                if (ts.sys.fileExists(fileName)) {
                    return ts.ScriptSnapshot.fromString(ts.sys.readFile(fileName) || '');
                }
                return undefined;
            },
            getCurrentDirectory: () => dir,
            getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
            readFile: (fileName) => {
                if (fileName === absolutePath) {
                    return content;
                }
                return ts.sys.readFile(fileName);
            },
            fileExists: (fileName) => {
                if (fileName === absolutePath) {
                    return true;
                }
                return ts.sys.fileExists(fileName);
            },
        };

        return ts.createLanguageService(host, ts.createDocumentRegistry());
    }

    /**
     * 更新文件内容缓存
     */
    updateFileContent(filePath: string, content: string): void {
        const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
        this.fileContents.set(absolutePath, content);
    }

    /**
     * 查找项目根目录
     */
    private findProjectRoot(filePath: string): string | null {
        let dir = path.dirname(filePath);

        while (dir !== path.dirname(dir)) {
            const tsconfigPath = path.join(dir, 'tsconfig.json');
            if (ts.sys.fileExists(tsconfigPath)) {
                return dir;
            }
            dir = path.dirname(dir);
        }

        // 检查根目录
        const rootTsconfig = path.join(dir, 'tsconfig.json');
        if (ts.sys.fileExists(rootTsconfig)) {
            return dir;
        }

        return null;
    }
}

/**
 * 使用 TypeScript Language Service 的 LSP 工具
 */
export class LspTool extends BaseTool<typeof schema> {
    name = 'lsp';
    description = `Language Server Protocol tool for TypeScript/JavaScript code intelligence.

Supported operations:
- goToDefinition: Find where a symbol is defined
- findReferences: Find all references to a symbol
- hover: Get type information and documentation for a symbol
- documentSymbol: Get all symbols (functions, classes, variables) in a document
- workspaceSymbol: Search for symbols across the entire workspace

All operations require:
- filePath: The file to operate on (absolute or relative path)
- line: The line number (1-based, as shown in editors)
- character: The character offset (1-based, as shown in editors)`;

    schema = schema;

    private manager: LanguageServiceManager;

    constructor() {
        super();
        this.manager = LanguageServiceManager.getInstance();
    }

    /**
     * 清除缓存（用于测试）
     */
    static clearCache(): void {
        LanguageServiceManager.getInstance().clearAll();
    }

    /**
     * 读取文件内容
     */
    private async readFileContent(filePath: string): Promise<string | null> {
        try {
            return await fs.readFile(filePath, 'utf-8');
        } catch {
            return null;
        }
    }

    /**
     * 获取语言服务
     */
    private async getLanguageService(filePath: string): Promise<{
        service: ts.LanguageService;
        isStandalone: boolean;
    } | null> {
        const content = await this.readFileContent(filePath);
        if (content === null) {
            return null;
        }

        // 尝试使用项目语言服务
        const projectService = await this.manager.getLanguageService(filePath);
        if (projectService) {
            return { service: projectService, isStandalone: false };
        }

        // 创建孤立文件的语言服务
        const standaloneService = await this.manager.createStandaloneLanguageService(filePath, content);
        return { service: standaloneService, isStandalone: true };
    }

    /**
     * 跳转到定义
     */
    private async goToDefinition(filePath: string, line: number, character: number): Promise<ToolResult> {
        const result = await this.getLanguageService(filePath);
        if (!result) {
            return this.result({
                success: false,
                metadata: { error: 'LSP_SOURCE_FILE_NOT_FOUND', filePath } as any,
                output: 'LSP_SOURCE_FILE_NOT_FOUND: Source file not found',
            });
        }

        const { service } = result;
        const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

        // 读取文件以获取正确的位置
        const content = await this.readFileContent(absolutePath);
        if (!content) {
            return this.result({
                success: false,
                metadata: { error: 'LSP_SOURCE_FILE_NOT_FOUND', filePath } as any,
                output: 'LSP_SOURCE_FILE_NOT_FOUND: Source file not found',
            });
        }

        const sourceFile = ts.createSourceFile(absolutePath, content, ts.ScriptTarget.Latest, true);
        let pos: number;
        try {
            pos = ts.getPositionOfLineAndCharacter(sourceFile, line - 1, character - 1);
        } catch {
            return this.result({
                success: true,
                metadata: { message: 'Invalid position', definitions: [] },
                output: 'Invalid position',
            });
        }

        const definitions = service.getDefinitionAtPosition(absolutePath, pos);

        if (!definitions || definitions.length === 0) {
            return this.result({
                success: true,
                metadata: { message: 'No definition found', definitions: [] },
                output: 'No definition found',
            });
        }

        const formattedDefinitions = definitions.map((def) => ({
            filePath: def.fileName,
            line: def.textSpan.start + 1, // 将使用下面的计算
            character: 1,
            name: def.name || 'unknown',
        }));

        // 获取正确的行号和列号
        for (let i = 0; i < definitions.length; i++) {
            const def = definitions[i];
            try {
                const defContent = await this.readFileContent(def.fileName);
                if (defContent) {
                    const defSourceFile = ts.createSourceFile(def.fileName, defContent, ts.ScriptTarget.Latest, true);
                    const { line: defLine, character: defChar } = defSourceFile.getLineAndCharacterOfPosition(
                        def.textSpan.start
                    );
                    formattedDefinitions[i].line = defLine + 1;
                    formattedDefinitions[i].character = defChar + 1;
                }
            } catch {
                // 保持默认值
            }
        }

        return this.result({
            success: true,
            metadata: {
                operation: 'goToDefinition',
                position: { filePath, line, character },
                definitions: formattedDefinitions,
            },
            output: `Found ${formattedDefinitions.length} definition(s)`,
        });
    }

    /**
     * 查找引用
     */
    private async findReferences(filePath: string, line: number, character: number): Promise<ToolResult> {
        const result = await this.getLanguageService(filePath);
        if (!result) {
            return this.result({
                success: false,
                metadata: { error: 'LSP_SOURCE_FILE_NOT_FOUND', filePath } as any,
                output: 'LSP_SOURCE_FILE_NOT_FOUND: Source file not found',
            });
        }

        const { service } = result;
        const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

        const content = await this.readFileContent(absolutePath);
        if (!content) {
            return this.result({
                success: false,
                metadata: { error: 'LSP_SOURCE_FILE_NOT_FOUND', filePath } as any,
                output: 'LSP_SOURCE_FILE_NOT_FOUND: Source file not found',
            });
        }

        const sourceFile = ts.createSourceFile(absolutePath, content, ts.ScriptTarget.Latest, true);
        let pos: number;
        try {
            pos = ts.getPositionOfLineAndCharacter(sourceFile, line - 1, character - 1);
        } catch {
            return this.result({
                success: true,
                metadata: { references: [] },
                output: 'No references found',
            });
        }

        const references = service.findReferences(absolutePath, pos);

        if (!references || references.length === 0) {
            return this.result({
                success: true,
                metadata: { message: 'No references found', references: [] },
                output: 'No references found',
            });
        }

        const formattedReferences: Array<{
            filePath: string;
            line: number;
            character: number;
            isDefinition: boolean;
        }> = [];

        // 收集所有引用并限制数量
        const maxReferences = 50;
        let totalRefs = 0;

        for (const refSymbol of references) {
            if (totalRefs >= maxReferences) break;

            for (const ref of refSymbol.references) {
                if (totalRefs >= maxReferences) break;

                try {
                    const refContent = await this.readFileContent(ref.fileName);
                    if (refContent) {
                        const refSourceFile = ts.createSourceFile(
                            ref.fileName,
                            refContent,
                            ts.ScriptTarget.Latest,
                            true
                        );
                        const { line: refLine, character: refChar } = refSourceFile.getLineAndCharacterOfPosition(
                            ref.textSpan.start
                        );

                        formattedReferences.push({
                            filePath: ref.fileName,
                            line: refLine + 1,
                            character: refChar + 1,
                            isDefinition: ref.isDefinition || false,
                        });
                        totalRefs++;
                    }
                } catch {
                    // 跳过无法处理的引用
                }
            }
        }

        return this.result({
            success: true,
            metadata: {
                operation: 'findReferences',
                position: { filePath, line, character },
                references: formattedReferences,
            },
            output: `Found ${formattedReferences.length} reference(s)`,
        });
    }

    /**
     * 获取悬停信息
     */
    private async hover(filePath: string, line: number, character: number): Promise<ToolResult> {
        const result = await this.getLanguageService(filePath);
        if (!result) {
            return this.result({
                success: false,
                metadata: { error: 'LSP_SOURCE_FILE_NOT_FOUND', filePath } as any,
                output: 'LSP_SOURCE_FILE_NOT_FOUND: Source file not found',
            });
        }

        const { service } = result;
        const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

        const content = await this.readFileContent(absolutePath);
        if (!content) {
            return this.result({
                success: false,
                metadata: { error: 'LSP_SOURCE_FILE_NOT_FOUND', filePath } as any,
                output: 'LSP_SOURCE_FILE_NOT_FOUND: Source file not found',
            });
        }

        const sourceFile = ts.createSourceFile(absolutePath, content, ts.ScriptTarget.Latest, true);
        let pos: number;
        try {
            pos = ts.getPositionOfLineAndCharacter(sourceFile, line - 1, character - 1);
        } catch {
            return this.result({
                success: true,
                metadata: { type: 'unknown', documentation: '' },
                output: 'No type information',
            });
        }

        const quickInfo = service.getQuickInfoAtPosition(absolutePath, pos);

        if (!quickInfo) {
            return this.result({
                success: true,
                metadata: { type: 'unknown', documentation: '' },
                output: 'No type information',
            });
        }

        const type = ts.displayPartsToString(quickInfo.displayParts || []);
        const documentation = ts.displayPartsToString(quickInfo.documentation || []);

        return this.result({
            success: true,
            metadata: {
                operation: 'hover',
                position: { filePath, line, character },
                type,
                documentation,
            },
            output: type || 'No type information',
        });
    }

    /**
     * 获取文档符号
     */
    private async documentSymbol(filePath: string): Promise<ToolResult> {
        const result = await this.getLanguageService(filePath);
        if (!result) {
            return this.result({
                success: false,
                metadata: { error: 'LSP_SOURCE_FILE_NOT_FOUND', filePath } as any,
                output: 'LSP_SOURCE_FILE_NOT_FOUND: Source file not found',
            });
        }

        const { service } = result;
        const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

        const content = await this.readFileContent(absolutePath);
        if (!content) {
            return this.result({
                success: false,
                metadata: { error: 'LSP_SOURCE_FILE_NOT_FOUND', filePath } as any,
                output: 'LSP_SOURCE_FILE_NOT_FOUND: Source file not found',
            });
        }

        const sourceFile = ts.createSourceFile(absolutePath, content, ts.ScriptTarget.Latest, true);
        const items = service.getNavigateToItems('', 100, undefined, false);

        // 过滤当前文件的符号
        const symbols = items
            .filter((item) => item.fileName === absolutePath)
            .map((item) => {
                const { line, character } = sourceFile.getLineAndCharacterOfPosition(item.textSpan.start);
                return {
                    name: item.name,
                    kind: item.kind as string,
                    line: line + 1,
                    character: character + 1,
                };
            });

        // 如果 navigateTo 没有返回结果，使用 AST 分析作为备选
        if (symbols.length === 0) {
            const astSymbols = this.extractSymbolsFromAST(sourceFile);
            symbols.push(...astSymbols);
        }

        return this.result({
            success: true,
            metadata: {
                operation: 'documentSymbol',
                filePath,
                symbols,
            },
            output: `Found ${symbols.length} symbol(s) in ${filePath}`,
        });
    }

    /**
     * 从 AST 提取符号（备选方案）
     */
    private extractSymbolsFromAST(sourceFile: ts.SourceFile): Array<{
        name: string;
        kind: string;
        line: number;
        character: number;
    }> {
        const symbols: Array<{
            name: string;
            kind: string;
            line: number;
            character: number;
        }> = [];

        const visitNode = (node: ts.Node): void => {
            if (!node) return;

            const kind = node.kind;
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));

            if (
                kind === ts.SyntaxKind.FunctionDeclaration ||
                kind === ts.SyntaxKind.ClassDeclaration ||
                kind === ts.SyntaxKind.InterfaceDeclaration ||
                kind === ts.SyntaxKind.TypeAliasDeclaration ||
                kind === ts.SyntaxKind.VariableStatement ||
                kind === ts.SyntaxKind.ArrowFunction ||
                kind === ts.SyntaxKind.MethodDeclaration
            ) {
                let name = 'anonymous';

                try {
                    if (ts.isFunctionDeclaration(node) && node.name) {
                        name = node.name.getText(sourceFile);
                    } else if (ts.isClassDeclaration(node) && node.name) {
                        name = node.name.getText(sourceFile);
                    } else if (ts.isInterfaceDeclaration(node) && node.name) {
                        name = node.name.getText(sourceFile);
                    } else if (ts.isTypeAliasDeclaration(node) && node.name) {
                        name = node.name.getText(sourceFile);
                    } else if (ts.isVariableStatement(node)) {
                        name = node.declarationList?.declarations?.[0]?.name?.getText(sourceFile) || 'anonymous';
                    } else if (ts.isMethodDeclaration(node) && node.name) {
                        name = node.name.getText(sourceFile);
                    }
                } catch {
                    // 忽略无法提取名称的节点
                }

                symbols.push({
                    name,
                    kind: ts.SyntaxKind[kind],
                    line: line + 1,
                    character: character + 1,
                });
            }

            ts.forEachChild(node, visitNode);
        };

        visitNode(sourceFile);
        return symbols;
    }

    /**
     * 工作区符号
     */
    private async workspaceSymbol(filePath: string): Promise<ToolResult> {
        const result = await this.getLanguageService(filePath);
        if (!result) {
            return this.result({
                success: false,
                metadata: { error: 'LSP_SOURCE_FILE_NOT_FOUND', filePath } as any,
                output: 'LSP_SOURCE_FILE_NOT_FOUND: Source file not found',
            });
        }

        const { service } = result;

        // 获取所有导航项
        const items = service.getNavigateToItems('', 50, undefined, false);

        const symbols = items.map((item) => ({
            name: item.name,
            kind: item.kind,
            filePath: item.fileName,
            containerName: item.containerName || '',
        }));

        return this.result({
            success: true,
            metadata: {
                operation: 'workspaceSymbol',
                symbols,
            },
            output: `Found ${symbols.length} symbol(s) in workspace`,
        });
    }

    /**
     * 执行 LSP 操作
     */
    async execute(args: z.infer<typeof this.schema>, _context?: ToolContext): Promise<ToolResult> {
        try {
            // 解析文件路径
            const absolutePath = path.isAbsolute(args.filePath)
                ? args.filePath
                : path.resolve(process.cwd(), args.filePath);

            // 检查文件是否存在
            try {
                await fs.access(absolutePath);
            } catch {
                return this.result({
                    success: false,
                    metadata: { error: 'LSP_FILE_NOT_FOUND', filePath: absolutePath } as any,
                    output: 'LSP_FILE_NOT_FOUND: File not found',
                });
            }

            // 检查文件类型
            const ext = path.extname(absolutePath);
            const supportedExtensions = ['.ts', '.tsx', '.js', '.jsx'];
            if (!supportedExtensions.includes(ext)) {
                return this.result({
                    success: false,
                    metadata: { error: 'LSP_UNSUPPORTED_FILE_TYPE', ext } as any,
                    output: 'LSP_UNSUPPORTED_FILE_TYPE: Unsupported file type',
                });
            }

            // 根据操作类型执行相应功能
            switch (args.operation) {
                case 'goToDefinition':
                    return this.goToDefinition(absolutePath, args.line, args.character);

                case 'findReferences':
                    return this.findReferences(absolutePath, args.line, args.character);

                case 'hover':
                    return this.hover(absolutePath, args.line, args.character);

                case 'documentSymbol':
                    return this.documentSymbol(absolutePath);

                case 'workspaceSymbol':
                    return this.workspaceSymbol(absolutePath);

                default:
                    return this.result({
                        success: false,
                        metadata: { error: 'LSP_UNKNOWN_OPERATION', operation: args.operation } as any,
                        output: 'LSP_UNKNOWN_OPERATION: Unknown operation',
                    });
            }
        } catch (error) {
            return this.result({
                success: false,
                metadata: {
                    error: 'LSP_OPERATION_FAILED',
                    errorMsg: error instanceof Error ? error.message : String(error),
                } as any,
                output: 'LSP_OPERATION_FAILED: LSP operation failed',
            });
        }
    }
}

export default LspTool;
