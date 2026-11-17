/**
 * Completes a hand-written or edited PdfLapas HTML profile document (docs/HTML_PROFILE.md, version 1): fills
 * the values the profile requires that PptxGenJS defines a default for, so both renderers read the same
 * values a PptxGenJS deck would have. The WASM reader has no PptxGenJS rules (#69); the defaults live here.
 *
 * Pure and browser-safe: parse5 finds what is missing, and each missing value is spliced into the original
 * string, so a document that already states everything (every `toHtml()` result) comes back byte-identical.
 */
import { applySourceEdits, type HtmlPresentationDocument, htmlDocument, profileMetaPrefix, type SourceEdit } from "@pdflapas/model";
import { type DefaultTreeAdapterTypes, parse } from "parse5";
import { PPTX_DEFAULTS } from "#src/defaults";
import { normalizeColor } from "#src/normalize/style";
import { lineBoxOf } from "#src/normalize/text";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "#src/pageLayouts";
import { inchesToPixels, pointsToPixels } from "#src/units";
import { attributeName, getAttribute } from "./fragment";
import { escapeAttribute } from "./markup";
import { presentationCSS } from "./slide";
import { HIDDEN_BORDER_CSS } from "./table";
import { alignItemsCSS, fontFamilyCSS, shrinkAttributes } from "./text";

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
const PX_LENGTH = /^-?\d+(\.\d+)?(e[+-]?\d+)?px$/i;

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
    if (!PX_LENGTH.test(value)) throw new Error(`invalid PdfLapas HTML: ${where}: CSS property '${property}': '${value}' is not a px length; write it in px or leave it out to get the default`);
    return Number.parseFloat(value);
}

/** One edit that adds `css` to the element's style and `attributes` to its start tag; none when both are empty. */
function addToElement(element: Element, css: Pairs, attributes: Pairs): SourceEdit | undefined {
    if (!css.length && !attributes.length) return undefined;
    const tag = element.sourceCodeLocation?.startTag;
    // Only elements the parser invented (an implied <tbody>) have no location; the profile never needs to edit one.
    if (!tag) throw new Error(`invalid PdfLapas HTML: <${element.tagName}> must be written out in the document to be completed`);
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

function missing(element: Element, defaults: Defaults): SourceEdit | undefined {
    const style = styleOf(element);
    const has = new Set(element.attrs.map(attributeName));
    return addToElement(
        element,
        defaults.css.filter(([property]) => !style.has(property)),
        defaults.attributes.filter(([name]) => !has.has(name)),
    );
}

/** A shrink box also needs the shrink rule (`shrinkAttributes`). */
function withShrink(element: Element, defaults: Defaults): Defaults {
    if (getAttribute(element, "data-text-fit") !== "shrink") return defaults;
    return { ...defaults, attributes: [...defaults.attributes, ...shrinkAttributes()] };
}

function where(slide: number, element: Element): string {
    let object = element;
    for (let node: Element | undefined = element; node; node = node.parentNode && isElement(node.parentNode) ? node.parentNode : undefined) {
        if (hasClass(node, "slide-element")) object = node;
    }
    const name = getAttribute(object, "data-object-name");
    return `slide ${slide}${name !== undefined ? `: object '${name}'` : ""}`;
}

/** Where text sits, which picks its defaults: a slide's text box or a table cell. */
type TextContext = "slide" | "cell";

/** The line box from the paragraph's largest run, as normalization computes it (`paragraphLineBox`). */
function completeParagraph(paragraph: Element, context: TextContext, slide: number): SourceEdit | undefined {
    const style = styleOf(paragraph);
    const defaultSize = pointsToPixels(context === "cell" ? PPTX_DEFAULTS.table.fontSizePt : PPTX_DEFAULTS.text.fontSizePt);
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

function collectEdits(node: Parent, context: TextContext, slide: number, edits: SourceEdit[]): void {
    for (const child of node.childNodes) {
        if (!isElement(child)) continue;
        if (OPAQUE_CLASSES.some(name => hasClass(child, name))) continue;
        const childContext = hasClass(child, "table-cell-text") ? "cell" : context;
        const edit = completeElement(child, childContext, slide);
        if (edit) edits.push(edit);
        collectEdits(child, childContext, slide, edits);
    }
}

function completeElement(element: Element, context: TextContext, slide: number): SourceEdit | undefined {
    const linked = element.tagName === "a";
    if (hasClass(element, "slide-container")) return missing(element, DEFAULTS.slide);
    if (hasClass(element, "slide-text")) return missing(element, withShrink(element, DEFAULTS.text));
    if (hasClass(element, "table-cell-text")) return missing(element, withShrink(element, DEFAULTS.cellText));
    if (hasClass(element, "text-paragraph")) return completeParagraph(element, context, slide);
    if (hasClass(element, "text-run")) return missing(element, context === "cell" ? (linked ? DEFAULTS.cellLink : DEFAULTS.cellRun) : linked ? DEFAULTS.link : DEFAULTS.run);
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

/**
 * The shared stylesheet when no `<style>` has an `@page` rule: for the size `<prefix>page-size` names, else
 * PptxGenJS's LAYOUT_16x9, whose name it also writes so `htmlDocument` reads the whole page size.
 */
function stylesheet(head: Element, prefix: string): SourceEdit | undefined {
    const name = metaContent(head, `${prefix}page-size`);
    const styles = head.childNodes.filter(isElement).filter(node => node.tagName === "style");
    if (styles.some(style => style.childNodes.some(text => "value" in text && text.value.includes("@page")))) return undefined;
    const pageSize = name === undefined ? DEFAULT_PAGE_SIZE : pageSizeNamed(name);
    if (!pageSize) {
        const known = Object.values(PAGE_SIZES).flatMap(layout => [layout.landscape.name, layout.portrait.name]);
        throw new Error(`invalid PdfLapas HTML: page size '${name}' is not a known size (${known.join(", ")}); name one of them in <meta name="${prefix}page-size">, or add a <style> with '@page { size: <width>in <height>in }'`);
    }
    const end = head.sourceCodeLocation?.endTag?.startOffset;
    if (end === undefined) throw new Error("invalid PdfLapas HTML: the document must write out <head>…</head> to receive the stylesheet");
    const meta = name === undefined ? `<meta name="${prefix}page-size" content="${escapeAttribute(pageSize.name)}">` : "";
    return { start: end, end, text: `${meta}<style id="puppeteer-gen-styles">${presentationCSS(pageSize)}</style>` };
}

/**
 * Fills the values a profile document (version 1 or 2) may omit (docs/HTML_PROFILE.md, "Completion") with PptxGenJS's
 * defaults. Throws when `html` is not a profile document: empty, without
 * `<meta name="pdflapas-profile" content="2">` (or `<meta name="pdfdeck-profile" content="1">`), or of another
 * version. A complete document, such as any `toHtml()` result, is returned unchanged, byte for byte.
 */
export function completeProfileHtml(html: string): string {
    if (typeof html !== "string" || !html.trim()) throw new Error(`invalid PdfLapas HTML: expected a non-empty HTML string, got ${typeof html === "string" ? "an empty string" : typeof html}`);
    const document = parse(html, { sourceCodeLocationInfo: true });
    const head = findElement(document, element => element.tagName === "head");
    // Without a <head> there is no profile <meta>, so profileMetaPrefix throws.
    const prefix = profileMetaPrefix(name => (head ? metaContent(head, name) : undefined));
    const sheet = head && stylesheet(head, prefix);
    const edits: SourceEdit[] = sheet ? [sheet] : [];
    const body = findElement(document, element => element.tagName === "body");
    body?.childNodes.filter(isElement).forEach((slide, index) => {
        const edit = completeElement(slide, "slide", index + 1);
        if (edit) edits.push(edit);
        collectEdits(slide, "slide", index + 1, edits);
    });
    const completed = applySourceEdits(html, edits);
    // Standards mode: quirks mode drops the line-box strut (render/document.ts).
    const hasDoctype = document.childNodes.some(node => node.nodeName === "#documentType");
    return hasDoctype ? completed : `<!DOCTYPE html>${completed}`;
}

/**
 * Builds the renderer input from a stored, edited or hand-written profile v1 document: completes it with
 * PptxGenJS's defaults (`completeProfileHtml`), then checks it and reads its page size (`htmlDocument` from
 * `@pdflapas/model`). Pass the result to any renderer's `render()`. For HTML outside the profile, call
 * `render({ html, pageSize })` on the Puppeteer renderer directly.
 */
export function pptxHtmlDocument(html: string): HtmlPresentationDocument {
    return htmlDocument(completeProfileHtml(html));
}
