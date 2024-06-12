export class EntityMap<T> extends Map<string, T> {
    get(key: string): T | undefined {
        return super.get(key);
    }
}
