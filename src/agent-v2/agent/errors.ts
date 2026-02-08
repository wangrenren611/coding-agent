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

export class CompensationRetryError extends Error {
    constructor(message: string = 'Compensation retry requested.') {
        super(message);
        this.name = 'CompensationRetryError';
    }
}
