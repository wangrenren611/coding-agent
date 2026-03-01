import type {
    BudgetPolicy,
    ExecutionPolicyContext,
    MessagingPolicy,
    MessagingPolicyContext,
    PolicyDecision,
    PolicyEngine,
    SpawnPolicyContext,
    StateStore,
} from './types';

const DEFAULT_BUDGET_POLICY: BudgetPolicy = {
    maxConcurrentRuns: 8,
    maxDepth: 4,
    maxChildrenPerRun: 16,
};

type PolicyEngineOptions = {
    budget?: Partial<BudgetPolicy>;
    messaging?: MessagingPolicy;
};

export class DefaultPolicyEngine implements PolicyEngine {
    private readonly stateStore: StateStore;
    private readonly budget: BudgetPolicy;
    private readonly messagingPolicy?: MessagingPolicy;

    constructor(stateStore: StateStore, options?: Partial<BudgetPolicy> | PolicyEngineOptions) {
        this.stateStore = stateStore;
        const { budget, messaging } = this.resolveOptions(options);
        this.budget = {
            ...DEFAULT_BUDGET_POLICY,
            ...budget,
        };
        this.messagingPolicy = messaging;
    }

    canExecute(context: ExecutionPolicyContext): PolicyDecision {
        if (context.depth > this.budget.maxDepth) {
            return { allowed: false, reason: `Execution depth exceeded: ${context.depth} > ${this.budget.maxDepth}` };
        }

        const activeRuns = this.stateStore.listRuns({
            statuses: ['queued', 'running'],
        });
        if (activeRuns.length >= this.budget.maxConcurrentRuns) {
            return {
                allowed: false,
                reason: `Concurrent run limit exceeded: ${activeRuns.length} >= ${this.budget.maxConcurrentRuns}`,
            };
        }

        return { allowed: true };
    }

    canSpawn(context: SpawnPolicyContext): PolicyDecision {
        if (!context.parentRunId) {
            return { allowed: true };
        }

        const children = this.stateStore.listRuns({
            parentRunId: context.parentRunId,
        });
        if (children.length >= this.budget.maxChildrenPerRun) {
            return {
                allowed: false,
                reason: `Child run limit exceeded for parent ${context.parentRunId}: ${children.length} >= ${this.budget.maxChildrenPerRun}`,
            };
        }

        return { allowed: true };
    }

    canMessage(context: MessagingPolicyContext): PolicyDecision {
        const policy = this.messagingPolicy;
        if (!policy) {
            return { allowed: true };
        }

        for (const blocked of policy.blockedRules || []) {
            if (
                this.matchesAgent(blocked.fromAgentId, context.fromAgentId) &&
                this.matchesAgent(blocked.toAgentId, context.toAgentId)
            ) {
                return {
                    allowed: false,
                    reason: `Message blocked by policy: ${context.fromAgentId} -> ${context.toAgentId}`,
                };
            }
        }

        if (policy.allowedTopics && policy.allowedTopics.length > 0) {
            if (!context.topic) {
                return {
                    allowed: false,
                    reason: 'Message topic is required by messaging policy',
                };
            }
            if (!policy.allowedTopics.includes(context.topic)) {
                return {
                    allowed: false,
                    reason: `Message topic not allowed: ${context.topic}`,
                };
            }
        }

        if (policy.allowedRules && policy.allowedRules.length > 0) {
            const matchedRule = policy.allowedRules.find((rule) => {
                if (!this.matchesAgent(rule.fromAgentId, context.fromAgentId)) return false;
                if (!this.matchesAgent(rule.toAgentId, context.toAgentId)) return false;
                if (rule.topics && rule.topics.length > 0) {
                    return Boolean(context.topic) && rule.topics.includes(context.topic as string);
                }
                return true;
            });
            if (!matchedRule) {
                return {
                    allowed: false,
                    reason: `Message route not allowed: ${context.fromAgentId} -> ${context.toAgentId}`,
                };
            }
        }

        return { allowed: true };
    }

    resolveModel(_agentId: string, requestedModel?: string): string | undefined {
        return requestedModel;
    }

    private resolveOptions(options?: Partial<BudgetPolicy> | PolicyEngineOptions): {
        budget?: Partial<BudgetPolicy>;
        messaging?: MessagingPolicy;
    } {
        if (!options) return {};

        if (this.isPolicyEngineOptions(options)) {
            return {
                budget: options.budget,
                messaging: options.messaging,
            };
        }

        return {
            budget: options as Partial<BudgetPolicy>,
        };
    }

    private matchesAgent(pattern: string, actual: string): boolean {
        return pattern === '*' || pattern === actual;
    }

    private isPolicyEngineOptions(
        options: Partial<BudgetPolicy> | PolicyEngineOptions
    ): options is PolicyEngineOptions {
        return 'budget' in options || 'messaging' in options;
    }
}
