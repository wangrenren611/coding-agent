/**
 * 监控指标模块测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Counter, Gauge, Histogram, MetricsRegistry, createAgentMetrics } from '../index';
import type { AgentMetrics } from '../index';

describe('监控指标模块', () => {
    let registry: MetricsRegistry;

    beforeEach(() => {
        registry = new MetricsRegistry({ prefix: 'test_' });
    });

    afterEach(() => {
        registry.clear();
    });

    describe('Counter', () => {
        let counter: Counter;

        beforeEach(() => {
            counter = registry.createCounter({
                name: 'requests',
                help: 'Total requests',
                labels: ['method', 'status'],
            });
        });

        it('should create Counter correctly', () => {
            expect(counter.name).toBe('test_requests');
            expect(counter.help).toBe('Total requests');
        });

        it('should increment counter', () => {
            counter.inc();
            expect(counter.getTotal()).toBe(1);
            counter.inc(5);
            expect(counter.getTotal()).toBe(6);
        });

        it('should handle labeled counting', () => {
            counter.inc(1, { method: 'GET', status: '200' });
            counter.inc(1, { method: 'POST', status: '201' });
            counter.inc(2, { method: 'GET', status: '200' });
            expect(counter.getValue({ method: 'GET', status: '200' })).toBe(3);
            expect(counter.getValue({ method: 'POST', status: '201' })).toBe(1);
        });

        it('should reset counter', () => {
            counter.inc(10);
            expect(counter.getTotal()).toBe(10);
            counter.reset();
            expect(counter.getTotal()).toBe(0);
        });

        it('should export Prometheus format', () => {
            counter.inc(3, { method: 'GET', status: '200' });
            const output = counter.export();
            expect(output).toContain('# HELP test_requests Total requests');
            expect(output).toContain('# TYPE test_requests counter');
        });
    });

    describe('Gauge', () => {
        let gauge: Gauge;

        beforeEach(() => {
            gauge = registry.createGauge({
                name: 'temperature',
                help: 'Current temperature',
                labels: ['location'],
            });
        });

        it('should create Gauge correctly', () => {
            expect(gauge.name).toBe('test_temperature');
            expect(gauge.help).toBe('Current temperature');
        });

        it('should set gauge value', () => {
            gauge.set(25);
            expect(gauge.getValue()).toBe(25);
        });

        it('should increment gauge', () => {
            gauge.set(10);
            gauge.inc(5);
            expect(gauge.getValue()).toBe(15);
        });

        it('should decrement gauge', () => {
            gauge.set(10);
            gauge.dec(3);
            expect(gauge.getValue()).toBe(7);
        });

        it('should export Prometheus format', () => {
            gauge.set(25, { location: 'room1' });
            const output = gauge.export();
            expect(output).toContain('# HELP test_temperature Current temperature');
            expect(output).toContain('# TYPE test_temperature gauge');
        });
    });

    describe('Histogram', () => {
        let histogram: Histogram;

        beforeEach(() => {
            histogram = registry.createHistogram({
                name: 'response_time',
                help: 'Response time in seconds',
                labels: ['endpoint'],
                buckets: [0.1, 0.5, 1, 2, 5],
            });
        });

        it('should create Histogram correctly', () => {
            expect(histogram.name).toBe('test_response_time');
            expect(histogram.help).toBe('Response time in seconds');
        });

        it('should observe values', () => {
            histogram.observe(0.5);
            histogram.observe(1.5);
            const stats = histogram.getStats();
            expect(stats.count).toBe(2);
            expect(stats.sum).toBe(2);
        });

        it('should export Prometheus format', () => {
            histogram.observe(0.5);
            const output = histogram.export();
            expect(output).toContain('# HELP test_response_time Response time in seconds');
            expect(output).toContain('# TYPE test_response_time histogram');
        });
    });

    describe('MetricsRegistry', () => {
        it('should create all metric types', () => {
            const counter = registry.createCounter({ name: 'c1', help: 'C1' });
            const gauge = registry.createGauge({ name: 'g1', help: 'G1' });
            const histogram = registry.createHistogram({ name: 'h1', help: 'H1' });
            expect(counter).toBeDefined();
            expect(gauge).toBeDefined();
            expect(histogram).toBeDefined();
        });

        it('should clear all metrics', () => {
            registry.createCounter({ name: 'c1', help: 'C1' });
            registry.createGauge({ name: 'g1', help: 'G1' });
            expect(registry.getMetricNames()).toHaveLength(2);
            registry.clear();
            expect(registry.getMetricNames()).toHaveLength(0);
        });

        it('should export all metrics', () => {
            registry.createCounter({ name: 'c1', help: 'C1' });
            registry.createGauge({ name: 'g1', help: 'G1' });
            const output = registry.export();
            expect(output).toContain('test_c1');
            expect(output).toContain('test_g1');
        });
    });

    describe('createAgentMetrics', () => {
        let metrics: AgentMetrics;

        beforeEach(() => {
            metrics = createAgentMetrics(registry);
        });

        it('should create all agent metrics', () => {
            expect(metrics.requestsTotal).toBeDefined();
            expect(metrics.requestsSuccess).toBeDefined();
            expect(metrics.requestsFailed).toBeDefined();
            expect(metrics.requestDuration).toBeDefined();
            expect(metrics.activeTasks).toBeDefined();
        });

        it('should record request counts', () => {
            metrics.requestsTotal.inc();
            metrics.requestsTotal.inc(2, { model: 'gpt-4', status: 'success' });
            expect(metrics.requestsTotal.getTotal()).toBe(3);
        });

        it('should record active tasks', () => {
            metrics.activeTasks.set(5);
            metrics.activeTasks.inc();
            metrics.activeTasks.dec();
            expect(metrics.activeTasks.getValue()).toBe(5);
        });
    });
});
