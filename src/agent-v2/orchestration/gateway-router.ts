import type { RouteBinding, RouteDecision, RouteRequest, StateStore } from './types';

export class GatewayRouter {
    private readonly stateStore: StateStore;
    private defaultAgentId?: string;

    constructor(stateStore: StateStore, options?: { defaultAgentId?: string }) {
        this.stateStore = stateStore;
        this.defaultAgentId = options?.defaultAgentId;
    }

    setDefaultAgent(agentId: string): void {
        this.defaultAgentId = agentId;
    }

    route(request: RouteRequest): RouteDecision {
        const stickyKey = this.buildStickyKey(request);
        const stickyAgentId = this.stateStore.getRouteSession(stickyKey);

        if (stickyAgentId) {
            return {
                agentId: stickyAgentId,
                reason: 'sticky',
                stickyKey,
            };
        }

        const bindings = this.stateStore.listBindings();
        const matched = bindings.find((binding) => this.matches(binding, request));

        const selectedAgentId = matched?.agentId || this.defaultAgentId;
        if (!selectedAgentId) {
            throw new Error('No agent matched route request and no default agent configured');
        }

        this.stateStore.saveRouteSession(stickyKey, selectedAgentId);
        return {
            agentId: selectedAgentId,
            bindingId: matched?.bindingId,
            reason: matched ? 'binding' : 'default',
            stickyKey,
        };
    }

    private buildStickyKey(request: RouteRequest): string {
        if (request.stickyKey && request.stickyKey.trim().length > 0) {
            return request.stickyKey.trim();
        }

        const channel = request.channel || '*';
        const account = request.account || '*';
        const thread = request.threadId || '*';
        return `${channel}:${account}:${thread}`;
    }

    private matches(binding: RouteBinding, request: RouteRequest): boolean {
        if (binding.enabled === false) {
            return false;
        }
        if (binding.channel && binding.channel !== request.channel) {
            return false;
        }
        if (binding.account && binding.account !== request.account) {
            return false;
        }
        if (binding.threadPrefix && !(request.threadId || '').startsWith(binding.threadPrefix)) {
            return false;
        }
        return true;
    }
}
