import { v4 as uuid } from 'uuid';
import type { EventFilter, EventStream, RuntimeEvent } from './types';

interface Subscriber {
    id: string;
    filter: EventFilter;
    listener: (event: RuntimeEvent) => void;
}

export class InMemoryEventStream implements EventStream {
    private readonly events: RuntimeEvent[] = [];
    private readonly subscribers = new Map<string, Subscriber>();

    publish(event: RuntimeEvent): void {
        const normalized: RuntimeEvent = {
            ...event,
            eventId: event.eventId || uuid(),
            timestamp: event.timestamp || Date.now(),
        };

        this.events.push(normalized);

        for (const subscriber of this.subscribers.values()) {
            if (!this.matches(subscriber.filter, normalized)) continue;
            subscriber.listener(normalized);
        }
    }

    subscribe(filter: EventFilter, listener: (event: RuntimeEvent) => void): () => void {
        const id = uuid();
        this.subscribers.set(id, { id, filter, listener });

        return () => {
            this.subscribers.delete(id);
        };
    }

    replay(filter?: EventFilter): RuntimeEvent[] {
        if (!filter) return [...this.events];
        return this.events.filter((event) => this.matches(filter, event));
    }

    private matches(filter: EventFilter, event: RuntimeEvent): boolean {
        if (filter.runId && event.runId !== filter.runId) {
            return false;
        }
        if (filter.agentId && event.agentId !== filter.agentId) {
            return false;
        }
        if (filter.types && filter.types.length > 0 && !filter.types.includes(event.type)) {
            return false;
        }
        return true;
    }
}
