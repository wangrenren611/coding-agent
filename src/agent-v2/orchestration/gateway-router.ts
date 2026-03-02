import type {
    AgentCapabilities,
    AgentProfile,
    RouteBinding,
    RouteDecision,
    RouteRequest,
    SemanticRoutingConfig,
    StateStore,
} from './types';

type RouterOptions = {
    defaultAgentId?: string;
    semanticRouting?: SemanticRoutingConfig;
};

type SemanticCandidate = {
    agentId: string;
    bindingId?: string;
    keywords: string[];
    score: number;
};

export class GatewayRouter {
    private readonly stateStore: StateStore;
    private defaultAgentId?: string;
    private readonly semanticRouting: Required<SemanticRoutingConfig>;

    constructor(stateStore: StateStore, options?: RouterOptions) {
        this.stateStore = stateStore;
        this.defaultAgentId = options?.defaultAgentId;
        this.semanticRouting = {
            enabled: options?.semanticRouting?.enabled ?? false,
            minScore:
                options?.semanticRouting?.minScore && options.semanticRouting.minScore > 0
                    ? options.semanticRouting.minScore
                    : 0.2,
            preferBindings: options?.semanticRouting?.preferBindings !== false,
        };
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
        const matchedBindings = bindings.filter((binding) => this.matches(binding, request));

        const semanticDecision = this.routeBySemantic(request, matchedBindings, stickyKey);
        if (semanticDecision) {
            this.stateStore.saveRouteSession(stickyKey, semanticDecision.agentId);
            return semanticDecision;
        }

        const matched = matchedBindings[0];

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

    private routeBySemantic(
        request: RouteRequest,
        matchedBindings: RouteBinding[],
        stickyKey: string
    ): RouteDecision | undefined {
        if (!this.semanticRouting.enabled) {
            return undefined;
        }

        const semanticQuery = this.extractSemanticQuery(request);
        if (!semanticQuery) {
            return undefined;
        }

        const candidates = this.buildSemanticCandidates(matchedBindings);
        if (candidates.length === 0) {
            return undefined;
        }

        let best: SemanticCandidate | undefined;
        for (const candidate of candidates) {
            const evaluated = this.scoreCandidate(candidate, semanticQuery);
            if (!best || evaluated.score > best.score) {
                best = evaluated;
            }
        }

        if (!best || best.score < this.semanticRouting.minScore) {
            return undefined;
        }

        return {
            agentId: best.agentId,
            bindingId: best.bindingId,
            reason: 'semantic',
            stickyKey,
            semanticScore: Number(best.score.toFixed(4)),
            semanticMatchedKeywords: best.keywords.filter((keyword) => semanticQuery.includes(keyword.toLowerCase())),
        };
    }

    private buildSemanticCandidates(matchedBindings: RouteBinding[]): SemanticCandidate[] {
        if (this.semanticRouting.preferBindings && matchedBindings.length > 0) {
            return matchedBindings.map((binding) => ({
                agentId: binding.agentId,
                bindingId: binding.bindingId,
                keywords: this.collectAgentKeywords(this.stateStore.getAgentProfile(binding.agentId), binding),
                score: 0,
            }));
        }

        return this.stateStore.listAgentProfiles().map((profile) => ({
            agentId: profile.agentId,
            keywords: this.collectAgentKeywords(profile),
            score: 0,
        }));
    }

    private collectAgentKeywords(profile?: AgentProfile, binding?: RouteBinding): string[] {
        if (!profile) {
            return [];
        }
        const capabilityKeywords = this.collectCapabilityKeywords(profile.capabilities);
        const base = [profile.agentId, profile.role, binding?.channel, binding?.account, ...(capabilityKeywords || [])];

        return Array.from(
            new Set(
                base
                    .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
                    .filter((value) => value.length > 0)
            )
        );
    }

    private collectCapabilityKeywords(capabilities?: AgentCapabilities): string[] {
        if (!capabilities) return [];
        return [
            ...(capabilities.keywords || []),
            ...(capabilities.domains || []),
            ...(capabilities.tools || []),
            capabilities.summary || '',
        ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    }

    private scoreCandidate(candidate: SemanticCandidate, normalizedQuery: string): SemanticCandidate {
        if (candidate.keywords.length === 0) {
            return candidate;
        }

        const queryTokens = this.tokenize(normalizedQuery);
        let score = 0;
        for (const keyword of candidate.keywords) {
            const normalizedKeyword = keyword.toLowerCase();
            if (normalizedQuery.includes(normalizedKeyword)) {
                score += 1;
                continue;
            }
            if (queryTokens.has(normalizedKeyword)) {
                score += 0.6;
            }
        }

        const activeRuns = this.stateStore.listRuns({
            agentId: candidate.agentId,
            statuses: ['queued', 'running'],
        }).length;
        const loadPenalty = activeRuns * 0.05;
        const normalizedScore = Math.max(0, score / Math.max(candidate.keywords.length, 1) - loadPenalty);
        return {
            ...candidate,
            score: normalizedScore,
        };
    }

    private extractSemanticQuery(request: RouteRequest): string | undefined {
        if (typeof request.intent === 'string' && request.intent.trim().length > 0) {
            return request.intent.trim().toLowerCase();
        }
        const metadata = request.metadata;
        if (!metadata || typeof metadata !== 'object') {
            return undefined;
        }
        const fields = ['semanticQuery', 'query', 'task', 'objective', 'message', 'input'];
        for (const field of fields) {
            const value = metadata[field];
            if (typeof value === 'string' && value.trim().length > 0) {
                return value.trim().toLowerCase();
            }
        }
        return undefined;
    }

    private tokenize(input: string): Set<string> {
        const words = input
            .toLowerCase()
            .split(/[^a-z0-9_\u4e00-\u9fa5]+/g)
            .map((token) => token.trim())
            .filter((token) => token.length > 0);
        return new Set(words);
    }
}
