import type { z } from "zod";

export type ComponentValue = null | boolean | number | string | ComponentValue[] | { [key: string]: ComponentValue };
export type ComponentProps = { [key: string]: ComponentValue };

/** Names and versions are application-owned contracts, independent of document schema versions. */
export interface ComponentInput {
    type: string;
    version: number;
    props: ComponentProps;
}

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
