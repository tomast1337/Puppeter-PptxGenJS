import { normalizeObjectStyle } from "../normalize/object";
import type { PageSize } from "../pageLayouts";
import type { ComponentInput, ComponentOptions, ComponentProps, ComponentValue } from "./types";

function cloneValue(value: unknown, parents = new Set<object>()): ComponentValue {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (!value || typeof value !== "object") throw new Error("Component props must contain only JSON values");
    if (parents.has(value)) throw new Error("Circular component props");
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null && prototype !== Array.prototype)
        throw new Error("Component props must be plain objects or arrays");
    if (Object.getOwnPropertySymbols(value).length) throw new Error("Component props cannot contain symbol keys");
    parents.add(value);
    try {
        const copy: Record<string, ComponentValue> = {};
        for (const key of Object.keys(value)) {
            if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error(`Reserved component prop: ${key}`);
            const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
            if (!("value" in descriptor)) throw new Error("Component props cannot contain accessors");
            copy[key] = cloneValue(descriptor.value, parents);
        }
        if (Array.isArray(value)) {
            if (Object.keys(copy).length !== value.length || Object.keys(copy).some((key, index) => key !== String(index))) {
                throw new Error("Component arrays must be dense without custom properties");
            }
            return Object.values(copy);
        }
        return copy;
    } finally {
        parents.delete(value);
    }
}

export function validateComponentIdentity(type: string, version: number): void {
    if (typeof type !== "string" || !type.trim() || !Number.isSafeInteger(version) || version < 1) {
        throw new Error("Components require a nonempty type and a positive integer version");
    }
}

export function cloneComponentProps(props: unknown): ComponentProps {
    if (!props || Array.isArray(props) || typeof props !== "object") throw new Error("Component props must be an object");
    return cloneValue(props) as ComponentProps;
}

export function normalizeComponent(input: ComponentInput, options: ComponentOptions, pageSize: PageSize, objectName: string) {
    if (!input || !options) throw new Error("Component input and geometry are required");
    validateComponentIdentity(input.type, input.version);
    if (Object.keys(input).length !== 3) throw new Error("Component input requires type, version and props");
    for (const key of ["x", "y", "w", "h"] as const) {
        if (typeof options[key] !== "number" || !Number.isFinite(options[key])) throw new Error(`Component ${key} must be finite inches`);
    }
    if (options.w <= 0 || options.h <= 0) throw new Error("Component width and height must be positive");
    if (options.objectName !== undefined && typeof options.objectName !== "string") throw new Error("Component objectName must be a string");
    for (const key of Object.keys(options)) {
        if (!["x", "y", "w", "h", "objectName"].includes(key)) throw new Error(`Unsupported component option: ${key}`);
    }
    return {
        input: { type: input.type, version: input.version, props: cloneComponentProps(input.props) },
        style: normalizeObjectStyle(options, {}, pageSize, objectName),
    };
}
