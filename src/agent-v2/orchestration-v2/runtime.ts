import { v4 as uuid } from 'uuid';
import { Agent } from '../agent/agent';
import type { AgentMessage } from '../agent/stream-types';
import { createDefaultToolRegistry, createPlanModeToolRegistry } from '../tool';
import type {
    AgentProfileV2,
    AgentRuntimeV2,
    ExecuteCommandV2,
    RunHandleV2,
    RunRecordV2,
    RuntimeEventV2,
    RuntimeRunStatus,
} from './types';

interface RunSubscriber {
    id: string;
    runId: string;
    listener: (event: RuntimeEventV2 | AgentMessage) => void;
}

export class LocalAgentRuntimeV2 implements AgentRuntimeV2 {
    private readonly profiles = new Map<string, AgentProfileV2>();
    private readonly runs = new Map<string, RunRecordV2>();
    private readonly activeAgents = new Map<string, Agent>();
    private readonly subscribers = new Map<string, RunSubscriber>();
    private readonly agentSessions = new Map<string, string>();
    private readonly agentLocalSessions = new Map<string, string>();
    private readonly sessionAgents = new Map<string, string>();
    private readonly parentScopeSessions = new Map<string, string>();

    upsertAgent(profile: AgentProfileV2): void {
        this.profiles.set(profile.agentId, { ...profile });
        if (profile.sessionId) {
            this.bindSession(profile.agentId, profile.sessionId);
            if (!this.agentLocalSessions.has(profile.agentId)) {
                this.agentLocalSessions.set(profile.agentId, profile.sessionId);
            }
        }
    }

    getAgent(agentId: string): AgentProfileV2 | undefined {
        const profile = this.profiles.get(agentId);
        return profile ? { ...profile } : undefined;
    }

    listAgents(): AgentProfileV2[] {
        return Array.from(this.profiles.values()).map((profile) => ({ ...profile }));
    }

    getAgentIdBySession(sessionId: string): string | undefined {
        return this.sessionAgents.get(sessionId);
    }

    async execute(command: ExecuteCommandV2): Promise<RunHandleV2> {
        const profile = this.resolveProfile(command);
        const runId = uuid();
        const now = Date.now();
        const queued: RunRecordV2 = {
            runId,
            agentId: command.agentId,
            status: 'queued',
            input: command.input,
            parentRunId: command.parentRunId,
            createdAt: now,
            metadata: command.metadata,
        };

        this.runs.set(runId, queued);
        this.emit(runId, {
            eventId: uuid(),
            timestamp: now,
            type: 'run.queued',
            runId,
            agentId: command.agentId,
        });

        void this.runAgent(runId, profile, command);

        return {
            runId,
            agentId: command.agentId,
            status: 'queued',
        };
    }

    async abort(runId: string): Promise<void> {
        const agent = this.activeAgents.get(runId);
        if (!agent) return;
        agent.abort();
    }

    stream(runId: string, listener: (event: RuntimeEventV2 | AgentMessage) => void): () => void {
        const id = uuid();
        this.subscribers.set(id, { id, runId, listener });
        return () => {
            this.subscribers.delete(id);
        };
    }

    async status(runId: string): Promise<RunRecordV2 | undefined> {
        const run = this.runs.get(runId);
        return run ? { ...run } : undefined;
    }

    private resolveProfile(command: ExecuteCommandV2): AgentProfileV2 {
        if (command.profile) {
            this.upsertAgent(command.profile);
            return command.profile;
        }

        const existing = this.profiles.get(command.agentId);
        if (!existing) {
            throw new Error(`Agent profile not found: ${command.agentId}`);
        }
        return existing;
    }

    private async runAgent(runId: string, profile: AgentProfileV2, command: ExecuteCommandV2): Promise<void> {
        const startedAt = Date.now();
        this.updateRun(runId, {
            status: 'running',
            startedAt,
        });
        this.emit(runId, {
            eventId: uuid(),
            timestamp: startedAt,
            type: 'run.started',
            runId,
            agentId: profile.agentId,
        });

        const agent = new Agent({
            provider: profile.provider,
            systemPrompt: profile.systemPrompt,
            toolRegistry: profile.toolRegistry || this.buildToolRegistry(profile),
            memoryManager: profile.memoryManager,
            sessionId: this.resolveSessionId(profile, command),
            maxRetries: profile.maxRetries,
            maxLoops: profile.maxLoops,
            requestTimeout: profile.requestTimeout,
            idleTimeout: profile.idleTimeout,
            retryDelayMs: profile.retryDelayMs,
            thinking: profile.thinking,
            stream: true,
            streamCallback: (message) => {
                this.emit(runId, message);
            },
        });

        this.activeAgents.set(runId, agent);
        this.bindSession(profile.agentId, agent.getSessionId());
        this.updateProfileSession(profile.agentId, agent.getSessionId());
        this.trackParentScopeSession(command.parentRunId, profile.role, agent.getSessionId());
        this.updateRun(runId, {
            sessionId: agent.getSessionId(),
        });

        try {
            const result = await this.executeWithTimeout(agent, command);
            if (result.status === 'completed') {
                const finishedAt = Date.now();
                const output = this.messageToText(result.finalMessage?.content);
                this.updateRun(runId, {
                    status: 'completed',
                    output,
                    sessionId: result.sessionId,
                    finishedAt,
                });
                this.bindSession(profile.agentId, result.sessionId);
                this.updateProfileSession(profile.agentId, result.sessionId);
                this.trackParentScopeSession(command.parentRunId, profile.role, result.sessionId);
                this.emit(runId, {
                    eventId: uuid(),
                    timestamp: finishedAt,
                    type: 'run.completed',
                    runId,
                    agentId: profile.agentId,
                    payload: {
                        output,
                        loopCount: result.loopCount,
                        retryCount: result.retryCount,
                    },
                });
                return;
            }

            const finishedAt = Date.now();
            const failedStatus: RuntimeRunStatus = result.status === 'aborted' ? 'aborted' : 'failed';
            const errorMessage = result.failure?.internalMessage || result.failure?.userMessage || 'Agent failed';
            this.updateRun(runId, {
                status: failedStatus,
                error: errorMessage,
                sessionId: result.sessionId,
                finishedAt,
            });
            this.bindSession(profile.agentId, result.sessionId);
            this.updateProfileSession(profile.agentId, result.sessionId);
            this.trackParentScopeSession(command.parentRunId, profile.role, result.sessionId);
            this.emit(runId, {
                eventId: uuid(),
                timestamp: finishedAt,
                type: failedStatus === 'aborted' ? 'run.aborted' : 'run.failed',
                runId,
                agentId: profile.agentId,
                payload: {
                    error: errorMessage,
                    code: result.failure?.code,
                },
            });
        } catch (error) {
            const finishedAt = Date.now();
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.updateRun(runId, {
                status: 'failed',
                error: errorMessage,
                finishedAt,
            });
            this.emit(runId, {
                eventId: uuid(),
                timestamp: finishedAt,
                type: 'run.failed',
                runId,
                agentId: profile.agentId,
                payload: { error: errorMessage },
            });
        } finally {
            this.activeAgents.delete(runId);
            await agent.close().catch(() => undefined);
        }
    }

    private async executeWithTimeout(agent: Agent, command: ExecuteCommandV2) {
        if (!command.timeoutMs || command.timeoutMs <= 0) {
            return agent.executeWithResult(command.input, command.options);
        }

        let timer: NodeJS.Timeout | undefined;
        try {
            return await Promise.race([
                agent.executeWithResult(command.input, command.options),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => {
                        agent.abort();
                        reject(new Error(`Run timeout exceeded: ${command.timeoutMs}ms`));
                    }, command.timeoutMs);
                }),
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    private buildToolRegistry(profile: AgentProfileV2) {
        if (profile.planMode) {
            return createPlanModeToolRegistry(
                {
                    workingDirectory: process.cwd(),
                    planBaseDir: profile.planBaseDir,
                    truncation: true,
                },
                profile.provider
            );
        }

        return createDefaultToolRegistry(
            {
                workingDirectory: process.cwd(),
                planBaseDir: profile.planBaseDir,
                truncation: true,
            },
            profile.provider
        );
    }

    private updateRun(runId: string, patch: Partial<RunRecordV2>): void {
        const current = this.runs.get(runId);
        if (!current) return;
        this.runs.set(runId, {
            ...current,
            ...patch,
        });
    }

    private resolveSessionId(profile: AgentProfileV2, command: ExecuteCommandV2): string | undefined {
        const boundSessionId = this.agentSessions.get(profile.agentId) || profile.sessionId;
        if (!command.parentRunId) {
            return boundSessionId;
        }

        const mainSessionId = this.resolveMainSessionId(command.parentRunId);
        if (!mainSessionId) {
            return boundSessionId;
        }

        if (this.isControllerRole(profile.role)) {
            return boundSessionId || mainSessionId;
        }

        const localSessionId = this.resolveLocalSessionId(profile.agentId, boundSessionId, mainSessionId);
        return this.composeChildSessionId(mainSessionId, localSessionId);
    }

    private resolveMainSessionId(parentRunId: string): string | undefined {
        const scoped = this.parentScopeSessions.get(parentRunId);
        if (scoped) return scoped;

        const visited = new Set<string>();
        let currentRunId: string | undefined = parentRunId;
        while (currentRunId && !visited.has(currentRunId)) {
            visited.add(currentRunId);
            const run = this.runs.get(currentRunId);
            if (!run) break;
            if (run.sessionId) return run.sessionId;
            currentRunId = run.parentRunId;
        }

        return this.findControllerSessionId();
    }

    private findControllerSessionId(): string | undefined {
        for (const profile of this.profiles.values()) {
            if (!this.isControllerRole(profile.role)) continue;
            const sessionId = this.agentSessions.get(profile.agentId) || profile.sessionId;
            if (sessionId) return sessionId;
        }
        return undefined;
    }

    private resolveLocalSessionId(agentId: string, boundSessionId: string | undefined, mainSessionId: string): string {
        const existingLocal = this.agentLocalSessions.get(agentId);
        if (existingLocal) {
            return existingLocal;
        }

        if (boundSessionId?.startsWith(`${mainSessionId}-`)) {
            const suffix = boundSessionId.slice(mainSessionId.length + 1).trim();
            if (suffix) {
                this.agentLocalSessions.set(agentId, suffix);
                return suffix;
            }
        }

        if (boundSessionId) {
            this.agentLocalSessions.set(agentId, boundSessionId);
            return boundSessionId;
        }

        const generatedLocal = uuid().replace(/-/g, '');
        this.agentLocalSessions.set(agentId, generatedLocal);
        return generatedLocal;
    }

    private composeChildSessionId(mainSessionId: string, localSessionId: string): string {
        if (localSessionId.startsWith(`${mainSessionId}-`)) {
            return localSessionId;
        }
        return `${mainSessionId}-${localSessionId}`;
    }

    private trackParentScopeSession(parentRunId: string | undefined, role: string, sessionId: string): void {
        if (!parentRunId) return;
        const existing = this.parentScopeSessions.get(parentRunId);
        if (!existing || this.isControllerRole(role)) {
            this.parentScopeSessions.set(parentRunId, sessionId);
        }
    }

    private isControllerRole(role: string): boolean {
        return role.trim().toLowerCase() === 'controller';
    }

    private bindSession(agentId: string, sessionId: string): void {
        const previousSession = this.agentSessions.get(agentId);
        if (previousSession) {
            this.sessionAgents.delete(previousSession);
        }
        this.agentSessions.set(agentId, sessionId);
        this.sessionAgents.set(sessionId, agentId);
    }

    private updateProfileSession(agentId: string, sessionId: string): void {
        const profile = this.profiles.get(agentId);
        if (!profile) return;
        this.profiles.set(agentId, {
            ...profile,
            sessionId,
        });
    }

    private emit(runId: string, event: RuntimeEventV2 | AgentMessage): void {
        for (const sub of this.subscribers.values()) {
            if (sub.runId !== runId) continue;
            sub.listener(event);
        }
    }

    private messageToText(content: unknown): string {
        if (typeof content === 'string') {
            return content;
        }
        if (!Array.isArray(content)) {
            return '';
        }
        return content
            .map((part) => {
                if (!part || typeof part !== 'object') return '';
                const typed = part as { type?: string; text?: string };
                if (typed.type === 'text' && typeof typed.text === 'string') {
                    return typed.text;
                }
                return '';
            })
            .filter(Boolean)
            .join('\n');
    }
}
