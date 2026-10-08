import { validateComponentIdentity } from "./normalize";
import type { ComponentDefinition } from "./types";

export class ComponentRegistry {
    private readonly definitions = new Map<string, Map<number, ComponentDefinition>>();

    register(type: string, version: number, definition: ComponentDefinition): void {
        validateComponentIdentity(type, version);
        if (!definition || typeof definition.render !== "function" || (definition.validate !== undefined && typeof definition.validate !== "function")) {
            throw new Error("Component definition requires a render function and optional validator");
        }
        const versions = this.definitions.get(type) ?? new Map<number, ComponentDefinition>();
        if (versions.has(version)) throw new Error(`Component already registered: ${type}@${version}`);
        versions.set(version, { render: definition.render, validate: definition.validate });
        this.definitions.set(type, versions);
    }

    get(type: string, version: number): ComponentDefinition {
        const definition = this.definitions.get(type)?.get(version);
        if (!definition) throw new Error(`Unknown component: ${type}@${version}`);
        return definition;
    }
}
