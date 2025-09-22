export function dedupeByKey<T, K>(items: readonly T[], keyFn: (item: T) => K): T[] {
    const seen = new Set<K>();
    const result: T[] = [];

    for (const item of items) {
        const key = keyFn(item);

        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        result.push(item);
    }

    return result;
}
