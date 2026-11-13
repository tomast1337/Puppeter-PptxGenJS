import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { z } from "zod";
import { type ComponentDefinition, type ComponentProps, parseComponentProps } from "@pdfdeck/pptxgenjs/html";

/** Structural interface keeps the optional adapter independent of the renderer runtime. */
export interface ReactComponentRegistrar {
    registerComponent(type: string, version: number, definition: ComponentDefinition): unknown;
}

export type ReactComponentOptions<Props extends object> = { schema: z.ZodType<Props>; parseProps?: never } | { schema?: never; parseProps?: (props: ComponentProps) => Props };

/** Register a synchronous React-to-HTML renderer. React code never enters the saved document. */
export function registerReactComponent<Props extends object, Presentation extends ReactComponentRegistrar>(presentation: Presentation, type: string, version: number, component: ComponentType<Props>, options: ReactComponentOptions<NoInfer<Props>> = {}): Presentation {
    const { schema, parseProps } = options;
    if (schema && parseProps) throw new Error("Choose a component schema or parseProps, not both");
    presentation.registerComponent(type, version, {
        render: (savedProps, context) => {
            const props = schema ? parseComponentProps(schema, savedProps) : parseProps ? parseProps(savedProps) : (savedProps as unknown as Props);
            // The object's position gives each static React tree its own useId namespace, the same on every render.
            return renderToStaticMarkup(createElement(component, props), { identifierPrefix: `pptx-react-${context.idPrefix}-` });
        },
    });
    return presentation;
}
