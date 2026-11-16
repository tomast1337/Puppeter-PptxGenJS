/**
 * Chromium-only declarations derived from values the PdfLapas HTML profile states once (docs/HTML_PROFILE.md,
 * "Renderer workarounds"), written into the document just before printing so they stay out of `toHtml()`.
 *
 * Every step reads attributes and raw `style` text, never layout, so this is a pure string transform: parse5
 * finds the elements, and each change is spliced into the original string at its source offsets, so every
 * byte the print step does not change stays as it was. HTML outside the profile comes back unchanged.
 */
import { type DefaultTreeAdapterTypes, parse } from "parse5";

type Element = DefaultTreeAdapterTypes.Element;
type Parent = DefaultTreeAdapterTypes.ParentNode;

interface Edit {
    start: number;
    end: number;
    text: string;
}

// Lengths are read from the raw `style` attribute: the CSSOM serializes them to 6 significant digits.
const LINE_HEIGHT = /(?:^|; )line-height: ([^;]+)px;/;
const LEFT = /(?:^|; )left: ([^;]+)px;/;
const TOP = /(?:^|; )top: ([^;]+)px;/;
const ROTATE = /rotate\(([^)]+)deg\)/;
const BORDER_WIDTH = /(?:^|; )border-(?:top|right|bottom|left): ([^ ;]+)px /g;
// A box's line as render/style.ts applyLine writes it: color, width, style.
const TEXT_BORDER = /(?:^|; )border-color: ([^;]+); border-width: ([^;]+)px; border-style: ([^;]+);/;
// The face as the profile writes it: one CSS string, `\` and `"` escaped.
const FONT_FAMILY = /((?:^|; )font-family: "((?:[^"\\]|\\.)*)")/;
// The payload of a `src="data:…"` attribute. Inlined images make up most of a large deck's HTML, and no print
// step reads or writes them. It stops at `<` too, so text that only looks like one never spans markup.
const DATA_URI_PAYLOAD = /(\ssrc="data:[^,"<]*,)[^"<]*/g;
const CALIBRI_FALLBACK = '"Noto Sans", Arial, "Liberation Sans", sans-serif';
const SANS_FALLBACK = 'Arial, "Liberation Sans", sans-serif';

const isElement = (node: DefaultTreeAdapterTypes.ChildNode | Parent): node is Element => "tagName" in node;
const attribute = (element: Element, name: string) => element.attrs.find(attr => attr.name === name)?.value;
const classes = (element: Element) => (attribute(element, "class") ?? "").split(/\s+/).filter(Boolean);
const hasClass = (element: Element, name: string) => classes(element).includes(name);
const parentElement = ({ parentNode }: Element) => (parentNode && isElement(parentNode) ? parentNode : undefined);
// A double-quoted attribute value, escaped as the HTML serializer does.
const quoted = (value: string) => `"${value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"`;

function* descendants(node: Parent): Generator<Element> {
    for (const child of node.childNodes) {
        if (!isElement(child)) continue;
        yield child;
        yield* descendants(child);
    }
}

function number(element: Element, value: string | undefined, what: string): number {
    const parsed = Number(value);
    if (value !== undefined && Number.isFinite(parsed)) return parsed;
    let named: Element | undefined = element;
    while (named && attribute(named, "data-object-name") === undefined) named = parentElement(named);
    const object = (named && attribute(named, "data-object-name")) ?? "unnamed object";
    const first = classes(element)[0];
    throw new Error(`Cannot print '${object}': its ${first ? `.${first}` : `<${element.tagName}>`} has no ${what} (PdfLapas HTML profile)`);
}

const px = (element: Element, pattern: RegExp, property: string) => number(element, attribute(element, "style")?.match(pattern)?.[1], `'${property}: <number>px' in its style attribute`);
// 1e-4 px is far below Chromium's 1/64 px layout unit; it drops float noise from inch conversions.
const fraction = (value: number) => Math.round((value - Math.round(value)) * 1e4) / 1e4;
const local = (value: number) => Number(value.toFixed(4)) || 0;

/** Sets attribute `name` to `value`: replaces it where it is written, or adds it right after the tag name. */
function setAttribute(element: Element, name: string, value: string): Edit {
    const at = element.sourceCodeLocation?.attrs?.[name];
    if (at) return { start: at.startOffset, end: at.endOffset, text: `${name}=${quoted(value)}` };
    const tag = element.sourceCodeLocation?.startTag;
    // Only elements the parser invented (an implied <tbody>) have no location, and none of them is edited.
    if (!tag) throw new Error(`Cannot print: <${element.tagName}> must be written out in the document`);
    // Right after the tag name, so a self-closed `<path … />` stays well formed.
    const start = tag.startOffset + 1 + element.tagName.length;
    return { start, end: start, text: ` ${name}=${quoted(value)}` };
}

/** Appends `declarations` to the element's style; later declarations win, as the CSSOM setters made them. */
function addStyle(element: Element, declarations: string): Edit {
    const style = (attribute(element, "style") ?? "").trim();
    return setAttribute(element, "style", style ? `${style}${style.endsWith(";") ? "" : ";"} ${declarations}` : declarations);
}

/**
 * `html` as Puppeteer prints it: the document with the print workarounds written in. Open the result in a
 * browser to see what Chromium prints. It is for Chromium only: the declarations it adds are outside the
 * profile, so the WASM renderer, which needs none of them, rejects it, and the print snap is sized for print,
 * not the screen (under 1px). The same input always gives the same output.
 */
export function printHtml(html: string): string {
    // parse5 tokenizes every character, so parse the document with data: URI payloads emptied (about 30 ms per MB
    // of payload otherwise) and put them back afterwards, in order: no edit below writes a src attribute.
    const payloads: string[] = [];
    const masked = html.replace(DATA_URI_PAYLOAD, (uri: string, head: string) => {
        payloads.push(uri.slice(head.length));
        return head;
    });
    const edits: Edit[] = [];
    for (const element of descendants(parse(masked, { sourceCodeLocationInfo: true }))) {
        if (hasClass(element, "text-run") || hasClass(element, "text-bullet")) {
            // Font fallback: Chromium does not apply LibreOffice's Microsoft-font substitutions to an unknown
            // single-family declaration. Keep the face first, then the metric-compatible sans fallback the
            // fixtures use. Written into the document, so the font loading Puppeteer awaits sees the final families.
            const style = attribute(element, "style") ?? "";
            const face = style.match(FONT_FAMILY)?.[2];
            // A bullet takes its first run's font; one without runs has none.
            if (face === undefined) continue;
            const fallback = face.toLowerCase().startsWith("calibri") ? CALIBRI_FALLBACK : SANS_FALLBACK;
            edits.push(setAttribute(element, "style", style.replace(FONT_FAMILY, `$1, ${fallback}`)));
        } else if (hasClass(element, "text-paragraph")) {
            // Line box: the paragraph's 0px-font strut (stylesheet) puts the baseline in the middle of `line-height`;
            // moving the paragraph puts it at data-line-baseline, where LibreOffice puts it.
            // shortcut: vertical text keeps the centred baseline; shift along the block axis once it is measured.
            const content = parentElement(element);
            const box = content && parentElement(content);
            if (!content || !box || !hasClass(content, "text-content") || attribute(box, "data-text-direction") !== "horizontal") continue;
            const height = px(element, LINE_HEIGHT, "line-height");
            const baseline = number(element, attribute(element, "data-line-baseline"), "numeric data-line-baseline");
            edits.push(addStyle(element, `position: relative; top: ${baseline - height / 2}px;`));
        } else if (hasClass(element, "slide-text")) {
            // Text outline: DrawingML centres a text box's line on its edge and measures the inset from the edge;
            // a CSS border lies inside the box and pushes the text in by its width. An outline moves nothing.
            const style = attribute(element, "style") ?? "";
            const border = style.match(TEXT_BORDER);
            if (!border || border[3] === "none") continue;
            const width = number(element, border[2], "numeric border-width");
            edits.push(addStyle(element, `border-style: none; outline: ${width}px ${border[3]} ${border[1]}; outline-offset: ${-width / 2}px;`));
        } else if (element.tagName === "svg" && hasClass(element, "shape-svg")) {
            edits.push(...shapeEdits(element));
        } else if (element.tagName === "table" && hasClass(element, "slide-table")) {
            // Table offset: DrawingML centres table borders on the grid; Chromium collapses the outer half into the
            // table box, so offset the grid by half the widest stroke. A hidden border is written 0px wide.
            let widest = 0;
            for (const cell of descendants(element)) {
                if (cell.tagName !== "td") continue;
                for (const [, width] of (attribute(cell, "style") ?? "").matchAll(BORDER_WIDTH)) widest = Math.max(widest, number(cell, width, "numeric border width"));
            }
            if (widest) edits.push(addStyle(element, `position: relative; left: ${-widest / 2}px; top: ${-widest / 2}px;`));
        }
    }
    // Later offsets first, so earlier ones stay valid.
    let printed = masked;
    for (const edit of edits.toSorted((a, b) => b.start - a.start)) printed = `${printed.slice(0, edit.start)}${edit.text}${printed.slice(edit.end)}`;
    let next = 0;
    return printed.replace(DATA_URI_PAYLOAD, (head: string) => `${head}${payloads[next++] ?? ""}`);
}

function shapeEdits(svg: Element): Edit[] {
    const edits: Edit[] = [];
    // Print snap: Chromium paints an SVG root from a whole CSS px. In print it rounds the object's offset
    // on its page half up (-10.5 -> -10) and moves the drawing by the difference, in page space even
    // under the object's rotation or flip. Measured from the PDF matrices (issue #42), also on later A4
    // pages, whose 793.92px height puts them at fractional document offsets. Translate the drawing back,
    // in the SVG's own pre-transform space. Print only: on screen the snap step is 1 / devicePixelRatio.
    const object = parentElement(svg);
    if (!object) return edits;
    const dx = fraction(px(object, LEFT, "left"));
    const dy = fraction(px(object, TOP, "top"));
    if (dx || dy) {
        // Undo the object's `rotate() scaleX() scaleY()` on the page-space offset.
        const box = attribute(object, "style") ?? "";
        const angle = (Number(box.match(ROTATE)?.[1] ?? 0) * Math.PI) / 180;
        const x = local((dx * Math.cos(angle) + dy * Math.sin(angle)) * (box.includes("scaleX(-1)") ? -1 : 1));
        const y = local((dy * Math.cos(angle) - dx * Math.sin(angle)) * (box.includes("scaleY(-1)") ? -1 : 1));
        edits.push(addStyle(svg, `transform: translate(${x}px, ${y}px);`));
    }

    // Dash rewrite: Chromium's PDF keeps a zero-length dash, which poppler paints as a hairline in every
    // gap. Draw a pattern that starts with a gap (startDashAt) as the same pattern shifted by an offset.
    for (const stroked of descendants(svg)) {
        const dashes = attribute(stroked, "stroke-dasharray");
        if (dashes === undefined) continue;
        const [first, gap = 0, ...rest] = dashes.split(" ").map(Number);
        const last = rest.at(-1);
        if (first !== 0 || last === undefined) continue;
        const pattern = [...rest.slice(0, -1), last + gap];
        edits.push(setAttribute(stroked, "stroke-dasharray", pattern.join(" ")));
        edits.push(setAttribute(stroked, "stroke-dashoffset", String(pattern.reduce((sum, part) => sum + part, 0) - gap)));
    }
    return edits;
}
