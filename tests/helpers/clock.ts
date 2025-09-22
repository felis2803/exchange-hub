type TimeLike = number | Date | string;

function toTimestamp(value?: TimeLike): number {
    if (value === undefined) {
        return Date.now();
    }

    if (typeof value === 'number') {
        return value;
    }

    if (value instanceof Date) {
        return value.getTime();
    }

    if (typeof value === 'string') {
        const parsed = Date.parse(value);

        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    throw new TypeError(`Unable to convert ${String(value)} to timestamp`);
}

export interface WaitForOptions {
    timeoutMs?: number;
    intervalMs?: number;
}

export interface TestClockOptions {
    startTime?: TimeLike;
    useFakeTimers?: boolean;
}

export interface TestClock {
    readonly isUsingFakeTimers: boolean;
    now(): number;
    set(time: TimeLike): void;
    advance(ms: number): Promise<void>;
    wait(ms: number): Promise<void>;
    waitFor(condition: () => boolean | Promise<boolean>, options?: WaitForOptions): Promise<void>;
    useRealTimers(): void;
}

class JestClock implements TestClock {
    #currentMs: number;
    #usingFakeTimers: boolean;

    constructor(options: TestClockOptions = {}) {
        const { startTime, useFakeTimers = true } = options;

        this.#currentMs = toTimestamp(startTime);
        this.#usingFakeTimers = false;

        if (useFakeTimers) {
            this.#enableFakeTimers();
        }
    }

    get isUsingFakeTimers(): boolean {
        return this.#usingFakeTimers;
    }

    now(): number {
        return this.#usingFakeTimers ? this.#currentMs : Date.now();
    }

    set(time: TimeLike): void {
        const next = toTimestamp(time);

        this.#currentMs = next;

        if (this.#usingFakeTimers) {
            jest.setSystemTime(next);
        }
    }

    async advance(ms: number): Promise<void> {
        if (!Number.isFinite(ms) || ms < 0) {
            throw new RangeError(`advance requires non-negative finite milliseconds, received ${ms}`);
        }

        if (ms === 0) {
            if (this.#usingFakeTimers) {
                await jest.advanceTimersByTimeAsync(0);
            }

            return;
        }

        if (this.#usingFakeTimers) {
            this.#currentMs += ms;
            await jest.advanceTimersByTimeAsync(ms);

            return;
        }

        await new Promise(resolve => setTimeout(resolve, ms));
    }

    async wait(ms: number): Promise<void> {
        await this.advance(ms);
    }

    async waitFor(condition: () => boolean | Promise<boolean>, options: WaitForOptions = {}): Promise<void> {
        const { timeoutMs = 5_000, intervalMs = 10 } = options;
        const startedAt = this.now();
        let lastError: unknown;

        while (true) {
            try {
                if (await condition()) {
                    return;
                }
            } catch (err) {
                lastError = err;
            }

            if (this.now() - startedAt >= timeoutMs) {
                const error = new Error(`Condition timed out after ${timeoutMs}ms`);

                if (lastError !== undefined) {
                    (error as Error & { cause?: unknown }).cause = lastError;
                }

                throw error;
            }

            await this.advance(intervalMs);
        }
    }

    useRealTimers(): void {
        if (!this.#usingFakeTimers) {
            return;
        }

        jest.useRealTimers();
        this.#usingFakeTimers = false;
    }

    #enableFakeTimers(): void {
        if (this.#usingFakeTimers) {
            return;
        }

        jest.useFakeTimers();
        jest.setSystemTime(this.#currentMs);
        this.#usingFakeTimers = true;
    }
}

export function createTestClock(options: TestClockOptions = {}): TestClock {
    return new JestClock(options);
}
