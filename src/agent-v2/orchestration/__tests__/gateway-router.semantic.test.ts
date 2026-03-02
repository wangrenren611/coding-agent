import { describe, expect, it } from 'vitest';
import { GatewayRouter } from '../gateway-router';
import { InMemoryStateStore } from '../state-store';

describe('GatewayRouter semantic routing', () => {
    it('routes to the best capability-matched agent when semantic routing is enabled', () => {
        const store = new InMemoryStateStore();
        store.saveAgentProfile({
            agentId: 'controller',
            role: 'controller',
            systemPrompt: 'controller',
            provider: {} as never,
            capabilities: {
                keywords: ['协调', '分解'],
            },
        });
        store.saveAgentProfile({
            agentId: 'security-reviewer',
            role: 'reviewer',
            systemPrompt: 'security',
            provider: {} as never,
            capabilities: {
                keywords: ['安全', '漏洞', '审计', '风控'],
                domains: ['payment', 'compliance'],
            },
        });

        const router = new GatewayRouter(store, {
            defaultAgentId: 'controller',
            semanticRouting: {
                enabled: true,
                minScore: 0.2,
            },
        });

        const decision = router.route({
            stickyKey: 'tenant-1:thread-1',
            intent: '请对支付模块做安全漏洞审计和风控评估',
        });

        expect(decision.agentId).toBe('security-reviewer');
        expect(decision.reason).toBe('semantic');
        expect((decision.semanticScore || 0) > 0).toBe(true);
    });

    it('keeps sticky session priority over semantic changes', () => {
        const store = new InMemoryStateStore();
        store.saveAgentProfile({
            agentId: 'security-reviewer',
            role: 'reviewer',
            systemPrompt: 'security',
            provider: {} as never,
            capabilities: { keywords: ['安全', '漏洞', '审计'] },
        });
        store.saveAgentProfile({
            agentId: 'frontend-coder',
            role: 'coder',
            systemPrompt: 'frontend',
            provider: {} as never,
            capabilities: { keywords: ['前端', '页面', 'UI'] },
        });

        const router = new GatewayRouter(store, {
            semanticRouting: { enabled: true },
        });

        const first = router.route({
            stickyKey: 'tenant-2:thread-1',
            intent: '请做一次安全审计',
        });
        expect(first.agentId).toBe('security-reviewer');

        const second = router.route({
            stickyKey: 'tenant-2:thread-1',
            intent: '顺便做一下页面 UI 调整',
        });
        expect(second.agentId).toBe('security-reviewer');
        expect(second.reason).toBe('sticky');
    });

    it('falls back to binding route when semantic query is absent', () => {
        const store = new InMemoryStateStore();
        store.saveAgentProfile({
            agentId: 'controller',
            role: 'controller',
            systemPrompt: 'controller',
            provider: {} as never,
        });
        store.saveAgentProfile({
            agentId: 'backend-coder',
            role: 'coder',
            systemPrompt: 'backend',
            provider: {} as never,
        });
        store.saveBinding({
            bindingId: 'binding-api',
            agentId: 'backend-coder',
            priority: 1,
            channel: 'api',
            enabled: true,
        });

        const router = new GatewayRouter(store, {
            defaultAgentId: 'controller',
            semanticRouting: { enabled: true },
        });

        const decision = router.route({
            channel: 'api',
            stickyKey: 'tenant-3:thread-1',
        });

        expect(decision.agentId).toBe('backend-coder');
        expect(decision.reason).toBe('binding');
    });

    it('reorders matched bindings by semantic score when enabled', () => {
        const store = new InMemoryStateStore();
        store.saveAgentProfile({
            agentId: 'general-coder',
            role: 'coder',
            systemPrompt: 'general',
            provider: {} as never,
            capabilities: { keywords: ['开发', '重构'] },
        });
        store.saveAgentProfile({
            agentId: 'security-coder',
            role: 'coder',
            systemPrompt: 'security',
            provider: {} as never,
            capabilities: { keywords: ['安全', '漏洞', '审计'] },
        });
        store.saveBinding({
            bindingId: 'binding-general',
            agentId: 'general-coder',
            priority: 1,
            channel: 'engineering',
            enabled: true,
        });
        store.saveBinding({
            bindingId: 'binding-security',
            agentId: 'security-coder',
            priority: 10,
            channel: 'engineering',
            enabled: true,
        });

        const router = new GatewayRouter(store, {
            semanticRouting: {
                enabled: true,
                minScore: 0.2,
                preferBindings: true,
            },
        });

        const decision = router.route({
            channel: 'engineering',
            stickyKey: 'tenant-4:thread-1',
            intent: '请对该模块做安全漏洞审计',
        });

        expect(decision.agentId).toBe('security-coder');
        expect(decision.bindingId).toBe('binding-security');
        expect(decision.reason).toBe('semantic');
    });
});
