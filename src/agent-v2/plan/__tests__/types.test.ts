/**
 * Plan Types 测试 (简化版)
 */

import { describe, it, expect } from 'vitest';
import { generatePlanId, nowIso, planCreateSchema } from '../types';

describe('Plan Types', () => {
    describe('generatePlanId()', () => {
        it('应该生成唯一 ID', () => {
            const id1 = generatePlanId();
            const id2 = generatePlanId();
            
            expect(id1).not.toBe(id2);
            expect(id1).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
        });

        it('应该生成格式正确的 ID', () => {
            const id = generatePlanId();
            const parts = id.split('-');
            
            expect(parts.length).toBe(3);
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
    });
});
