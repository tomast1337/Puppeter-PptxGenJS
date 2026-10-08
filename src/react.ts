import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentDefinition, ComponentProps } from "./components/types";

/** Structural interface keeps the optional adapter independent of the renderer runtime. */
export interface ReactComponentRegistrar {
    registerComponent(type: string, version: number, definition: ComponentDefinition): unknown;
}

export interface ReactComponentOptions<Props extends object> {
    /** Validate/convert saved JSON props. Throw to reject invalid application data. */
    parseProps?: (props: ComponentProps) => Props;
}

const renderCounts = new WeakMap<object, number>();

/** Register a synchronous React-to-HTML renderer. React code never enters the saved document. */
export function registerReactComponent<Props extends object, Presentation extends ReactComponentRegistrar>(
    presentation: Presentation,
    type: string,
    version: number,
    component: ComponentType<Props>,
    options: ReactComponentOptions<NoInfer<Props>> = {},
): Presentation {
    const parseProps = options.parseProps;
    presentation.registerComponent(type, version, {
        render: savedProps => {
            const props = parseProps ? parseProps(savedProps) : (savedProps as unknown as Props);
            const index = renderCounts.get(presentation) ?? 0;
            renderCounts.set(presentation, index + 1);
            // Each static React tree gets a distinct useId namespace within the presentation.
            return renderToStaticMarkup(createElement(component, props), { identifierPrefix: `pptx-react-${index}-` });
        },
    });
    return presentation;
}
