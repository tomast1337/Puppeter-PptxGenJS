// The parsed profile document: parse5's tree, read once per render, and the few walks the renderer needs.
import { type DefaultTreeAdapterMap, parse } from "parse5";

export type Element = DefaultTreeAdapterMap["element"];
type ChildNode = DefaultTreeAdapterMap["childNode"];

export function parseDocument(html: string): Element[] {
    return children(parse(html) as unknown as Element); // `as`: a parse5 document has childNodes like an element; only they are read
}

export function isElement(node: ChildNode): node is Element {
    return "tagName" in node;
}

export function children(element: Element): Element[] {
    return element.childNodes.filter(isElement);
}

// eslint-disable-next-line pdflapas/no-nullable-return -- phase 2 (#425)
export function attribute(element: Element, name: string): string | undefined {
    return element.attrs.find(attr => attr.name === name)?.value;
}

export function hasClass(element: Element, name: string): boolean {
    return attribute(element, "class")?.split(/\s+/).includes(name) ?? false;
}

/** Every element below `roots` in document order, depth first. */
export function* descendants(roots: readonly Element[]): Generator<Element> {
    for (const root of roots) {
        yield root;
        yield* descendants(children(root));
    }
}

/** The concatenated text of `element`'s text nodes, its descendants' included. */
export function textContent(element: Element): string {
    return element.childNodes.map(node => (isElement(node) ? textContent(node) : "value" in node ? node.value : "")).join("");
}
