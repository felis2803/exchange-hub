type AbstractProto = Record<string, readonly string[]>;

type ExtraUnknownField<Field extends string> = `unknown${Capitalize<Field>}`;

type UnionToIntersection<Union> = (Union extends any ? (x: Union) => 0 : never) extends (x: infer Intersection) => 0
    ? Intersection
    : never;

type Merge<Union> = { [Field in keyof UnionToIntersection<Union>]: UnionToIntersection<Union>[Field] };

type Invert<Proto extends AbstractProto> = Merge<
    {
        [Field in keyof Proto]: {
            [Value in Proto[Field][number] | ExtraUnknownField<Extract<Field, string>>]: Field;
        };
    }[keyof Proto]
>;

type MetaContainer<Container, Proto extends AbstractProto> = new (fields: (keyof Proto)[]) => Container & {
    [Value in keyof Invert<Proto>]: InstanceType<
        MetaContainer<
            Container,
            {
                [Field in Exclude<keyof Proto, Invert<Proto>[Value]>]: Proto[Field];
            }
        >
    >;
};

export function createContainer<EntityClass extends { new (key: string): any }, Proto extends AbstractProto>(
    Entity: EntityClass,
    proto: Proto,
) {
    class Container {
        static #Entity = Entity;

        #map = new Map<string, InstanceType<EntityClass>>();

        get Entity() {
            return Container.#Entity;
        }

        constructor(fields: (keyof Proto)[]) {
            fields.forEach(field => {
                const newFields = fields.filter(f => f !== field);

                proto[field].forEach(value => ((this as any)[value] = new Container(newFields)));
            });
        }

        get(key: string) {
            return this.#map.get(key);
        }

        ensure(key: string) {
            if (!this.#map.has(key)) {
                this.#map.set(key, new Entity(key));
            }

            return this.#map.get(key)!;
        }
    }

    return Container as MetaContainer<Container, Proto>;
}
