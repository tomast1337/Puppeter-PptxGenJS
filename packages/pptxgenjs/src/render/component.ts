import type { DataUri } from "@pdflapas/model";
import type { DefaultTreeAdapterTypes } from "parse5";
import type { normalizeComponent } from "#src/components/normalize";
import type { ComponentDefinition } from "#src/components/types";
import { COMPONENT_DEFAULTS } from "#src/defaults";
import { type InlineStyle, styleAttribute } from "./css";
import { descendants, type FragmentElement, getAttribute, HTML_NAMESPACE, parseMarkup, removeAttribute, serialize, setAttribute } from "./fragment";
import { type Attribute, element, type Html } from "./markup";
import { applyObjectStyle } from "./style";

const REMOTE_URL = /^https?:\/\//i;

/** A rendered component: its host attributes and its parsed content, whose images resolve before it is written. */
export type RenderedComponent = {
    attributes: Attribute[];
    content: DefaultTreeAdapterTypes.DocumentFragment;
};

function images(content: DefaultTreeAdapterTypes.DocumentFragment): FragmentElement[] {
    return Array.from(descendants(content)).filter(node => node.tagName === "img" && node.namespaceURI === HTML_NAMESPACE);
}

/**
 * `idScope` is the object's position in the deck (`objectIdScope`), so ids the component derives from it are
 * unique and stable. `getDocument` is called only when the component reads `context.document`, so a component
 * that returns HTML text needs no DOM.
 */
export function renderComponent(component: ReturnType<typeof normalizeComponent>, definition: ComponentDefinition, idScope: string, getDocument: () => Document): RenderedComponent {
    const { input, style } = component;

    definition.validate?.(input.props);
    const context = {
        get document() {
            return getDocument();
        },
        width: style.geometry.width!,
        height: style.geometry.height!,
        idPrefix: idScope,
    };
    const result = definition.render(input.props, context);
    const css: InlineStyle = new Map();
    const objectAttributes = applyObjectStyle(css, style);

    // Explicit dimensions define the component viewport, independently of inner HTML sizing.
    css.set("position", "absolute");
    css.set("overflow", COMPONENT_DEFAULTS.overflow);
    const attributes: Attribute[] = [["class", "slide-element slide-component"], ["data-component-type", input.type], ["data-component-version", String(input.version)], ...objectAttributes, styleAttribute(css)];

    let markup: string;

    // Not `instanceof` for an element: browser documents from createHTMLDocument() have no defaultView to supply the
    // HTMLElement class.
    if (typeof result === "string") {
        markup = result;
    } else if ((result as Node | undefined)?.ownerDocument && result.ownerDocument === getDocument() && result.namespaceURI === HTML_NAMESPACE) {
        markup = result.outerHTML;
    } else {
        throw new Error("Component render must return HTML text or an HTMLElement from the supplied document");
    }

    // Parsed as the host's innerHTML, so the markup is normalized as a DOM would have it.
    const content = parseMarkup(markup, "div");

    for (const image of images(content)) {
        if (getAttribute(image, "srcset") !== undefined) {
            throw new Error("Component images do not support srcset; use a single src");
        }

        const source = getAttribute(image, "src");

        if (source && !source.startsWith("data:")) {
            setAttribute(image, REMOTE_URL.test(source) ? "data-source-url" : "data-source-path", source);
            removeAttribute(image, "src");
        }
    }

    return { attributes, content };
}

/** The image source a component still has to resolve: `data-source-path`, then `data-source-url`; "none" when empty. */
function pendingSource(image: FragmentElement): { kind: "pending"; source: string } | { kind: "none" } {
    const source = getAttribute(image, "data-source-path") ?? getAttribute(image, "data-source-url");

    return source ? { kind: "pending", source } : { kind: "none" };
}

export function componentImageSources(component: RenderedComponent): string[] {
    const sources: string[] = [];

    for (const image of images(component.content)) {
        const pending = pendingSource(image);

        if (pending.kind === "pending") {
            sources.push(pending.source);
        }
    }

    return sources;
}

/** The host with its content; `resolved` maps image sources to data URIs, which replace them as `src`. */
export function componentHtml(component: RenderedComponent, resolved?: ReadonlyMap<string, DataUri>): Html {
    for (const image of images(component.content)) {
        const pending = pendingSource(image);
        const data = pending.kind === "pending" && resolved?.get(pending.source);

        if (!data) {
            continue;
        }

        setAttribute(image, "src", data);
        removeAttribute(image, "data-source-path");
        removeAttribute(image, "data-source-url");
    }

    return element("div", component.attributes, serialize(component.content));
}
