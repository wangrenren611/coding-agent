/**
 * 文件处理工具
 * 用于解析用户输入中的文件路径，读取文件并转换为多模态内容
 */
import * as fs from 'fs';
import * as path from 'path';
import type { InputContentPart } from '../../providers/types/api';

/**
 * 支持的图片扩展名
 */
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];

/**
 * 支持的视频扩展名
 */
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.avi', '.mkv'];

/**
 * 文件类型分类
 */
export type FileCategory = 'image' | 'video' | 'file';

/**
 * 解析结果
 */
export interface ParsedFileInput {
    /** 原始文本（去除文件路径后的内容） */
    text: string;
    /** 解析出的文件内容部分 */
    contentParts: InputContentPart[];
    /** 解析错误 */
    errors: string[];
}

/**
 * 文件信息
 */
interface FileInfo {
    path: string;
    absolutePath: string;
    category: FileCategory;
    exists: boolean;
    size?: number;
    mimeType?: string;
}

/**
 * 检测文件类型
 */
function detectFileCategory(filePath: string): FileCategory {
    const ext = path.extname(filePath).toLowerCase();

    if (IMAGE_EXTENSIONS.includes(ext)) {
        return 'image';
    }

    if (VIDEO_EXTENSIONS.includes(ext)) {
        return 'video';
    }

    return 'file';
}

/**
 * 获取文件的 MIME 类型
 */
function getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
        // 图片
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.svg': 'image/svg+xml',
        // 视频
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
        '.webm': 'video/webm',
        '.avi': 'video/x-msvideo',
        '.mkv': 'video/x-matroska',
        // 文档
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.json': 'application/json',
        '.md': 'text/markdown',
        '.csv': 'text/csv',
    };

    return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * 解析用户输入中的文件路径
 * 支持格式: @/path/to/file 或 @./relative/path 或 @filename
 */
export function parseFilePaths(input: string, workingDir: string = process.cwd()): ParsedFileInput {
    const errors: string[] = [];
    const contentParts: InputContentPart[] = [];

    // 匹配 @路径 模式（支持空格分隔）
    // 匹配：@./file.png @/abs/path.jpg @file.pdf
    const filePathRegex = /@([^\s]+)/g;
    const filePaths: { original: string; path: string }[] = [];

    let match;
    while ((match = filePathRegex.exec(input)) !== null) {
        const rawPath = match[1];
        // 处理路径
        let resolvedPath: string;

        // 检查是否是绝对路径
        if (rawPath.startsWith('/') || rawPath.match(/^[A-Za-z]:\\/)) {
            resolvedPath = rawPath;
        } else if (rawPath.startsWith('./') || rawPath.startsWith('../')) {
            // 相对路径，基于工作目录
            resolvedPath = path.resolve(workingDir, rawPath);
        } else if (rawPath.startsWith('~')) {
            // 家目录
            resolvedPath = path.resolve(rawPath.replace('~', process.env.HOME || ''));
        } else {
            // 假设是相对于当前工作目录
            resolvedPath = path.resolve(workingDir, rawPath);
        }

        filePaths.push({
            original: match[0],
            path: resolvedPath,
        });
    }

    // 移除文件路径后的文本
    let text = input;
    for (const { original } of filePaths) {
        text = text.replace(original, '');
    }
    text = text.replace(/\s+/g, ' ').trim();

    // 处理每个文件
    for (const { path: filePath } of filePaths) {
        const fileInfo = analyzeFile(filePath);

        if (!fileInfo.exists) {
            errors.push(`文件不存在: ${filePath}`);
            continue;
        }

        try {
            const part = fileToContentPart(fileInfo);
            if (part) {
                contentParts.push(part);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            errors.push(`读取文件失败 ${filePath}: ${errorMessage}`);
        }
    }

    // 如果有文本内容，添加到开头
    if (text) {
        contentParts.unshift({
            type: 'text',
            text,
        });
    }

    return { text, contentParts, errors };
}

/**
 * 分析文件信息
 */
function analyzeFile(filePath: string): FileInfo {
    const absolutePath = path.resolve(filePath);
    const category = detectFileCategory(filePath);
    const mimeType = getMimeType(filePath);

    let exists = false;
    let size: number | undefined;

    try {
        const stats = fs.statSync(absolutePath);
        exists = true;
        size = stats.size;
    } catch {
        exists = false;
    }

    return {
        path: filePath,
        absolutePath,
        category,
        exists,
        size,
        mimeType,
    };
}

/**
 * 将文件转换为多模态内容部分
 */
function fileToContentPart(fileInfo: FileInfo): InputContentPart | null {
    const { absolutePath, category, mimeType } = fileInfo;

    // 读取文件内容为 base64
    const buffer = fs.readFileSync(absolutePath);
    const base64Data = buffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64Data}`;

    switch (category) {
        case 'image':
            return {
                type: 'image_url',
                image_url: {
                    url: dataUrl,
                    detail: 'auto',
                },
            };

        case 'video':
            return {
                type: 'input_video',
                input_video: {
                    data: base64Data,
                    format: (mimeType?.includes('mp4') ? 'mp4' : mimeType?.includes('webm') ? 'webm' : 'mp4') as
                        | 'mp4'
                        | 'webm'
                        | 'mov',
                },
            };

        case 'file':
        default:
            return {
                type: 'file',
                file: {
                    file_data: base64Data,
                    filename: path.basename(absolutePath),
                },
            };
    }
}

/**
 * 格式化文件大小显示
 */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    } else if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    } else if (bytes < 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    } else {
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
}

/**
 * 创建文件摘要信息（用于显示）
 */
export function createFileSummary(contentParts: InputContentPart[]): string {
    const summaries: string[] = [];

    for (const part of contentParts) {
        switch (part.type) {
            case 'image_url':
                summaries.push('[图片]');
                break;
            case 'input_video':
                summaries.push('[视频]');
                break;
            case 'file':
                summaries.push(`[文件: ${part.file.filename}]`);
                break;
            case 'text':
                // 文本部分不需要单独显示
                break;
        }
    }

    return summaries.join(' ');
}
