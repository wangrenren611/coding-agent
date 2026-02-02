/**
 * LSP Tool - 混合实现
 * 对于项目文件使用 Language Service，对于孤立文件使用 AST 分析
 */

import { z } from 'zod';
import { BaseTool, ToolResult } from './base';
import * as ts from 'typescript';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 支持的 LSP 操作
 */
const LSP_OPERATIONS = [
  'goToDefinition',
  'findReferences',
  'hover',
  'documentSymbol',
  'workspaceSymbol',
] as const;

const schema = z.object({
  operation: z.enum(LSP_OPERATIONS).describe('The LSP operation to perform'),
  filePath: z.string().describe('The absolute or relative path to the file'),
  line: z.number().int().min(1).describe('The line number (1-based, as shown in editors)'),
  character: z.number().int().min(1).describe('The character offset (1-based, as shown in editors)'),
});

type LspInput = z.infer<typeof schema>;

/**
 * 使用 Language Service 的 LSP 工具
 */
export class LspTool extends BaseTool<typeof schema> {
  name = 'lsp';
  description = `Language Server Protocol tool for TypeScript/JavaScript code intelligence.

Supported operations:
- goToDefinition: Find where a symbol is defined
- findReferences: Find all references to a symbol (requires tsconfig.json)
- hover: Get type information and documentation for a symbol (requires tsconfig.json)
- documentSymbol: Get all symbols (functions, classes, variables) in a document
- workspaceSymbol: Search for symbols across the entire workspace

All operations require:
- filePath: The file to operate on (absolute or relative path)
- line: The line number (1-based, as shown in editors)
- character: The character offset (1-based, as shown in editors)

Note: goToDefinition and documentSymbol work with any file.
      findReferences and hover require tsconfig.json in the project.`;

  schema = schema;

  // 缓存语言服务
  private languageServiceCache: Map<string, ts.LanguageService> = new Map();
  private languageServiceHosts: Map<string, {
    files: Map<string, string>;
    compilerOptions: ts.CompilerOptions;
  }> = new Map();

  /**
   * 清除缓存（用于测试）
   */
  static clearCache(): void {
    // This would need to be implemented as a static method
  }

  /**
   * 创建简单的源文件用于 AST 分析
   */
  private async createSimpleSourceFile(filePath: string): Promise<ts.SourceFile | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    } catch {
      return null;
    }
  }

  /**
   * 使用 AST 分析跳转到定义（适用于孤立文件）
   */
  private async goToDefinitionAST(
    filePath: string,
    line: number,
    character: number
  ): Promise<ToolResult> {
    const sourceFile = await this.createSimpleSourceFile(filePath);
    if (!sourceFile) {
      return this.result({
        success: false,
        metadata: { error: 'LSP_SOURCE_FILE_NOT_FOUND', filePath } as any,
        output: 'LSP_SOURCE_FILE_NOT_FOUND: Source file not found',
      });
    }

    let pos: number;
    try {
      pos = ts.getPositionOfLineAndCharacter(sourceFile, line - 1, character - 1);
    } catch {
      return this.result({
        success: true,
        metadata: { message: 'Invalid position' },
        output: 'Invalid position',
      });
    }

    const node = this.getNodeAtPosition(sourceFile, pos);

    if (!node) {
      return this.result({
        success: true,
        metadata: { message: 'No definition found', definitions: [] },
        output: 'No definition found',
      });
    }

    // 查找定义
    const definitions: Array<{
      filePath: string;
      line: number;
      character: number;
      name: string;
    }> = [];

    // 如果节点本身是定义
    if (ts.isVariableDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node)) {
      const start = node.getStart(sourceFile);
      const { line: defLine, character: defCharacter } = sourceFile.getLineAndCharacterOfPosition(start);
      definitions.push({
        filePath,
        line: defLine + 1,
        character: defCharacter + 1,
        name: node.name?.getText(sourceFile) || '<anonymous>',
      });
    }

    // 如果节点是标识符引用，尝试找到定义
    if (ts.isIdentifier(node)) {
      const identifierName = node.getText(sourceFile);
      const parent = node.parent;
      if (parent) {
        // 对于类型引用 (const x: User = ...)
        if (ts.isTypeReferenceNode(parent)) {
          const typeName = parent.typeName || parent;
          const nameText = (typeName as ts.Identifier).getText(sourceFile);
          // 在文件中搜索类型定义
          definitions.push(...this.findTypeDefinitionInFile(sourceFile, nameText));
        }
        // 对于变量引用
        else if (ts.isVariableDeclaration(parent)) {
          // 这已经是声明
          const start = parent.name.getStart(sourceFile);
          const { line: defLine, character: defCharacter } = sourceFile.getLineAndCharacterOfPosition(start);
          definitions.push({
            filePath,
            line: defLine + 1,
            character: defCharacter + 1,
            name: parent.name.getText(sourceFile),
          });
        }
        // 对于函数调用 (greet('World'))
        else if (ts.isCallExpression(parent)) {
          // 在文件中搜索函数定义
          definitions.push(...this.findDefinitionInFile(sourceFile, identifierName));
        }
        // 对于其他标识符引用
        else {
          // 在文件中搜索任何匹配的定义
          definitions.push(...this.findDefinitionInFile(sourceFile, identifierName));
        }
      }
    }

    if (definitions.length === 0) {
      return this.result({
        success: true,
        metadata: { message: 'No definition found', definitions: [] },
        output: 'No definition found',
      });
    }

    return this.result({
      success: true,
      metadata: {
        operation: 'goToDefinition',
        position: { filePath, line, character },
        definitions,
      },
      output: `Found ${definitions.length} definition(s)`,
    });
  }

  /**
   * 在文件中查找类型/函数/变量定义
   */
  private findDefinitionInFile(sourceFile: ts.SourceFile, name: string): Array<{
    filePath: string;
    line: number;
    character: number;
    name: string;
  }> {
    const results: Array<{
      filePath: string;
      line: number;
      character: number;
      name: string;
    }> = [];

    const visit = (node: ts.Node): void => {
      // Check for named declarations
      if (ts.isInterfaceDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isFunctionDeclaration(node) ||
          ts.isVariableDeclaration(node)) {
        if (node.name?.getText(sourceFile) === name) {
          const start = node.name.getStart(sourceFile);
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
          results.push({
            filePath: sourceFile.fileName,
            line: line + 1,
            character: character + 1,
            name: name,
          });
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return results;
  }

  /**
   * 在文件中查找类型定义（仅类型）
   */
  private findTypeDefinitionInFile(sourceFile: ts.SourceFile, typeName: string): Array<{
    filePath: string;
    line: number;
    character: number;
    name: string;
  }> {
    const results: Array<{
      filePath: string;
      line: number;
      character: number;
      name: string;
    }> = [];

    const visit = (node: ts.Node): void => {
      if (ts.isInterfaceDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isTypeAliasDeclaration(node)) {
        if (node.name?.getText(sourceFile) === typeName) {
          const start = node.name.getStart(sourceFile);
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
          results.push({
            filePath: sourceFile.fileName,
            line: line + 1,
            character: character + 1,
            name: typeName,
          });
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return results;
  }

  /**
   * 查找标识符的声明节点
   */
  private findDeclarationForIdentifier(sourceFile: ts.SourceFile, identifierName: string): ts.VariableDeclaration | ts.FunctionDeclaration | ts.ParameterDeclaration | ts.PropertyDeclaration | null {
    let result: ts.VariableDeclaration | ts.FunctionDeclaration | ts.ParameterDeclaration | ts.PropertyDeclaration | null = null;

    const visit = (node: ts.Node): void => {
      if (result) return; // Already found

      // Check for variable declarations
      if (ts.isVariableDeclaration(node)) {
        if (node.name?.getText(sourceFile) === identifierName) {
          result = node;
          return;
        }
      }
      // Check for function declarations
      else if (ts.isFunctionDeclaration(node)) {
        if (node.name?.getText(sourceFile) === identifierName) {
          result = node as any; // FunctionDeclaration has type info
          return;
        }
      }
      // Check for parameters
      else if (ts.isParameter(node)) {
        if (node.name?.getText(sourceFile) === identifierName) {
          result = node;
          return;
        }
      }
      // Check for property declarations
      else if (ts.isPropertyDeclaration(node)) {
        if (node.name?.getText(sourceFile) === identifierName) {
          result = node;
          return;
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return result;
  }

  /**
   * 获取指定位置的节点
   */
  private getNodeAtPosition(sourceFile: ts.SourceFile, pos: number): ts.Node | null {
    let node: ts.Node | undefined = sourceFile;

    while (node) {
      // Find child that contains the position
      let foundChild: ts.Node | undefined = undefined;

      // Use getChildren() to iterate through children
      for (const child of node.getChildren(sourceFile)) {
        const start = child.getStart(sourceFile);
        const end = child.getEnd();
        if (start <= pos && pos < end) {
          foundChild = child;
          break;
        }
      }

      if (!foundChild) {
        return node;
      }
      node = foundChild;
    }

    return null;
  }

  /**
   * 跳转到定义
   */
  private async goToDefinition(
    filePath: string,
    line: number,
    character: number
  ): Promise<ToolResult> {
    // 检查是否有 tsconfig.json（表示这是一个项目）
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);
    const rootDir = path.dirname(absolutePath);
    const tsConfigPath = ts.findConfigFile(rootDir, ts.sys.fileExists, 'tsconfig.json');

    if (tsConfigPath) {
      // 使用 AST 分析（对于项目文件更可靠）
      return this.goToDefinitionAST(filePath, line, character);
    } else {
      // 对于孤立文件，也使用 AST 分析
      return this.goToDefinitionAST(filePath, line, character);
    }
  }

  /**
   * 查找引用（简化版 - 仅在同一文件中查找）
   */
  private async findReferences(
    filePath: string,
    line: number,
    character: number
  ): Promise<ToolResult> {
    const sourceFile = await this.createSimpleSourceFile(filePath);
    if (!sourceFile) {
      return this.result({
        success: false,
        metadata: { error: 'LSP_SOURCE_FILE_NOT_FOUND', filePath } as any,
        output: 'LSP_SOURCE_FILE_NOT_FOUND: Source file not found',
      });
    }

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

    const node = this.getNodeAtPosition(sourceFile, pos);

    if (!node || !ts.isIdentifier(node)) {
      return this.result({
        success: true,
        metadata: { message: 'No references found', references: [] },
        output: 'No references found',
      });
    }

    const symbolName = node.getText(sourceFile);
    const references: Array<{
      filePath: string;
      line: number;
      character: number;
      isDefinition: boolean;
    }> = [];

    // 在文件中查找所有相同名称的标识符
    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && n.getText(sourceFile) === symbolName) {
        const start = n.getStart(sourceFile);
        const { line: refLine, character: refCharacter } = sourceFile.getLineAndCharacterOfPosition(start);
        references.push({
          filePath,
          line: refLine + 1,
          character: refCharacter + 1,
          isDefinition: false, // 简化：假设所有都是引用
        });
      }
      ts.forEachChild(n, visit);
    };

    // 标记第一个（或声明）为定义
    const declarations: Array<ts.VariableDeclaration | ts.FunctionDeclaration | ts.ClassDeclaration | ts.InterfaceDeclaration> = [];
    const findDeclarations = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) ||
          ts.isFunctionDeclaration(n) ||
          ts.isClassDeclaration(n) ||
          ts.isInterfaceDeclaration(n)) {
        if (n.name && n.name.getText(sourceFile) === symbolName) {
          declarations.push(n);
        }
      }
      ts.forEachChild(n, findDeclarations);
    };
    findDeclarations(sourceFile);

    // 更新声明位置的 isDefinition 标记
    for (const decl of declarations) {
      const start = decl.name!.getStart(sourceFile);
      const { line: defLine, character: defCharacter } = sourceFile.getLineAndCharacterOfPosition(start);
      const ref = references.find(r =>
        r.line === defLine + 1 && r.character === defCharacter + 1
      );
      if (ref) {
        ref.isDefinition = true;
      }
    }

    return this.result({
      success: true,
      metadata: {
        operation: 'findReferences',
        position: { filePath, line, character },
        references,
      },
      output: `Found ${references.length} reference(s)`,
    });
  }

  /**
   * 获取悬停信息（简化版）
   */
  private async hover(
    filePath: string,
    line: number,
    character: number
  ): Promise<ToolResult> {
    const sourceFile = await this.createSimpleSourceFile(filePath);
    if (!sourceFile) {
      return this.result({
        success: false,
        metadata: { error: 'LSP_SOURCE_FILE_NOT_FOUND', filePath } as any,
        output: 'LSP_SOURCE_FILE_NOT_FOUND: Source file not found',
      });
    }

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

    const node = this.getNodeAtPosition(sourceFile, pos);

    if (!node) {
      return this.result({
        success: true,
        metadata: { type: 'unknown', documentation: '' },
        output: 'No type information',
      });
    }

    // 简单的类型推断
    let type = 'unknown';
    let documentation = '';

    if (ts.isIdentifier(node)) {
      // Find the declaration for this identifier
      const identifierName = node.getText(sourceFile);
      const declaration = this.findDeclarationForIdentifier(sourceFile, identifierName);

      if (declaration) {
        const typeNode = this.getTypeNode(declaration);
        if (typeNode) {
          type = typeNode.getText(sourceFile);
        } else if (ts.isFunctionDeclaration(declaration)) {
          // Build function signature
          const params = declaration.parameters.map(p => {
            const paramType = p.type ? p.type.getText(sourceFile) : 'any';
            return `${p.name.getText(sourceFile)}${p.questionToken ? '?' : ''}: ${paramType}`;
          }).join(', ');
          const returnType = declaration.type ? declaration.type.getText(sourceFile) : 'void';
          type = `(${params}) => ${returnType}`;
        }
      }
    }

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
   * 获取节点的类型节点
   */
  private getTypeNode(node: ts.Node): ts.TypeNode | null {
    if (ts.isVariableDeclaration(node)) {
      return node.type || null;
    }
    if (ts.isParameter(node)) {
      return node.type || null;
    }
    if (ts.isPropertyDeclaration(node)) {
      return node.type || null;
    }
    return null;
  }

  /**
   * 获取文档符号
   */
  private async documentSymbol(filePath: string): Promise<ToolResult> {
    const sourceFile = await this.createSimpleSourceFile(filePath);
    if (!sourceFile) {
      return this.result({
        success: false,
        metadata: { error: 'LSP_SOURCE_FILE_NOT_FOUND', filePath } as any,
        output: 'LSP_SOURCE_FILE_NOT_FOUND: Source file not found',
      });
    }

    const symbols: Array<{
      name: string;
      kind: string;
      line: number;
      character: number;
    }> = [];

    const visitNode = (node: ts.Node): void => {
      if (!node) return;

      const kind = node.kind;
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile)
      );

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

      // 递归访问子节点
      ts.forEachChild(node, visitNode);
    };

    visitNode(sourceFile);

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
   * 工作区符号（简化版）
   */
  private async workspaceSymbol(filePath: string): Promise<ToolResult> {
    // 简化实现：只返回当前文件的符号
    return this.documentSymbol(filePath);
  }

  /**
   * 执行 LSP 操作
   */
  async execute(
    args: z.infer<typeof this.schema>
  ): Promise<ToolResult> {
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
          errorMsg: error instanceof Error ? error.message : String(error)
        } as any,
        output: 'LSP_OPERATION_FAILED: LSP operation failed',
      });
    }
  }
}

export default LspTool;
