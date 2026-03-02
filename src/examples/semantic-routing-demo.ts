#!/usr/bin/env tsx
/**
 * Semantic Routing Demo
 *
 * 演示：
 * 1) capability + semanticRouting 如何影响路由
 * 2) sticky 会话优先级高于语义重选
 * 3) routeAndExecute 会自动从 input 提取 intent
 */

import {
    DefaultPolicyEngine,
    InMemoryEventStream,
    InMemoryStateStore,
    OrchestratorKernel,
    type AgentRuntime,
    type ExecuteCommand,
    type RouteDecision,
    type RunHandle,
} from '../agent-v2/orchestration';

class RecordingRuntime implements AgentRuntime {
    public readonly calls: ExecuteCommand[] = [];

    async execute(command: ExecuteCommand): Promise<RunHandle> {
        this.calls.push(command);
        return {
            runId: `run-${this.calls.length}`,
            agentId: command.agentId,
            status: 'queued',
        };
    }

    async abort(): Promise<void> {
        return undefined;
    }

    stream(): () => void {
        return () => undefined;
    }

    async status() {
        return undefined;
    }
}

function printDecision(title: string, decision: RouteDecision): void {
    process.stdout.write(
        `[${title}] agent=${decision.agentId} reason=${decision.reason} stickyKey=${decision.stickyKey} score=${decision.semanticScore ?? '-'} matched=${decision.semanticMatchedKeywords?.join('|') || '-'}\n`
    );
}

async function main(): Promise<void> {
    const stateStore = new InMemoryStateStore();
    const eventStream = new InMemoryEventStream();
    const policyEngine = new DefaultPolicyEngine(stateStore);
    const runtime = new RecordingRuntime();

    const kernel = new OrchestratorKernel({
        runtime,
        stateStore,
        policyEngine,
        eventStream,
        semanticRouting: {
            enabled: true,
            minScore: 0.2,
            preferBindings: true,
        },
    });

    kernel.registerAgent({
        agentId: 'controller',
        role: 'controller',
        systemPrompt: 'controller',
        provider: {} as never,
        capabilities: {
            keywords: ['规划', '分解', '协作'],
        },
    });

    kernel.registerAgent({
        agentId: 'frontend-coder',
        role: 'coder',
        systemPrompt: 'frontend',
        provider: {} as never,
        capabilities: {
            keywords: ['前端', '页面', 'UI', 'react', 'tailwind'],
            domains: ['web'],
        },
    });

    kernel.registerAgent({
        agentId: 'payment-coder',
        role: 'coder',
        systemPrompt: 'payment',
        provider: {} as never,
        capabilities: {
            keywords: ['支付', '订单', 'checkout', 'transaction', '结算'],
            domains: ['commerce'],
        },
    });

    kernel.registerBinding({
        bindingId: 'eng-frontend',
        agentId: 'frontend-coder',
        priority: 1,
        channel: 'engineering',
        enabled: true,
    });
    kernel.registerBinding({
        bindingId: 'eng-payment',
        agentId: 'payment-coder',
        priority: 10,
        channel: 'engineering',
        enabled: true,
    });

    process.stdout.write('[setup] semantic routing enabled\n');

    const d1 = kernel.route({
        channel: 'engineering',
        stickyKey: 'tenant-1:thread-1',
        intent: '请实现支付 checkout 和订单结算流程',
    });
    printDecision('decision-1', d1);

    const d2 = kernel.route({
        channel: 'engineering',
        stickyKey: 'tenant-1:thread-1',
        intent: '顺便调一下页面 UI',
    });
    printDecision('decision-2(sticky)', d2);

    const d3 = kernel.route({
        channel: 'engineering',
        stickyKey: 'tenant-1:thread-2',
    });
    printDecision('decision-3(binding-fallback)', d3);

    const run = await kernel.routeAndExecute(
        {
            channel: 'engineering',
            stickyKey: 'tenant-1:thread-3',
        },
        '请修复支付模块的事务一致性与重复扣款问题'
    );
    process.stdout.write(`[routeAndExecute] run=${run.runId} agent=${run.agentId}\n`);

    const lastCall = runtime.calls[runtime.calls.length - 1];
    process.stdout.write(
        `[runtime] dispatched-agent=${lastCall?.agentId || '-'} input-type=${typeof lastCall?.input}\n`
    );
}

void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[semantic-routing-demo] fatal: ${message}\n`);
    process.exitCode = 1;
});
