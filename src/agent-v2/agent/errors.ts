export class ToolError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ToolError';
    }
}

export class AgentError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AgentError';
    }
}
