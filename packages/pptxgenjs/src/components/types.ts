import type { ComponentProps } from "@pdfdeck/model";
import type { z } from "zod";

// The saved wire types are part of the model contract.
export type { ComponentInput, ComponentProps, ComponentValue } from "@pdfdeck/model";

/** Geometry is explicit, in inches. HTML inside this box owns its own layout. */
export interface ComponentOptions {
    x: number;
    y: number;
    w: number;
    h: number;
    objectName?: string;
}
export interface ComponentContext {
    document: Document;
    width: number;
    height: number;
}
export interface ComponentDefinition<Props extends object = ComponentProps> {
    /** Zod supplies runtime validation/defaults and infers render props. Saved input remains unchanged. */
    schema?: z.ZodType<Props>;
    /** Throw for invalid application-specific props. Called before rendering. */
    validate?: (props: NoInfer<Props>) => void;
    /** Synchronous trusted application code; return HTML markup or a detached HTML element. */
    render: (props: NoInfer<Props>, context: ComponentContext) => string | HTMLElement;
}
