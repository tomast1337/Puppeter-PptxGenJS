/**
 * HTML written as strings, escaped the way the HTML serializing algorithm does (the rules parse5, and so
 * jsdom, applies), so a string-built element has the bytes the same element serialized from a DOM has.
 */

const TEXT_ESCAPES = /[&<>\u00A0]/g;
const ATTRIBUTE_ESCAPES = /["&\u00A0]/g;
const ENTITIES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "\u00A0": "&nbsp;" };
const entity = (character: string) => ENTITIES[character] ?? character;

/** Text content of an element other than `<style>`, `<script>` and the other raw-text elements. */
export function escapeText(text: string): string {
    return text.replace(TEXT_ESCAPES, entity);
}

export function escapeAttribute(value: string): string {
    return value.replace(ATTRIBUTE_ESCAPES, entity);
}

/** One attribute; an `undefined` value leaves it out, so optional attributes keep their place in the list. */
export type Attribute = readonly [name: string, value: string | undefined];

/** The attributes in order, each with its leading space, as ` name="value"`. */
export function attributes(list: readonly Attribute[]): string {
    let html = "";
    for (const [name, value] of list) if (value !== undefined) html += ` ${name}="${escapeAttribute(value)}"`;
    return html;
}

/** An element with an end tag; `content` is markup, already escaped. SVG elements always take this form. */
export function element(tag: string, list: readonly Attribute[], content = ""): string {
    return `<${tag}${attributes(list)}>${content}</${tag}>`;
}

/** An HTML void element (`img`, `meta`, `br`, `col`): no end tag and no self-closing slash. */
export function voidElement(tag: string, list: readonly Attribute[]): string {
    return `<${tag}${attributes(list)}>`;
}
