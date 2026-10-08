import type { normalizeComponent } from "../components/normalize";
import type { ComponentDefinition } from "../components/types";
import { COMPONENT_DEFAULTS } from "../defaults";
import { applyObjectStyle } from "./style";

export function renderComponent(document: Document, component: ReturnType<typeof normalizeComponent>, definition: ComponentDefinition): HTMLElement {
    const { input, style } = component;
    definition.validate?.(input.props);
    const content = definition.render(input.props, { document, width: style.geometry.width!, height: style.geometry.height! });
    const host = document.createElement("div");
    host.className = "slide-element slide-component";
    host.dataset.componentType = input.type;
    host.dataset.componentVersion = String(input.version);
    applyObjectStyle(host, style);
    // Explicit dimensions define the component viewport, independently of inner HTML sizing.
    host.style.position = "absolute";
    host.style.overflow = COMPONENT_DEFAULTS.overflow;
    if (typeof content === "string") host.innerHTML = content;
    else if (document.defaultView && content instanceof document.defaultView.HTMLElement) host.appendChild(content.cloneNode(true));
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
