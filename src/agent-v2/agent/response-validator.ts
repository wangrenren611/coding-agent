/**
 * 响应验证器
 *
 * 检测 LLM 响应中的异常模式，防止模型幻觉（hallucination）问题：
 * 1. 重复词检测 - 检测连续重复的词汇模式
 * 2. 无意义模式检测 - 检测常见的幻觉输出模式
 * 3. 语义连贯性检查 - 检测内容是否合理
 */

/**
 * 验证器配置选项
 */
export interface ResponseValidatorOptions {
    /** 是否启用验证（默认 true） */
    enabled: boolean;
    /** 重复词阈值：连续出现多少次相同词汇视为异常（默认 5） */
    repetitionThreshold: number;
    /** 无意义模式阈值：检测到多少个无意义模式视为异常（默认 3） */
    nonsenseThreshold: number;
    /** 最大响应长度（字符数），超过则警告（默认 50000） */
    maxResponseLength: number;
    /** 是否在检测到异常时中断流式响应（默认 true） */
    abortOnViolation: boolean;
    /** 检查窗口大小：在多少字符内进行检查（默认 1000） */
    checkWindowSize: number;
    /** 检查频率：每 N 个字符检查一次（默认 100） */
    checkFrequency: number;
}

/**
 * 验证结果
 */
export interface ValidationResult {
    /** 是否通过验证 */
    valid: boolean;
    /** 违规类型 */
    violationType?: 'repetition' | 'nonsense' | 'length' | 'encoding';
    /** 违规详情 */
    details?: string;
    /** 建议的操作 */
    action?: 'abort' | 'warn' | 'truncate';
    /** 检测到的模式 */
    detectedPatterns?: string[];
}

/**
 * 已知的无意义模式
 * 这些模式通常出现在模型幻觉时
 */
const KNOWN_NONSENSE_PATTERNS = [
    // 重复单词模式
    /(\b\w+\b)(\s+\1){4,}/gi,
    // 重复短语模式
    /(.{5,50})\1{3,}/g,
    // 乱码模式
    /[\x00-\x08\x0B\x0C\x0E-\x1F]/,
    // 无意义重复字母
    /([a-zA-Z])\1{10,}/g,
    // 连续无意义标点
    /[\.\,\!\?\;\:]{20,}/g,
    // 重复的 "Alpha/Daemon/Gamma" 等幻觉常见词
    /\b(Alpha|Daemon|Gamma|Beta|Omega|Lambda)\b[\s\S]*?\b\1\b[\s\S]*?\b\1\b[\s\S]*?\b\1\b/gi,
    // 重复的中文无意义片段
    /([\u4e00-\u9fa5]{2,10})\1{3,}/g,
];

/**
 * 高频幻觉词汇（出现过多时触发警告）
 */
const HALLUCINATION_WORDS = [
    'alpha',
    'daemon',
    'gamma',
    'beta',
    'omega',
    'lambda',
    'shared',
    'team',
    'local',
    'global',
    'agent',
];

/**
 * 响应验证器类
 */
export class ResponseValidator {
    private readonly options: ResponseValidatorOptions;
    private processedChars = 0;
    private lastCheckPosition = 0;
    private detectedIssues: string[] = [];

    constructor(options?: Partial<ResponseValidatorOptions>) {
        this.options = {
            enabled: true,
            repetitionThreshold: 5,
            nonsenseThreshold: 3,
            maxResponseLength: 50000,
            abortOnViolation: true,
            checkWindowSize: 1000,
            checkFrequency: 100,
            ...options,
        };
    }

    /**
     * 重置验证器状态
     */
    reset(): void {
        this.processedChars = 0;
        this.lastCheckPosition = 0;
        this.detectedIssues = [];
    }

    /**
     * 增量验证 - 用于流式处理
     * 每次收到新内容时调用
     */
    validateIncremental(newContent: string): ValidationResult {
        if (!this.options.enabled) {
            return { valid: true };
        }

        this.processedChars += newContent.length;

        // 检查是否到达检查频率
        if (this.processedChars - this.lastCheckPosition < this.options.checkFrequency) {
            return { valid: true };
        }

        this.lastCheckPosition = this.processedChars;
        return this.validateContent(newContent);
    }

    /**
     * 完整验证 - 用于最终响应
     */
    validateFull(content: string): ValidationResult {
        if (!this.options.enabled) {
            return { valid: true };
        }

        // 检查长度
        if (content.length > this.options.maxResponseLength) {
            return {
                valid: false,
                violationType: 'length',
                details: `Response length ${content.length} exceeds maximum ${this.options.maxResponseLength}`,
                action: 'truncate',
                detectedPatterns: [`length:${content.length}`],
            };
        }

        return this.validateContent(content);
    }

    /**
     * 核心验证逻辑
     */
    private validateContent(content: string): ValidationResult {
        const issues: string[] = [];

        // 1. 检查无意义模式
        const nonsenseResult = this.checkNonsensePatterns(content);
        if (nonsenseResult.detected > 0) {
            issues.push(`nonsense_patterns:${nonsenseResult.detected}`);
        }

        // 2. 检查重复词
        const repetitionResult = this.checkRepetition(content);
        if (repetitionResult.maxRepetition > this.options.repetitionThreshold) {
            issues.push(`repetition:${repetitionResult.word}:${repetitionResult.maxRepetition}`);
        }

        // 3. 检查幻觉高频词
        const hallucinationResult = this.checkHallucinationWords(content);
        if (hallucinationResult.suspicious) {
            issues.push(`hallucination_words:${hallucinationResult.words.join(',')}`);
        }

        // 4. 检查编码问题
        const encodingResult = this.checkEncoding(content);
        if (!encodingResult.valid) {
            issues.push(`encoding_issues`);
        }

        this.detectedIssues.push(...issues);

        // 根据检测结果决定行动
        if (issues.length >= this.options.nonsenseThreshold) {
            return {
                valid: false,
                violationType: 'nonsense',
                details: `Detected ${issues.length} issues: ${issues.join('; ')}`,
                action: this.options.abortOnViolation ? 'abort' : 'warn',
                detectedPatterns: issues,
            };
        }

        if (issues.length > 0) {
            return {
                valid: true,
                details: `Minor issues detected: ${issues.join('; ')}`,
                action: 'warn',
                detectedPatterns: issues,
            };
        }

        return { valid: true };
    }

    /**
     * 检查无意义模式
     */
    private checkNonsensePatterns(content: string): { detected: number; patterns: string[] } {
        const patterns: string[] = [];
        let detected = 0;

        for (const pattern of KNOWN_NONSENSE_PATTERNS) {
            const matches = content.match(pattern);
            if (matches && matches.length > 0) {
                detected += matches.length;
                patterns.push(pattern.source.slice(0, 50));
            }
        }

        return { detected, patterns };
    }

    /**
     * 检查重复词
     */
    private checkRepetition(content: string): { word: string; maxRepetition: number } {
        const words = content.toLowerCase().split(/\s+/);
        const wordCounts = new Map<string, number>();
        let maxRepetition = 0;
        let maxWord = '';

        // 统计连续重复
        let currentWord = '';
        let currentCount = 0;

        for (const word of words) {
            if (word.length < 3) continue; // 忽略短词

            if (word === currentWord) {
                currentCount++;
                if (currentCount > maxRepetition) {
                    maxRepetition = currentCount;
                    maxWord = word;
                }
            } else {
                currentWord = word;
                currentCount = 1;
            }
        }

        // 也统计非连续的高频词
        for (const word of words) {
            if (word.length < 3) continue;
            const count = (wordCounts.get(word) || 0) + 1;
            wordCounts.set(word, count);
        }

        // 检查幻觉词汇的频率
        const windowSize = Math.min(content.length, this.options.checkWindowSize);
        const windowContent = content.slice(-windowSize).toLowerCase();

        for (const hallucinationWord of HALLUCINATION_WORDS) {
            const regex = new RegExp(`\\b${hallucinationWord}\\b`, 'gi');
            const matches = windowContent.match(regex);
            if (matches && matches.length > 10) {
                // 单个词在窗口内出现超过 10 次
                if (matches.length > maxRepetition) {
                    maxRepetition = matches.length;
                    maxWord = hallucinationWord;
                }
            }
        }

        return { word: maxWord, maxRepetition };
    }

    /**
     * 检查幻觉高频词
     */
    private checkHallucinationWords(content: string): { suspicious: boolean; words: string[] } {
        const suspiciousWords: string[] = [];
        const lowerContent = content.toLowerCase();

        for (const word of HALLUCINATION_WORDS) {
            // 计算词频
            const regex = new RegExp(`\\b${word}\\b`, 'gi');
            const matches = lowerContent.match(regex);
            const count = matches ? matches.length : 0;

            // 如果某个词出现频率异常高（每 100 个字符超过 1 次）
            const frequency = count / (content.length / 100);
            if (frequency > 1 && count > 20) {
                suspiciousWords.push(`${word}:${count}`);
            }
        }

        return {
            suspicious: suspiciousWords.length > 2,
            words: suspiciousWords,
        };
    }

    /**
     * 检查编码问题
     */
    private checkEncoding(content: string): { valid: boolean } {
        // 检查是否有无效的 UTF-8 序列
        try {
            // 尝试编码再解码，看是否一致
            const encoded = encodeURIComponent(content);
            const decoded = decodeURIComponent(encoded);
            return { valid: decoded === content };
        } catch {
            return { valid: false };
        }
    }

    /**
     * 获取所有检测到的问题
     */
    getDetectedIssues(): string[] {
        return [...this.detectedIssues];
    }

    /**
     * 获取当前配置
     */
    getOptions(): Readonly<ResponseValidatorOptions> {
        return { ...this.options };
    }
}

/**
 * 创建默认验证器
 */
export function createResponseValidator(options?: Partial<ResponseValidatorOptions>): ResponseValidator {
    return new ResponseValidator(options);
}

/**
 * 快速验证函数 - 用于单次验证
 */
export function validateResponse(content: string, options?: Partial<ResponseValidatorOptions>): ValidationResult {
    const validator = new ResponseValidator(options);
    return validator.validateFull(content);
}
