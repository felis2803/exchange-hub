export type MetricLabelValue = string | number | boolean;

export type MetricLabels = Record<string, MetricLabelValue>;

type CounterMap = Map<string, number>;
type HistogramMap = Map<string, number[]>;

const counters: Map<string, CounterMap> = new Map();
const histograms: Map<string, HistogramMap> = new Map();

function serializeLabels(labels?: MetricLabels): string {
    if (!labels) {
        return '';
    }

    const entries = Object.entries(labels)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, typeof value === 'boolean' ? Number(value) : value] as const)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    if (entries.length === 0) {
        return '';
    }

    return JSON.stringify(entries);
}

function getCounterStore(name: string): CounterMap {
    let store = counters.get(name);

    if (!store) {
        store = new Map();
        counters.set(name, store);
    }

    return store;
}

function getHistogramStore(name: string): HistogramMap {
    let store = histograms.get(name);

    if (!store) {
        store = new Map();
        histograms.set(name, store);
    }

    return store;
}

export function incrementCounter(name: string, value = 1, labels?: MetricLabels): void {
    if (!Number.isFinite(value)) {
        throw new Error(`Counter ${name} increment must be a finite number`);
    }

    const store = getCounterStore(name);
    const key = serializeLabels(labels);
    const current = store.get(key) ?? 0;

    store.set(key, current + value);
}

export function observeHistogram(name: string, value: number, labels?: MetricLabels): void {
    if (!Number.isFinite(value)) {
        throw new Error(`Histogram ${name} observation must be a finite number`);
    }

    const store = getHistogramStore(name);
    const key = serializeLabels(labels);
    const bucket = store.get(key);

    if (bucket) {
        bucket.push(value);

        return;
    }

    store.set(key, [value]);
}

export function getCounterValue(name: string, labels?: MetricLabels): number {
    const store = counters.get(name);

    if (!store) {
        return 0;
    }

    const key = serializeLabels(labels);

    return store.get(key) ?? 0;
}

export function getHistogramValues(name: string, labels?: MetricLabels): readonly number[] {
    const store = histograms.get(name);

    if (!store) {
        return [];
    }

    const key = serializeLabels(labels);

    return store.get(key) ?? [];
}

export function resetMetrics(): void {
    counters.clear();
    histograms.clear();
}
