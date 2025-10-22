export function omit<Proto extends Record<string, any>, ExKey extends string[]>(
    proto: Proto,
    excludeKeys: ExKey,
): Omit<Proto, ExKey[number]> {
    const newProto = { ...proto };

    excludeKeys.forEach(excludeKey => delete newProto[excludeKey]);

    return newProto;
}
