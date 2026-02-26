import { StandardAdapter } from './standard';
import type { LLMRequest } from '../types';
export class KimiAdapter extends StandardAdapter {
    constructor(_options: { endpointPath?: string; defaultModel?: string } = {}) {
        super();
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
