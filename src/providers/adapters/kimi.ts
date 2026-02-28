import { StandardAdapter } from './standard';
import type { LLMRequest } from '../types';
export class KimiAdapter extends StandardAdapter {
    constructor(options: { endpointPath?: string; defaultModel?: string } = {}) {
        super(options);
    }

    transformRequest(options?: LLMRequest): LLMRequest {
        return {
            ...super.transformRequest(options),
            thinking: {
                type: options?.thinking ? 'enabled' : 'disabled',
            },
        };
    }
}
