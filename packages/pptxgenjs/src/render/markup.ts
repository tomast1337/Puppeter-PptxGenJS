/**
 * HTML written as strings, escaped the way the HTML serializing algorithm does (the rules parse5, and so
 * jsdom, applies), so a string-built element has the bytes the same element serialized from a DOM has.
 */

const TEXT_ESCAPES = /[&<>\u00A0]/g;
const ATTRIBUTE_ESCAPES = /["&\u00A0]/g;
const ENTITIES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "\u00A0": "&nbsp;" };
const entity = (character: string) => ENTITIES[character] ?? character;

declare const escaped: unique symbol;
/**
 * Markup that is already escaped or serialized, safe to write as is. Only the functions of this file and the
 * parse5 serializers (`fragment.ts`) make one, so a plain string cannot reach markup unescaped.
 */
export type Html = string & { readonly [escaped]: true };

/** Text content of an element other than `<style>`, `<script>` and the other raw-text elements. */
export function escapeText(text: string): Html {
    return text.replace(TEXT_ESCAPES, entity) as Html;
}

export function escapeAttribute(value: string): string {
    return value.replace(ATTRIBUTE_ESCAPES, entity);
}

/** One attribute; an `undefined` value leaves it out, so optional attributes keep their place in the list. */
export type Attribute = readonly [name: string, value: string | undefined];

/** The attributes in order, each with its leading space, as ` name="value"`. */
function attributes(list: readonly Attribute[]): string {
    let html = "";
    for (const [name, value] of list) if (value !== undefined) html += ` ${name}="${escapeAttribute(value)}"`;
    return html;
}

/** An element with an end tag; `content` is markup, written in order. SVG elements always take this form. */
export function element(tag: string, list: readonly Attribute[], content: Html | readonly Html[] = []): Html {
    return `<${tag}${attributes(list)}>${typeof content === "string" ? content : content.join("")}</${tag}>` as Html;
}

/** An HTML void element (`img`, `meta`, `br`, `col`): no end tag and no self-closing slash. */
export function voidElement(tag: string, list: readonly Attribute[]): Html {
    return `<${tag}${attributes(list)}>` as Html;
}

/** A raw-text element (`<style>`): its text is written unescaped, so it must not hold its own end tag. */
export function rawTextElement(tag: "style", list: readonly Attribute[], text: string): Html {
    if (text.toLowerCase().includes(`</${tag}`)) throw new Error(`<${tag}> text must not contain "</${tag}": it would end the element early`);
    return `<${tag}${attributes(list)}>${text}</${tag}>` as Html;
}
