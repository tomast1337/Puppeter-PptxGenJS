/**
 * Completes a hand-written or edited pdfdeck HTML profile document (docs/HTML_PROFILE.md, version 1): fills
 * the values the profile requires that PptxGenJS defines a default for, so both renderers read the same
 * values a PptxGenJS deck would have. The WASM reader has no PptxGenJS rules (#69); the defaults live here.
 *
 * Pure and browser-safe: parse5 finds what is missing, and each missing value is spliced into the original
 * string, so a document that already states everything (every `toHtml()` result) comes back byte-identical.
 */
import { type DefaultTreeAdapterTypes, parse } from "parse5";
import { PPTX_DEFAULTS } from "../defaults";
import { normalizeColor } from "../normalize/style";
import { lineBoxOf } from "../normalize/text";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "../pageLayouts";
import { inchesToPixels, pointsToPixels } from "../units";
import { attributeName, getAttribute } from "./fragment";
import { escapeAttribute } from "./markup";
import { HTML_PROFILE_VERSION, presentationCSS } from "./slide";
import { HIDDEN_BORDER_CSS } from "./table";
import { alignItemsCSS, fontFamilyCSS } from "./text";

type Node = DefaultTreeAdapterTypes.ChildNode | DefaultTreeAdapterTypes.ParentNode;
type Parent = DefaultTreeAdapterTypes.ParentNode;
type Element = DefaultTreeAdapterTypes.Element;
type Pairs = readonly (readonly [name: string, value: string])[];

/** What an element may leave out, with the value PptxGenJS would give it. */
interface Defaults {
    readonly css: Pairs;
    readonly attributes: Pairs;
}

const px = (value: number) => `${value}px`;
const padding = (margin: readonly number[]) => margin.map(inches => px(inchesToPixels(inches))).join(" ");
// Both text boxes and table cells wrap (PPTX_DEFAULTS.text.wrap) and fit "none", horizontally.
const textBox = (margin: readonly number[], verticalAlign: "top" | "middle"): Defaults => ({
    css: [
        ["padding", padding(margin)],
        ["align-items", alignItemsCSS(verticalAlign)],
        ["white-space", "pre-wrap"],
        ["overflow-wrap", "break-word"],
    ],
    attributes: [
        ["data-text-fit", PPTX_DEFAULTS.text.fit],
        ["data-text-direction", "horizontal"],
    ],
});
const run = (fontSizePt: number, color: string): Defaults => ({
    css: [
        ["font-family", fontFamilyCSS(PPTX_DEFAULTS.text.fontFace)],
        ["font-size", px(pointsToPixels(fontSizePt))],
        ["color", normalizeColor(color)],
        ["font-weight", "normal"],
        ["font-style", "normal"],
    ],
    attributes: [],
});

const DEFAULTS = {
    slide: { css: [["background-color", normalizeColor(PPTX_DEFAULTS.slide.backgroundColor)]], attributes: [] },
    text: textBox(PPTX_DEFAULTS.text.marginIn, PPTX_DEFAULTS.text.valign),
    cellText: textBox(PPTX_DEFAULTS.table.marginIn, PPTX_DEFAULTS.table.valign),
    // The line box is not here: it depends on the runs (completeParagraph).
    paragraph: {
        css: [
            ["text-align", PPTX_DEFAULTS.text.align],
            ["direction", "ltr"],
            ["margin-top", "0px"],
            ["margin-bottom", "0px"],
            ["tab-size", px(inchesToPixels(PPTX_DEFAULTS.text.defaultTabStopIn))],
        ],
        attributes: [],
    },
    run: run(PPTX_DEFAULTS.text.fontSizePt, PPTX_DEFAULTS.text.color),
    link: run(PPTX_DEFAULTS.text.fontSizePt, PPTX_DEFAULTS.theme.colors.hyperlink),
    cellRun: run(PPTX_DEFAULTS.table.fontSizePt, PPTX_DEFAULTS.table.color),
    cellLink: run(PPTX_DEFAULTS.table.fontSizePt, PPTX_DEFAULTS.theme.colors.hyperlink),
    cell: {
        css: [
            ["border-top", HIDDEN_BORDER_CSS],
            ["border-right", HIDDEN_BORDER_CSS],
            ["border-bottom", HIDDEN_BORDER_CSS],
            ["border-left", HIDDEN_BORDER_CSS],
        ],
        attributes: [
            ["colspan", "1"],
            ["rowspan", "1"],
        ],
    },
    // No `sizing` option is a stretch (normalize/image.ts).
    image: { css: [["opacity", String(1 - PPTX_DEFAULTS.image.transparency / 100)]], attributes: [["data-image-sizing", "stretch"]] },
} as const satisfies Record<string, Defaults>;

/** Subtrees the profile treats as opaque: their markup is the chart's or the component's own. */
const OPAQUE_CLASSES = ["slide-chart", "slide-component"] as const;
const PROFILE_META = `<meta name="pdfdeck-profile" content="${HTML_PROFILE_VERSION}">`;
const PX_LENGTH = /^-?\d+(\.\d+)?(e[+-]?\d+)?px$/i;

interface Edit {
    start: number;
    end: number;
    text: string;
}

function isElement(node: Node): node is Element {
    return "tagName" in node;
}

function hasClass(element: Element, name: string): boolean {
    return (getAttribute(element, "class") ?? "").split(/\s+/).includes(name);
}

/** Inline CSS declarations by property, split on `;` outside quotes and parentheses. */
function declarations(style: string): Map<string, string> {
    const out = new Map<string, string>();
    let quote = "";
    let depth = 0;
    let start = 0;
    for (let index = 0; index <= style.length; index++) {
        const character = style[index];
        if (quote) {
            if (character === "\\") index++;
            else if (character === quote) quote = "";
        } else if (character === '"' || character === "'") quote = character;
        else if (character === "(") depth++;
        else if (character === ")") depth--;
        else if (character === undefined || (character === ";" && depth === 0)) {
            const declaration = style.slice(start, index);
            const colon = declaration.indexOf(":");
            if (colon > 0) out.set(declaration.slice(0, colon).trim().toLowerCase(), declaration.slice(colon + 1).trim());
            start = index + 1;
        }
    }
    return out;
}

function styleOf(element: Element): Map<string, string> {
    return declarations(getAttribute(element, "style") ?? "");
}

/** `<n>px` as a number, or an error naming the property. */
function pxValue(value: string, property: string, where: string): number {
    if (!PX_LENGTH.test(value)) throw new Error(`invalid pdfdeck HTML: ${where}: CSS property '${property}': '${value}' is not a px length; write it in px or leave it out to get the default`);
    return Number.parseFloat(value);
}

/** One edit that adds `css` to the element's style and `attributes` to its start tag; none when both are empty. */
function addToElement(element: Element, css: Pairs, attributes: Pairs): Edit | undefined {
    if (!css.length && !attributes.length) return undefined;
    const tag = element.sourceCodeLocation?.startTag;
    // Only elements the parser invented (an implied <tbody>) have no location; the profile never needs to edit one.
    if (!tag) throw new Error(`invalid pdfdeck HTML: <${element.tagName}> must be written out in the document to be completed`);
    const added = css.map(([property, value]) => `${property}: ${value};`).join(" ");
    const styleAt = element.sourceCodeLocation?.attrs?.style;
    const newAttributes = attributes.map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join("");
    if (styleAt && css.length) {
        const style = (getAttribute(element, "style") ?? "").trim();
        const joined = style ? `${style}${style.endsWith(";") ? "" : ";"} ${added}` : added;
        return { start: styleAt.startOffset, end: styleAt.endOffset, text: `style="${escapeAttribute(joined)}"${newAttributes}` };
    }
    const insert = `${css.length ? ` style="${escapeAttribute(added)}"` : ""}${newAttributes}`;
    // Right after the tag name, so a self-closed `<img … />` stays well formed.
    const at = tag.startOffset + 1 + element.tagName.length;
    return { start: at, end: at, text: insert };
}

function missing(element: Element, defaults: Defaults): Edit | undefined {
    const style = styleOf(element);
    const has = new Set(element.attrs.map(attributeName));
    return addToElement(
        element,
        defaults.css.filter(([property]) => !style.has(property)),
        defaults.attributes.filter(([name]) => !has.has(name)),
    );
}

function where(slide: number, element: Element): string {
    let object = element;
    for (let node: Element | undefined = element; node; node = node.parentNode && isElement(node.parentNode) ? node.parentNode : undefined) {
        if (hasClass(node, "slide-element")) object = node;
    }
    const name = getAttribute(object, "data-object-name");
    return `slide ${slide}${name !== undefined ? `: object '${name}'` : ""}`;
}

/** The line box from the paragraph's largest run, as normalization computes it (`paragraphLineBox`). */
function completeParagraph(paragraph: Element, inCell: boolean, slide: number): Edit | undefined {
    const style = styleOf(paragraph);
    const defaultSize = pointsToPixels(inCell ? PPTX_DEFAULTS.table.fontSizePt : PPTX_DEFAULTS.text.fontSizePt);
    const sizes = paragraph.childNodes.filter(isElement).flatMap(child => {
        if (!hasClass(child, "text-run")) return [];
        const size = styleOf(child).get("font-size");
        return [size === undefined ? defaultSize : pxValue(size, "font-size", where(slide, child))];
    });
    const fontSize = Math.max(...sizes, 0) || defaultSize;
    const lineHeight = style.get("line-height");
    const lineBox = lineBoxOf(fontSize, lineHeight === undefined ? undefined : pxValue(lineHeight, "line-height", where(slide, paragraph)));
    const has = getAttribute(paragraph, "data-line-baseline") !== undefined;
    return addToElement(paragraph, [...DEFAULTS.paragraph.css.filter(([property]) => !style.has(property)), ...(lineHeight === undefined ? [["line-height", px(lineBox.height)] as const] : [])], has ? [] : [["data-line-baseline", String(lineBox.baseline)]]);
}

function collectEdits(node: Parent, inCell: boolean, slide: number, edits: Edit[]): void {
    for (const child of node.childNodes) {
        if (!isElement(child)) continue;
        if (OPAQUE_CLASSES.some(name => hasClass(child, name))) continue;
        const cell = inCell || hasClass(child, "table-cell-text");
        const edit = completeElement(child, cell, slide);
        if (edit) edits.push(edit);
        collectEdits(child, cell, slide, edits);
    }
}

function completeElement(element: Element, inCell: boolean, slide: number): Edit | undefined {
    const linked = element.tagName === "a";
    if (hasClass(element, "slide-container")) return missing(element, DEFAULTS.slide);
    if (hasClass(element, "slide-text")) return missing(element, DEFAULTS.text);
    if (hasClass(element, "table-cell-text")) return missing(element, DEFAULTS.cellText);
    if (hasClass(element, "text-paragraph")) return completeParagraph(element, inCell, slide);
    if (hasClass(element, "text-run")) return missing(element, inCell ? (linked ? DEFAULTS.cellLink : DEFAULTS.cellRun) : linked ? DEFAULTS.link : DEFAULTS.run);
    if (hasClass(element, "slide-image-content")) return missing(element, DEFAULTS.image);
    if (element.tagName === "td") return missing(element, DEFAULTS.cell);
    return undefined;
}

function findElement(node: Parent, test: (element: Element) => boolean): Element | undefined {
    for (const child of node.childNodes) {
        if (!isElement(child)) continue;
        if (test(child)) return child;
        const found = findElement(child, test);
        if (found) return found;
    }
    return undefined;
}

function metaContent(head: Element, name: string): string | undefined {
    const meta = head.childNodes.find(node => isElement(node) && node.tagName === "meta" && getAttribute(node, "name") === name);
    return meta && isElement(meta) ? getAttribute(meta, "content") : undefined;
}

function pageSizeNamed(name: string) {
    return Object.values(PAGE_SIZES)
        .flatMap(layout => [layout.landscape, layout.portrait])
        .find(size => size.name === name);
}

/** The shared stylesheet, when no `<style>` states the page size: from `pdfdeck-page-size`, else PptxGenJS's LAYOUT_16x9. */
function stylesheetEdit(head: Element): Edit | undefined {
    const styled = head.childNodes.some(node => isElement(node) && node.tagName === "style" && node.childNodes.some(text => "value" in text && text.value.includes("@page")));
    if (styled) return undefined;
    const name = metaContent(head, "pdfdeck-page-size");
    const pageSize = name === undefined ? DEFAULT_PAGE_SIZE : pageSizeNamed(name);
    if (!pageSize) {
        const known = Object.values(PAGE_SIZES).flatMap(layout => [layout.landscape.name, layout.portrait.name]);
        throw new Error(`invalid pdfdeck HTML: page size '${name}' is not a known size (${known.join(", ")}); name one of them in <meta name="pdfdeck-page-size">, or add a <style> with '@page { size: <width>in <height>in }'`);
    }
    const end = head.sourceCodeLocation?.endTag?.startOffset;
    if (end === undefined) throw new Error("invalid pdfdeck HTML: the document must write out <head>…</head> to receive the stylesheet");
    return { start: end, end, text: `<style id="puppeteer-gen-styles">${presentationCSS(pageSize)}</style>` };
}

/**
 * Fills the values a profile v1 document may omit (docs/HTML_PROFILE.md, "Completion"). Throws when `html` is
 * not a profile document: empty, without `<meta name="pdfdeck-profile" content="1">`, or of another version.
 * A complete document, such as any `toHtml()` result, is returned unchanged, byte for byte.
 */
export function completeProfileHtml(html: string): string {
    if (typeof html !== "string" || !html.trim()) throw new Error(`invalid pdfdeck HTML: expected a non-empty HTML string, got ${typeof html === "string" ? "an empty string" : typeof html}`);
    const document = parse(html, { sourceCodeLocationInfo: true });
    const head = findElement(document, element => element.tagName === "head");
    const version = head && metaContent(head, "pdfdeck-profile");
    if (!head || version === undefined) {
        throw new Error(`invalid pdfdeck HTML: not a pdfdeck profile document: add ${PROFILE_META} to <head>. Puppeteer prints any HTML through renderer.render({ html, pageSize }).`);
    }
    if (version !== String(HTML_PROFILE_VERSION)) throw new Error(`invalid pdfdeck HTML: pdfdeck profile version '${version}' is not supported (this library reads version ${HTML_PROFILE_VERSION})`);

    const edits: Edit[] = [];
    const stylesheet = stylesheetEdit(head);
    if (stylesheet) edits.push(stylesheet);
    const body = findElement(document, element => element.tagName === "body");
    body?.childNodes.filter(isElement).forEach((slide, index) => {
        const edit = completeElement(slide, false, index + 1);
        if (edit) edits.push(edit);
        collectEdits(slide, false, index + 1, edits);
    });
    // Later offsets first, so earlier ones stay valid.
    let completed = html;
    for (const edit of edits.toSorted((a, b) => b.start - a.start)) completed = `${completed.slice(0, edit.start)}${edit.text}${completed.slice(edit.end)}`;
    // Standards mode: quirks mode drops the line-box strut (render/document.ts).
    return document.childNodes.some(node => node.nodeName === "#documentType") ? completed : `<!DOCTYPE html>${completed}`;
}
