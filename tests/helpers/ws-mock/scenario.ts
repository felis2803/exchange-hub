export type PrivateTable = 'wallet' | 'position' | 'order';

type ScenarioEventBase = {
    at: number;
    order: number;
};

type RequireAuthEvent = ScenarioEventBase & { type: 'require-auth' };
type ExpectAuthEvent = ScenarioEventBase & { type: 'expect-auth' };
type SetAuthModeEvent = ScenarioEventBase & {
    type: 'set-auth-mode';
    mode: 'success' | 'already-authed';
};
type SendEvent = ScenarioEventBase & {
    type: 'send';
    table: PrivateTable;
    action: 'partial' | 'update' | 'insert' | 'delete';
    data: unknown[];
};
type DelayEvent = ScenarioEventBase & { type: 'delay'; duration: number };
type DropEvent = ScenarioEventBase & { type: 'drop'; code?: number; reason?: string };
type OpenEvent = ScenarioEventBase & { type: 'open' };
type AcceptReconnectEvent = ScenarioEventBase & { type: 'accept-reconnect' };
type ExpectSubscribeEvent = ScenarioEventBase & { type: 'expect-subscribe'; channels: string[] };
type SendSubscribeAckEvent = ScenarioEventBase & { type: 'send-subscribe-ack'; channels: string[] };

export type ScenarioEvent =
    | RequireAuthEvent
    | ExpectAuthEvent
    | SetAuthModeEvent
    | SendEvent
    | DelayEvent
    | DropEvent
    | OpenEvent
    | AcceptReconnectEvent
    | ExpectSubscribeEvent
    | SendSubscribeAckEvent;

class ScenarioTimeline {
    #events: ScenarioEvent[] = [];
    #order = 0;

    add<EventType extends Omit<ScenarioEvent, 'order'>>(event: EventType): ScenarioEvent {
        const enriched = { ...event, order: this.#order++ } as ScenarioEvent;

        this.#events.push(enriched);

        return enriched;
    }

    build(): ScenarioScript {
        const events = [...this.#events].sort((a, b) => {
            if (a.at === b.at) {
                return a.order - b.order;
            }

            return a.at - b.at;
        });

        return new ScenarioScript(events);
    }
}

export class ScenarioBuilder {
    #timeline: ScenarioTimeline;
    #cursor: number;

    constructor(timeline?: ScenarioTimeline, cursor = 0) {
        this.#timeline = timeline ?? new ScenarioTimeline();
        this.#cursor = cursor;
    }

    open(): this {
        this.#timeline.add({ type: 'open', at: this.#cursor } as OpenEvent);

        return this;
    }

    requireAuth(): this {
        this.#timeline.add({ type: 'require-auth', at: this.#cursor } as RequireAuthEvent);

        return this;
    }

    expectAuth(): this {
        this.#timeline.add({ type: 'expect-auth', at: this.#cursor } as ExpectAuthEvent);

        return this;
    }

    signalAlreadyAuthed(): this {
        this.#timeline.add({
            type: 'set-auth-mode',
            at: this.#cursor,
            mode: 'already-authed',
        } as SetAuthModeEvent);

        return this;
    }

    expectSubscribe(channels: string[]): this {
        this.#timeline.add({
            type: 'expect-subscribe',
            at: this.#cursor,
            channels: [...channels],
        } as ExpectSubscribeEvent);

        return this;
    }

    sendSubscribeAck(channels: string[]): this {
        this.#timeline.add({
            type: 'send-subscribe-ack',
            at: this.#cursor,
            channels: [...channels],
        } as SendSubscribeAckEvent);

        return this;
    }

    sendPartial(table: PrivateTable, rows: unknown[]): this {
        this.#addSendEvent(table, 'partial', rows);

        return this;
    }

    sendUpdate(table: PrivateTable, rows: unknown[]): this {
        this.#addSendEvent(table, 'update', rows);

        return this;
    }

    sendInsert(table: PrivateTable, rows: unknown[]): this {
        this.#addSendEvent(table, 'insert', rows);

        return this;
    }

    sendDelete(table: PrivateTable, rows: unknown[]): this {
        this.#addSendEvent(table, 'delete', rows);

        return this;
    }

    delay(ms: number): this {
        if (!Number.isFinite(ms) || ms < 0) {
            throw new RangeError(`Delay must be a non-negative finite number, received ${ms}`);
        }

        this.#timeline.add({ type: 'delay', at: this.#cursor, duration: ms } as DelayEvent);
        this.#cursor += ms;

        return this;
    }

    drop(options: { code?: number; reason?: string } = {}): this {
        const { code, reason } = options;

        this.#timeline.add({ type: 'drop', at: this.#cursor, code, reason } as DropEvent);

        return this;
    }

    acceptReconnect(): this {
        this.#timeline.add({ type: 'accept-reconnect', at: this.#cursor } as AcceptReconnectEvent);

        return this;
    }

    parallel(builders: ((branch: ScenarioBuilder) => void)[]): this {
        const start = this.#cursor;
        let maxCursor = this.#cursor;

        for (const build of builders) {
            const branch = new ScenarioBuilder(this.#timeline, start);

            build(branch);
            maxCursor = Math.max(maxCursor, branch.#cursor);
        }

        this.#cursor = maxCursor;

        return this;
    }

    build(): ScenarioScript {
        return this.#timeline.build();
    }

    #addSendEvent(table: PrivateTable, action: SendEvent['action'], rows: unknown[]): void {
        this.#timeline.add({
            type: 'send',
            at: this.#cursor,
            table,
            action,
            data: [...rows],
        } as SendEvent);
    }
}

export class ScenarioScript {
    #events: readonly ScenarioEvent[];

    constructor(events: readonly ScenarioEvent[]) {
        this.#events = events;
    }

    get events(): readonly ScenarioEvent[] {
        return this.#events;
    }
}

export function createScenario(): ScenarioBuilder {
    return new ScenarioBuilder();
}
