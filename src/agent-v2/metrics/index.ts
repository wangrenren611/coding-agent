/**
 * 监控指标模块
 *
 * 提供 Prometheus 风格的监控指标，支持：
 * - Counter: 计数器（只增不减）
 * - Gauge: 仪表（可增可减）
 * - Histogram: 直方图（分布统计）
 *
 * @example
 * ```typescript
 * import { MetricsRegistry, createAgentMetrics } from './metrics';
 *
 * // 创建指标注册表
 * const registry = new MetricsRegistry({ prefix: 'agent_' });
 *
 * // 创建 Agent 指标
 * const metrics = createAgentMetrics(registry);
 *
 * // 记录指标
 * metrics.requestsTotal.inc();
 * metrics.requestDuration.observe(0.5); // 500ms
 *
 * // 导出 Prometheus 格式
 * console.log(registry.export());
 * ```
 */

// ==================== 类型定义 ====================

/**
 * 指标标签
 */
export interface MetricLabels {
    [key: string]: string;
}

/**
 * Counter 指标配置
 */
export interface CounterConfig {
    name: string;
    help: string;
    labels?: string[];
}

/**
 * Gauge 指标配置
 */
export interface GaugeConfig {
    name: string;
    help: string;
    labels?: string[];
}

/**
 * Histogram 指标配置
 */
export interface HistogramConfig {
    name: string;
    help: string;
    buckets?: number[];
    labels?: string[];
}

/**
 * 指标样本
 */
export interface MetricSample {
    value: number;
    labels: MetricLabels;
    timestamp: number;
}

/**
 * Counter 统计信息
 */
export interface CounterStats {
    count: number;
    lastUpdated: number;
}

/**
 * Gauge 统计信息
 */
export interface GaugeStats {
    value: number;
    min: number;
    max: number;
    lastUpdated: number;
}

/**
 * Histogram 统计信息
 */
export interface HistogramStats {
    count: number;
    sum: number;
    min: number;
    max: number;
    avg: number;
    buckets: { boundary: number; count: number }[];
    lastUpdated: number;
}

// ==================== Counter 类 ====================

/**
 * Counter 指标 - 只增不减的计数器
 */
export class Counter {
    private value = 0;
    private readonly labelValues: Map<string, number> = new Map();
    private lastUpdated = Date.now();

    constructor(
        public readonly name: string,
        public readonly help: string,
        private readonly labelNames: string[] = []
    ) {}

    /**
     * 增加计数
     */
    inc(value: number = 1, labels: MetricLabels = {}): void {
        const key = this.getLabelKey(labels);
        const current = this.labelValues.get(key) ?? 0;
        this.labelValues.set(key, current + value);
        this.value += value;
        this.lastUpdated = Date.now();
    }

    /**
     * 重置计数器
     */
    reset(): void {
        this.value = 0;
        this.labelValues.clear();
        this.lastUpdated = Date.now();
    }

    /**
     * 获取当前值
     */
    getValue(labels: MetricLabels = {}): number {
        const key = this.getLabelKey(labels);
        return this.labelValues.get(key) ?? 0;
    }

    /**
     * 获取总计数
     */
    getTotal(): number {
        return this.value;
    }

    /**
     * 获取统计信息
     */
    getStats(): CounterStats {
        return {
            count: this.value,
            lastUpdated: this.lastUpdated,
        };
    }

    /**
     * 导出 Prometheus 格式
     */
    export(): string {
        let output = `# HELP ${this.name} ${this.help}\n`;
        output += `# TYPE ${this.name} counter\n`;

        for (const [key, value] of this.labelValues) {
            if (key) {
                output += `${this.name}{${key}} ${value}\n`;
            } else {
                output += `${this.name} ${value}\n`;
            }
        }

        return output;
    }

    private getLabelKey(labels: MetricLabels): string {
        return this.labelNames
            .filter((name) => labels[name] !== undefined)
            .map((name) => `${name}="${labels[name]}"`)
            .join(',');
    }
}

// ==================== Gauge 类 ====================

/**
 * Gauge 指标 - 可增可减的仪表
 */
export class Gauge {
    private value = 0;
    private readonly labelValues: Map<string, { value: number; min: number; max: number }> = new Map();
    private lastUpdated = Date.now();

    constructor(
        public readonly name: string,
        public readonly help: string,
        private readonly labelNames: string[] = []
    ) {}

    /**
     * 设置值
     */
    set(value: number, labels: MetricLabels = {}): void {
        const key = this.getLabelKey(labels);
        const existing = this.labelValues.get(key);
        this.labelValues.set(key, {
            value,
            min: Math.min(existing?.min ?? value, value),
            max: Math.max(existing?.max ?? value, value),
        });
        this.value = value;
        this.lastUpdated = Date.now();
    }

    /**
     * 增加值
     */
    inc(value: number = 1, labels: MetricLabels = {}): void {
        const key = this.getLabelKey(labels);
        const existing = this.labelValues.get(key);
        const newValue = (existing?.value ?? 0) + value;
        this.set(newValue, labels);
    }

    /**
     * 减少值
     */
    dec(value: number = 1, labels: MetricLabels = {}): void {
        const key = this.getLabelKey(labels);
        const existing = this.labelValues.get(key);
        const newValue = (existing?.value ?? 0) - value;
        this.set(newValue, labels);
    }

    /**
     * 获取当前值
     */
    getValue(labels: MetricLabels = {}): number {
        const key = this.getLabelKey(labels);
        return this.labelValues.get(key)?.value ?? 0;
    }

    /**
     * 获取统计信息
     */
    getStats(): GaugeStats {
        let min = Infinity;
        let max = -Infinity;

        for (const stats of this.labelValues.values()) {
            min = Math.min(min, stats.min);
            max = Math.max(max, stats.max);
        }

        return {
            value: this.value,
            min: min === Infinity ? 0 : min,
            max: max === -Infinity ? 0 : max,
            lastUpdated: this.lastUpdated,
        };
    }

    /**
     * 导出 Prometheus 格式
     */
    export(): string {
        let output = `# HELP ${this.name} ${this.help}\n`;
        output += `# TYPE ${this.name} gauge\n`;

        for (const [key, stats] of this.labelValues) {
            if (key) {
                output += `${this.name}{${key}} ${stats.value}\n`;
            } else {
                output += `${this.name} ${stats.value}\n`;
            }
        }

        return output;
    }

    private getLabelKey(labels: MetricLabels): string {
        return this.labelNames
            .filter((name) => labels[name] !== undefined)
            .map((name) => `${name}="${labels[name]}"`)
            .join(',');
    }
}

// ==================== Histogram 类 ====================

/**
 * Histogram 指标 - 分布统计
 */
export class Histogram {
    private readonly buckets: number[];
    private readonly bucketCounts: Map<string, number[]> = new Map();
    private readonly sums: Map<string, number> = new Map();
    private readonly counts: Map<string, number> = new Map();
    private readonly mins: Map<string, number> = new Map();
    private readonly maxs: Map<string, number> = new Map();
    private lastUpdated = Date.now();

    constructor(
        public readonly name: string,
        public readonly help: string,
        private readonly labelNames: string[] = [],
        buckets?: number[]
    ) {
        // 默认桶边界（秒为单位，适用于延迟统计）
        this.buckets = buckets ?? [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
    }

    /**
     * 观察一个值
     */
    observe(value: number, labels: MetricLabels = {}): void {
        const key = this.getLabelKey(labels);

        // 初始化
        if (!this.bucketCounts.has(key)) {
            this.bucketCounts.set(key, new Array(this.buckets.length + 1).fill(0));
            this.sums.set(key, 0);
            this.counts.set(key, 0);
            this.mins.set(key, Infinity);
            this.maxs.set(key, -Infinity);
        }

        const buckets = this.bucketCounts.get(key)!;
        const sum = this.sums.get(key)!;
        const count = this.counts.get(key)!;
        const min = this.mins.get(key)!;
        const max = this.maxs.get(key)!;

        // 更新桶计数
        for (let i = 0; i < this.buckets.length; i++) {
            if (value <= this.buckets[i]) {
                buckets[i]++;
            }
        }
        // +Inf 桶
        buckets[this.buckets.length]++;

        // 更新统计
        this.sums.set(key, sum + value);
        this.counts.set(key, count + 1);
        this.mins.set(key, Math.min(min, value));
        this.maxs.set(key, Math.max(max, value));

        this.lastUpdated = Date.now();
    }

    /**
     * 获取统计信息
     */
    getStats(labels: MetricLabels = {}): HistogramStats {
        const key = this.getLabelKey(labels);
        const count = this.counts.get(key) ?? 0;
        const sum = this.sums.get(key) ?? 0;
        const min = this.mins.get(key) ?? 0;
        const max = this.maxs.get(key) ?? 0;
        const bucketValues = this.bucketCounts.get(key) ?? new Array(this.buckets.length + 1).fill(0);

        const buckets = this.buckets.map((boundary, i) => ({
            boundary,
            count: bucketValues[i],
        }));

        return {
            count,
            sum,
            min: min === Infinity ? 0 : min,
            max: max === -Infinity ? 0 : max,
            avg: count > 0 ? sum / count : 0,
            buckets,
            lastUpdated: this.lastUpdated,
        };
    }

    /**
     * 导出 Prometheus 格式
     */
    export(): string {
        let output = `# HELP ${this.name} ${this.help}\n`;
        output += `# TYPE ${this.name} histogram\n`;

        for (const [key] of this.counts) {
            const buckets = this.bucketCounts.get(key)!;
            const sum = this.sums.get(key)!;
            const count = this.counts.get(key)!;
            const labelStr = key ? `{${key}}` : '';

            // 桶
            let cumulative = 0;
            for (let i = 0; i < this.buckets.length; i++) {
                cumulative += buckets[i];
                const bucketLabel = key ? `{${key},le="${this.buckets[i]}"}` : `{le="${this.buckets[i]}"}`;
                output += `${this.name}_bucket${bucketLabel} ${cumulative}\n`;
            }
            // +Inf 桶
            const infLabel = key ? `{${key},le="+Inf"}` : `{le="+Inf"}`;
            output += `${this.name}_bucket${infLabel} ${count}\n`;

            // sum 和 count
            output += `${this.name}_sum${labelStr} ${sum}\n`;
            output += `${this.name}_count${labelStr} ${count}\n`;
        }

        return output;
    }

    private getLabelKey(labels: MetricLabels): string {
        return this.labelNames
            .filter((name) => labels[name] !== undefined)
            .map((name) => `${name}="${labels[name]}"`)
            .join(',');
    }
}

// ==================== MetricsRegistry 类 ====================

/**
 * 指标注册表配置
 */
export interface MetricsRegistryConfig {
    /** 指标名前缀 */
    prefix?: string;
    /** 默认标签 */
    defaultLabels?: MetricLabels;
}

/**
 * 指标注册表 - 管理所有指标
 */
export class MetricsRegistry {
    private readonly counters: Map<string, Counter> = new Map();
    private readonly gauges: Map<string, Gauge> = new Map();
    private readonly histograms: Map<string, Histogram> = new Map();
    private readonly prefix: string;
    private readonly defaultLabels: MetricLabels;

    constructor(config: MetricsRegistryConfig = {}) {
        this.prefix = config.prefix ?? '';
        this.defaultLabels = config.defaultLabels ?? {};
    }

    /**
     * 创建 Counter 指标
     */
    createCounter(config: CounterConfig): Counter {
        const name = this.getFullName(config.name);
        if (this.counters.has(name)) {
            throw new Error(`Counter ${name} already exists`);
        }
        const counter = new Counter(name, config.help, config.labels);
        this.counters.set(name, counter);
        return counter;
    }

    /**
     * 获取或创建 Counter 指标
     */
    getOrCreateCounter(config: CounterConfig): Counter {
        const name = this.getFullName(config.name);
        if (this.counters.has(name)) {
            return this.counters.get(name)!;
        }
        return this.createCounter(config);
    }

    /**
     * 创建 Gauge 指标
     */
    createGauge(config: GaugeConfig): Gauge {
        const name = this.getFullName(config.name);
        if (this.gauges.has(name)) {
            throw new Error(`Gauge ${name} already exists`);
        }
        const gauge = new Gauge(name, config.help, config.labels);
        this.gauges.set(name, gauge);
        return gauge;
    }

    /**
     * 获取或创建 Gauge 指标
     */
    getOrCreateGauge(config: GaugeConfig): Gauge {
        const name = this.getFullName(config.name);
        if (this.gauges.has(name)) {
            return this.gauges.get(name)!;
        }
        return this.createGauge(config);
    }

    /**
     * 创建 Histogram 指标
     */
    createHistogram(config: HistogramConfig): Histogram {
        const name = this.getFullName(config.name);
        if (this.histograms.has(name)) {
            throw new Error(`Histogram ${name} already exists`);
        }
        const histogram = new Histogram(name, config.help, config.labels, config.buckets);
        this.histograms.set(name, histogram);
        return histogram;
    }

    /**
     * 获取或创建 Histogram 指标
     */
    getOrCreateHistogram(config: HistogramConfig): Histogram {
        const name = this.getFullName(config.name);
        if (this.histograms.has(name)) {
            return this.histograms.get(name)!;
        }
        return this.createHistogram(config);
    }

    /**
     * 获取 Counter
     */
    getCounter(name: string): Counter | undefined {
        return this.counters.get(this.getFullName(name));
    }

    /**
     * 获取 Gauge
     */
    getGauge(name: string): Gauge | undefined {
        return this.gauges.get(this.getFullName(name));
    }

    /**
     * 获取 Histogram
     */
    getHistogram(name: string): Histogram | undefined {
        return this.histograms.get(this.getFullName(name));
    }

    /**
     * 导出所有指标（Prometheus 格式）
     */
    export(): string {
        const outputs: string[] = [];

        for (const counter of this.counters.values()) {
            outputs.push(counter.export());
        }

        for (const gauge of this.gauges.values()) {
            outputs.push(gauge.export());
        }

        for (const histogram of this.histograms.values()) {
            outputs.push(histogram.export());
        }

        return outputs.join('\n');
    }

    /**
     * 清空所有指标
     */
    clear(): void {
        this.counters.clear();
        this.gauges.clear();
        this.histograms.clear();
    }

    /**
     * 获取所有指标名称
     */
    getMetricNames(): string[] {
        return [...this.counters.keys(), ...this.gauges.keys(), ...this.histograms.keys()];
    }

    private getFullName(name: string): string {
        return this.prefix ? `${this.prefix}${name}` : name;
    }
}

// ==================== Agent 指标工厂 ====================

/**
 * Agent 相关的指标集合
 */
export interface AgentMetrics {
    /** 请求总数 */
    requestsTotal: Counter;
    /** 成功请求总数 */
    requestsSuccess: Counter;
    /** 失败请求总数 */
    requestsFailed: Counter;
    /** 重试请求总数 */
    requestsRetried: Counter;
    /** 请求延迟（秒） */
    requestDuration: Histogram;
    /** LLM 调用延迟（秒） */
    llmCallDuration: Histogram;
    /** 工具执行延迟（秒） */
    toolExecutionDuration: Histogram;
    /** Token 使用量 */
    tokensUsed: Counter;
    /** 输入 Token */
    inputTokens: Counter;
    /** 输出 Token */
    outputTokens: Counter;
    /** 当前活跃任务数 */
    activeTasks: Gauge;
    /** 循环次数 */
    loopCount: Counter;
    /** 工具调用总数 */
    toolCallsTotal: Counter;
    /** 工具调用成功数 */
    toolCallsSuccess: Counter;
    /** 工具调用失败数 */
    toolCallsFailed: Counter;
}

/**
 * 创建 Agent 相关的指标
 */
export function createAgentMetrics(registry: MetricsRegistry): AgentMetrics {
    return {
        requestsTotal: registry.getOrCreateCounter({
            name: 'requests_total',
            help: 'Total number of agent requests',
            labels: ['model', 'status'],
        }),

        requestsSuccess: registry.getOrCreateCounter({
            name: 'requests_success_total',
            help: 'Total number of successful agent requests',
            labels: ['model'],
        }),

        requestsFailed: registry.getOrCreateCounter({
            name: 'requests_failed_total',
            help: 'Total number of failed agent requests',
            labels: ['model', 'error_type'],
        }),

        requestsRetried: registry.getOrCreateCounter({
            name: 'requests_retried_total',
            help: 'Total number of retried agent requests',
            labels: ['model', 'reason'],
        }),

        requestDuration: registry.getOrCreateHistogram({
            name: 'request_duration_seconds',
            help: 'Duration of agent requests in seconds',
            labels: ['model', 'status'],
            buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
        }),

        llmCallDuration: registry.getOrCreateHistogram({
            name: 'llm_call_duration_seconds',
            help: 'Duration of LLM API calls in seconds',
            labels: ['model', 'provider'],
            buckets: [0.5, 1, 2, 5, 10, 20, 30, 60, 120],
        }),

        toolExecutionDuration: registry.getOrCreateHistogram({
            name: 'tool_execution_duration_seconds',
            help: 'Duration of tool executions in seconds',
            labels: ['tool_name', 'status'],
            buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30],
        }),

        tokensUsed: registry.getOrCreateCounter({
            name: 'tokens_used_total',
            help: 'Total number of tokens used',
            labels: ['model', 'type'],
        }),

        inputTokens: registry.getOrCreateCounter({
            name: 'input_tokens_total',
            help: 'Total number of input tokens',
            labels: ['model'],
        }),

        outputTokens: registry.getOrCreateCounter({
            name: 'output_tokens_total',
            help: 'Total number of output tokens',
            labels: ['model'],
        }),

        activeTasks: registry.getOrCreateGauge({
            name: 'active_tasks',
            help: 'Number of currently active tasks',
        }),

        loopCount: registry.getOrCreateCounter({
            name: 'loop_count_total',
            help: 'Total number of agent loops',
            labels: ['model'],
        }),

        toolCallsTotal: registry.getOrCreateCounter({
            name: 'tool_calls_total',
            help: 'Total number of tool calls',
            labels: ['tool_name'],
        }),

        toolCallsSuccess: registry.getOrCreateCounter({
            name: 'tool_calls_success_total',
            help: 'Total number of successful tool calls',
            labels: ['tool_name'],
        }),

        toolCallsFailed: registry.getOrCreateCounter({
            name: 'tool_calls_failed_total',
            help: 'Total number of failed tool calls',
            labels: ['tool_name', 'error_type'],
        }),
    };
}

// ==================== 默认实例 ====================

/**
 * 全局默认指标注册表
 */
export const defaultRegistry = new MetricsRegistry({ prefix: 'qpscode_' });

/**
 * 全局默认 Agent 指标
 */
export const defaultAgentMetrics = createAgentMetrics(defaultRegistry);
