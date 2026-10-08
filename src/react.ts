import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { z } from "zod";
import { parseComponentProps } from "./components/schema";
import type { ComponentDefinition, ComponentProps } from "./components/types";

/** Structural interface keeps the optional adapter independent of the renderer runtime. */
export interface ReactComponentRegistrar {
    registerComponent(type: string, version: number, definition: ComponentDefinition): unknown;
}

export type ReactComponentOptions<Props extends object> =
    | { schema: z.ZodType<Props>; parseProps?: never }
    | { schema?: never; parseProps?: (props: ComponentProps) => Props };

const renderCounts = new WeakMap<object, number>();

/** Register a synchronous React-to-HTML renderer. React code never enters the saved document. */
export function registerReactComponent<Props extends object, Presentation extends ReactComponentRegistrar>(
    presentation: Presentation,
    type: string,
    version: number,
    component: ComponentType<Props>,
    options: ReactComponentOptions<NoInfer<Props>> = {},
): Presentation {
    const { schema, parseProps } = options;
    if (schema && parseProps) throw new Error("Choose a component schema or parseProps, not both");
    presentation.registerComponent(type, version, {
        render: savedProps => {
            const props = schema ? parseComponentProps(schema, savedProps) : parseProps ? parseProps(savedProps) : (savedProps as unknown as Props);
            const index = renderCounts.get(presentation) ?? 0;
            renderCounts.set(presentation, index + 1);
            // Each static React tree gets a distinct useId namespace within the presentation.
            return renderToStaticMarkup(createElement(component, props), { identifierPrefix: `pptx-react-${index}-` });
        },
    });
    return presentation;
}
