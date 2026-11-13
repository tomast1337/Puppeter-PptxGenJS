/**
 * Caller markup (chart SVG, component HTML) parsed and serialized with parse5, the parser and serializer
 * jsdom uses, so the bytes are the ones jsdom's `innerHTML` and `outerHTML` gave, without a DOM.
 */
import { type DefaultTreeAdapterTypes, defaultTreeAdapter, html, parseFragment } from "parse5";

/** `serializeOuter` is `outerHTML` of a parsed element, `serialize` the `innerHTML` of a fragment. */
export { serialize, serializeOuter } from "parse5";

export type FragmentElement = DefaultTreeAdapterTypes.Element;
type FragmentParent = DefaultTreeAdapterTypes.ParentNode;

export const HTML_NAMESPACE = html.NS.HTML;
export const SVG_NAMESPACE = html.NS.SVG;

/**
 * Parses `markup` as `innerHTML` does: as the content of a `<div>`, or, without one, of a `<template>`
 * (what parse5 and jsdom's `template.innerHTML` use).
 */
export function parseMarkup(markup: string, context?: "div"): DefaultTreeAdapterTypes.DocumentFragment {
    return context ? parseFragment(defaultTreeAdapter.createElement(context, html.NS.HTML, []), markup, {}) : parseFragment(markup);
}

function isElement(node: DefaultTreeAdapterTypes.ChildNode): node is FragmentElement {
    return "tagName" in node;
}

export function firstElementChild(parent: FragmentParent): FragmentElement | undefined {
    return parent.childNodes.find(isElement);
}

/** Every element below `parent`, in tree order (`querySelectorAll("*")`). */
export function* descendants(parent: FragmentParent): Generator<FragmentElement> {
    for (const child of parent.childNodes) {
        if (!isElement(child)) continue;
        yield child;
        yield* descendants(child);
    }
}

/** The attribute's name as the DOM's `Attr.name` gives it, with its prefix (`xlink:href`). */
export function attributeName(attribute: FragmentElement["attrs"][number]): string {
    return attribute.prefix ? `${attribute.prefix}:${attribute.name}` : attribute.name;
}

export function getAttribute(element: FragmentElement, name: string): string | undefined {
    return element.attrs.find(attribute => attributeName(attribute) === name)?.value;
}

/** As `Element.setAttribute`: an existing attribute keeps its place, a new one goes last. */
export function setAttribute(element: FragmentElement, name: string, value: string): void {
    const existing = element.attrs.find(attribute => attributeName(attribute) === name);
    if (existing) existing.value = value;
    else element.attrs.push({ name, value });
}

export function removeAttribute(element: FragmentElement, name: string): void {
    element.attrs = element.attrs.filter(attribute => attributeName(attribute) !== name);
}
