/**
 * 文件 Transport
 */

import * as fs from 'fs';
import * as path from 'path';
import { BaseTransport } from './base';
import type { FileTransportConfig, LogRecord, IFormatter } from '../types';

/**
 * 文件 Transport
 * 将日志输出到文件，支持日志轮转
 */
export class FileTransport extends BaseTransport {
    readonly name = 'file';
    readonly config: FileTransportConfig;

    private currentStream: fs.WriteStream | null = null;
    private currentFilepath: string = '';
    private currentSize: number = 0;
    private buffer: string[] = [];
    private flushTimer: ReturnType<typeof setInterval> | null = null;
    private writeLock: boolean = false;

    constructor(config: FileTransportConfig, formatter: IFormatter) {
        super(formatter);
        this.config = {
            enabled: true,
            level: 0,
            format: 'json',
            timestamp: true,
            sync: false,
            bufferSize: 1000,
            flushInterval: 1000,
            rotation: {
                enabled: true,
                maxSize: 10 * 1024 * 1024,
                maxFiles: 5,
                strategy: 'size',
            },
            ...config,
        };

        this.initStream();
        this.startFlushTimer();
    }

    /**
     * 初始化文件流
     */
    private initStream(): void {
        const dir = path.dirname(this.config.filepath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.currentFilepath = this.config.filepath;
        this.currentStream = fs.createWriteStream(this.currentFilepath, {
            flags: 'a',
            encoding: 'utf8',
        });

        // 获取当前文件大小
        try {
            const stats = fs.statSync(this.currentFilepath);
            this.currentSize = stats.size;
        } catch {
            this.currentSize = 0;
        }

        // 处理流错误
        this.currentStream.on('error', (err) => {
            console.error(`[FileTransport] Stream error: ${err.message}`);
        });
    }

    /**
     * 写入日志记录
     */
    write(record: LogRecord): void {
        if (!this.shouldLog(record)) return;

        const formatted = this.format(record) + '\n';

        if (this.config.sync) {
            this.writeSync(formatted);
        } else {
            this.buffer.push(formatted);
            if (this.buffer.length >= (this.config.bufferSize || 1000)) {
                this.flush();
            }
        }
    }

    /**
     * 同步写入
     */
    private writeSync(content: string): void {
        try {
            fs.appendFileSync(this.currentFilepath, content, 'utf8');
            this.currentSize += Buffer.byteLength(content, 'utf8');
            this.checkRotation();
        } catch (err) {
            console.error(`[FileTransport] Write error: ${(err as Error).message}`);
        }
    }

    /**
     * 刷新缓冲区
     */
    flush(): void {
        if (this.writeLock || this.buffer.length === 0 || !this.currentStream) {
            return;
        }

        this.writeLock = true;
        const content = this.buffer.join('');
        this.buffer = [];

        this.currentStream.write(content, 'utf8', (err) => {
            if (err) {
                console.error(`[FileTransport] Write error: ${err.message}`);
                // 将内容放回缓冲区
                this.buffer.unshift(content);
            } else {
                this.currentSize += Buffer.byteLength(content, 'utf8');
                this.checkRotation();
            }
            this.writeLock = false;
        });
    }

    /**
     * 检查是否需要轮转
     */
    private checkRotation(): void {
        if (!this.config.rotation?.enabled) return;

        const { maxSize, strategy } = this.config.rotation;

        if (strategy === 'size' || strategy === 'both') {
            if (this.currentSize >= maxSize) {
                this.rotate();
            }
        }
    }

    /**
     * 执行日志轮转
     */
    private rotate(): void {
        if (!this.currentStream) return;

        // 关闭当前流
        this.currentStream.end();
        this.currentStream = null;

        const dir = path.dirname(this.config.filepath);
        const ext = path.extname(this.config.filepath);
        const base = path.basename(this.config.filepath, ext);

        // 轮转现有文件
        const maxFiles = this.config.rotation?.maxFiles ?? 5;
        for (let i = maxFiles - 1; i >= 1; i--) {
            const oldFile = path.join(dir, `${base}.${i}${ext}`);
            const newFile = path.join(dir, `${base}.${i + 1}${ext}`);
            try {
                if (fs.existsSync(oldFile)) {
                    if (i === maxFiles - 1) {
                        fs.unlinkSync(oldFile);
                    } else {
                        fs.renameSync(oldFile, newFile);
                    }
                }
            } catch (err) {
                console.error(`[FileTransport] Rotation error: ${(err as Error).message}`);
            }
        }

        // 重命名当前文件
        try {
            fs.renameSync(this.config.filepath, path.join(dir, `${base}.1${ext}`));
        } catch (err) {
            console.error(`[FileTransport] Rename error: ${(err as Error).message}`);
        }

        // 创建新文件流
        this.initStream();
    }

    /**
     * 启动定时刷新
     */
    private startFlushTimer(): void {
        if (this.config.sync) return;

        this.flushTimer = setInterval(() => {
            this.flush();
        }, this.config.flushInterval || 1000);

        // 使用 unref() 防止定时器阻止进程退出
        if (this.flushTimer) {
            this.flushTimer.unref();
        }
    }

    /**
     * 关闭 Transport
     */
    close(): void {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }

        this.flush();

        if (this.currentStream) {
            this.currentStream.end();
            this.currentStream = null;
        }
    }
}
