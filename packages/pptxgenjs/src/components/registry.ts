import { validateComponentIdentity } from "./normalize";
import { parseComponentProps } from "./schema";
import type { ComponentDefinition, ComponentProps } from "./types";

export class ComponentRegistry {
    private readonly definitions = new Map<string, Map<number, ComponentDefinition>>();

    register<Props extends object = ComponentProps>(type: string, version: number, definition: ComponentDefinition<Props>): void {
        validateComponentIdentity(type, version);
        if (!definition || typeof definition.render !== "function" || (definition.validate !== undefined && typeof definition.validate !== "function")) {
            throw new Error("Component definition requires a render function and optional validator");
        }
        if (definition.schema !== undefined && typeof definition.schema?.parse !== "function") throw new Error("Component schema requires a parse function");
        const versions = this.definitions.get(type) ?? new Map<number, ComponentDefinition>();
        if (versions.has(version)) throw new Error(`Component already registered: ${type}@${version}`);
        const { schema, validate, render } = definition;
        versions.set(version, {
            render: (savedProps, context) => {
                const props = schema ? parseComponentProps(schema, savedProps) : (savedProps as unknown as Props);
                validate?.(props);
                return render(props, context);
            },
        });
        this.definitions.set(type, versions);
    }

    get(type: string, version: number): ComponentDefinition {
        const definition = this.definitions.get(type)?.get(version);
        if (!definition) throw new Error(`Unknown component: ${type}@${version}`);
        return definition;
    }
}
