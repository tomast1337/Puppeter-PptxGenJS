import type { normalizeComponent } from "../components/normalize";
import type { ComponentDefinition } from "../components/types";
import { COMPONENT_DEFAULTS } from "../defaults";
import { applyObjectStyle } from "./style";

/** `idScope` is the object's position in the deck (`objectIdScope`), so ids the component derives from it are unique and stable. */
export function renderComponent(document: Document, component: ReturnType<typeof normalizeComponent>, definition: ComponentDefinition, idScope: string): HTMLElement {
    const { input, style } = component;
    definition.validate?.(input.props);
    const content = definition.render(input.props, { document, width: style.geometry.width!, height: style.geometry.height!, idPrefix: idScope });
    const host = document.createElement("div");
    host.className = "slide-element slide-component";
    host.dataset.componentType = input.type;
    host.dataset.componentVersion = String(input.version);
    applyObjectStyle(host, style);
    // Explicit dimensions define the component viewport, independently of inner HTML sizing.
    host.style.position = "absolute";
    host.style.overflow = COMPONENT_DEFAULTS.overflow;
    if (typeof content === "string") host.innerHTML = content;
    // Not `instanceof`: browser documents from createHTMLDocument() have no defaultView to supply the HTMLElement class.
    else if ((content as Node | undefined)?.ownerDocument === document && (content as Element).namespaceURI === "http://www.w3.org/1999/xhtml") host.appendChild(content.cloneNode(true));
    else throw new Error("Component render must return HTML text or an HTMLElement from the supplied document");
    for (const image of host.querySelectorAll("img")) {
        if (image.hasAttribute("srcset")) throw new Error("Component images do not support srcset; use a single src");
        const source = image.getAttribute("src");
        if (source && !source.startsWith("data:")) {
            if (/^https?:\/\//i.test(source)) image.dataset.sourceUrl = source;
            else image.dataset.sourcePath = source;
            image.removeAttribute("src");
        }
    }
    return host;
}
