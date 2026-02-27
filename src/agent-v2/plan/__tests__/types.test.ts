/**
 * Plan Types 测试
 */

import { describe, it, expect } from 'vitest';
import { generatePlanId, nowIso, planCreateSchema, isValidSessionId, sanitizeSessionId } from '../types';

describe('Plan Types', () => {
    describe('generatePlanId()', () => {
        it('应该生成唯一 ID', () => {
            const id1 = generatePlanId();
            const id2 = generatePlanId();

            expect(id1).not.toBe(id2);
        });

        it('应该生成格式正确的 ID（plan-{timestamp}-{random}）', () => {
            const id = generatePlanId();
            expect(id).toMatch(/^plan-[a-z0-9]+-[a-z0-9]+$/);
        });

        it('应该以 plan- 前缀开头', () => {
            const id = generatePlanId();
            expect(id.startsWith('plan-')).toBe(true);
        });
    });

    describe('nowIso()', () => {
        it('应该返回 ISO 格式的时间字符串', () => {
            const time = nowIso();
            expect(time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        });
    });

    describe('planCreateSchema', () => {
        it('应该验证有效的参数', () => {
            const result = planCreateSchema.safeParse({
                title: '测试计划',
                content: '# 计划内容',
            });
            expect(result.success).toBe(true);
        });

        it('应该拒绝空标题', () => {
            const result = planCreateSchema.safeParse({
                title: '',
                content: '# 计划内容',
            });
            expect(result.success).toBe(false);
        });

        it('应该拒绝空内容', () => {
            const result = planCreateSchema.safeParse({
                title: '测试计划',
                content: '',
            });
            expect(result.success).toBe(false);
        });

        it('应该拒绝超长标题（超过200字符）', () => {
            const result = planCreateSchema.safeParse({
                title: 'A'.repeat(201),
                content: '# 计划内容',
            });
            expect(result.success).toBe(false);
        });
    });

    describe('isValidSessionId()', () => {
        it('应该接受有效的 sessionId', () => {
            expect(isValidSessionId('abc123')).toBe(true);
            expect(isValidSessionId('session-123')).toBe(true);
            expect(isValidSessionId('session_456')).toBe(true);
            expect(isValidSessionId('SESSION')).toBe(true);
        });

        it('应该拒绝包含特殊字符的 sessionId', () => {
            expect(isValidSessionId('session@123')).toBe(false);
            expect(isValidSessionId('session.123')).toBe(false);
            expect(isValidSessionId('session/123')).toBe(false);
            expect(isValidSessionId('session 123')).toBe(false);
        });

        it('应该拒绝路径遍历字符', () => {
            expect(isValidSessionId('../escape')).toBe(false);
            expect(isValidSessionId('..\\escape')).toBe(false);
            expect(isValidSessionId('./path')).toBe(false);
        });

        it('应该拒绝空字符串', () => {
            expect(isValidSessionId('')).toBe(false);
        });

        it('应该拒绝超长 sessionId', () => {
            expect(isValidSessionId('A'.repeat(129))).toBe(false);
        });

        it('应该接受最大长度的 sessionId', () => {
            expect(isValidSessionId('A'.repeat(128))).toBe(true);
        });
    });

    describe('sanitizeSessionId()', () => {
        it('应该保留有效字符', () => {
            expect(sanitizeSessionId('abc123')).toBe('abc123');
            expect(sanitizeSessionId('session-123_abc')).toBe('session-123_abc');
        });

        it('应该移除危险字符', () => {
            expect(sanitizeSessionId('session@123')).toBe('session123');
            expect(sanitizeSessionId('../escape')).toBe('escape');
            expect(sanitizeSessionId('path/to/file')).toBe('pathtofile');
        });

        it('应该对全无效字符返回 null', () => {
            expect(sanitizeSessionId('@@@')).toBeNull();
            expect(sanitizeSessionId('../')).toBeNull();
        });

        it('应该对空字符串返回 null', () => {
            expect(sanitizeSessionId('')).toBeNull();
        });
    });
});
