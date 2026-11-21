/**
 * Chromium-only declarations derived from values the PdfLapas HTML profile states once (docs/HTML_PROFILE.md,
 * "Renderer workarounds"), written into the document just before printing so they stay out of `toHtml()`.
 *
 * Every step reads attributes and raw `style` text, never layout, so this is a pure string transform: parse5
 * finds the elements, and each change is spliced into the original string at its source offsets, so every
 * byte the print step does not change stays as it was. HTML outside the profile comes back unchanged.
 */
import { applySourceEdits, degreesToRadians, LAYOUT_UNITS_PER_PX, type SourceEdit } from "@pdflapas/model";
import { type DefaultTreeAdapterTypes, parse } from "parse5";

type Element = DefaultTreeAdapterTypes.Element;
type Parent = DefaultTreeAdapterTypes.ParentNode;

// Lengths are read from the raw `style` attribute: the CSSOM serializes them to 6 significant digits.
const LINE_HEIGHT = /(?:^|; )line-height: ([^;]+)px;/;
const LEFT = /(?:^|; )left: ([^;]+)px;/;
const TOP = /(?:^|; )top: ([^;]+)px;/;
const ROTATE = /rotate\(([^)]+)deg\)/;
const BORDER_WIDTH = /(?:^|; )border-(top|right|bottom|left): ([^ ;]+)px /g;
const ABSOLUTE = /(?:^|; )position: absolute;/;
// An inner shadow as render/style.ts applyShadow writes it on a box.
const INSET_SHADOW = /(?:^|; )box-shadow: inset ([^;]+);/;
// A box's line as render/style.ts applyLine writes it: color, width, style.
const TEXT_BORDER = /(?:^|; )border-color: ([^;]+); border-width: ([^;]+)px; border-style: ([^;]+);/;
// The face and its fallback faces as the profile writes them: CSS strings, `\` and `"` escaped; group 2 is the face.
const FONT_FAMILY = /((?:^|; )font-family: "((?:[^"\\]|\\.)*)"(?:, "(?:[^"\\]|\\.)*")*)/;
// U+2011 NON-BREAKING HYPHEN in a run's source text, literal or as a character reference.
const NON_BREAKING_HYPHEN = /\u2011|&#(?:8209|x2011);/gi;
// U+002D, which draws the face's hyphen, then U+2060 WORD JOINER, which keeps U+2011's no-break after it.
const HYPHEN_MINUS_NO_BREAK = "-\u2060";
// The payload of a `src="data:…"` attribute. Inlined images make up most of a large deck's HTML, and no print
// step reads or writes them. It stops at `<` too, so text that only looks like one never spans markup.
const DATA_URI_PAYLOAD = /(\ssrc="data:[^,"<]*,)[^"<]*/g;
// Calibri and Cambria name their metric-compatible faces first, as the WASM renderer's family_stack does
// (crates/pdf-core/src/text/font.rs), so lines wrap as in PowerPoint where the Office fonts are missing. Noto Sans
// comes next because LibreOffice draws Calibri in it on a machine without Carlito.
const CALIBRI_FALLBACK = '"Carlito", "Noto Sans", Arial, "Liberation Sans", sans-serif';
const CAMBRIA_FALLBACK = '"Caladea", Arial, "Liberation Sans", sans-serif';
const SANS_FALLBACK = 'Arial, "Liberation Sans", sans-serif';

/**
 * The metric-compatible face the print step names first after `face`: Carlito for every Calibri face, Caladea for every
 * Cambria face. Text drawn in it is drawn as intended, so it is not a missing font (PptxGenJS writes Calibri and the
 * theme's Calibri Light by default).
 */
// eslint-disable-next-line pdflapas/no-nullable-return -- phase 2 (#425)
export function metricSubstitute(face: string): "Carlito" | "Caladea" | undefined {
    const lower = face.toLowerCase();

    return lower.startsWith("calibri") ? "Carlito" : lower.startsWith("cambria") ? "Caladea" : undefined;
}

/**
 * Print zoom: Chromium paints every text baseline and SVG root on a whole CSS px, so text sits up to 1 px above
 * LibreOffice's fractional baselines (#49). The printed document is laid out at this zoom and `page.pdf()` scales
 * it back by its inverse, so the snap step becomes 1 / PRINT_ZOOM px. 8 is the largest power of two whose
 * inverse is within Chromium's smallest pdf scale (0.1); a power of two keeps the scale exact in binary.
 */
export const PRINT_ZOOM = 8;

const isElement = (node: DefaultTreeAdapterTypes.ChildNode | Parent): node is Element => "tagName" in node;
const attribute = (element: Element, name: string) => element.attrs.find(attr => attr.name === name)?.value;
const classes = (element: Element) => (attribute(element, "class") ?? "").split(/\s+/).filter(Boolean);
const hasClass = (element: Element, name: string) => classes(element).includes(name);
const parentElement = ({ parentNode }: Element) => (parentNode && isElement(parentNode) ? parentNode : undefined);
// A double-quoted attribute value, escaped as the HTML serializer does.
const quoted = (value: string) => `"${value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"`;

function* descendants(node: Parent): Generator<Element> {
    for (const child of node.childNodes) {
        if (!isElement(child)) {
            continue;
        }

        yield child;
        yield* descendants(child);
    }
}

/** The data-object-name of the slide object that holds `element`. */
function objectName(element: Element): string {
    let named: Element | undefined = element;

    while (named && attribute(named, "data-object-name") === undefined) {
        named = parentElement(named);
    }

    return (named && attribute(named, "data-object-name")) ?? "unnamed object";
}

function number(element: Element, value: string | undefined, what: string): number {
    const parsed = Number(value);

    if (value !== undefined && Number.isFinite(parsed)) {
        return parsed;
    }

    const first = classes(element)[0];

    throw new Error(`Cannot print '${objectName(element)}': its ${first ? `.${first}` : `<${element.tagName}>`} has no ${what} (PdfLapas HTML profile)`);
}

const px = (element: Element, pattern: RegExp, property: string) => number(element, attribute(element, "style")?.match(pattern)?.[1], `'${property}: <number>px' in its style attribute`);
// 1e-4 px is far below Chromium's 1/64 px layout unit; it drops float noise from inch conversions.
const fraction = (value: number) => Math.round((value - Math.round(value)) * 1e4) / 1e4;
const local = (value: number) => Number(value.toFixed(4)) || 0;

/** Sets attribute `name` to `value`: replaces it where it is written, or adds it right after the tag name. */
function setAttribute(element: Element, name: string, value: string): SourceEdit {
    const at = element.sourceCodeLocation?.attrs?.[name];

    if (at) {
        return { start: at.startOffset, end: at.endOffset, text: `${name}=${quoted(value)}` };
    }

    const tag = element.sourceCodeLocation?.startTag;

    // Only elements the parser invented (an implied <tbody>) have no location, and none of them is edited.
    if (!tag) {
        throw new Error(`Cannot print: <${element.tagName}> must be written out in the document`);
    }

    // Right after the tag name, so a self-closed `<path … />` stays well formed.
    const start = tag.startOffset + 1 + element.tagName.length;

    return { start, end: start, text: ` ${name}=${quoted(value)}` };
}

/** Appends `declarations` to the element's style; later declarations win, as the CSSOM setters made them. */
function addStyle(element: Element, declarations: string): SourceEdit {
    const style = (attribute(element, "style") ?? "").trim();

    return setAttribute(element, "style", style ? `${style}${style.endsWith(";") ? "" : ";"} ${declarations}` : declarations);
}

/**
 * `html` as Puppeteer prints it: the document with the print workarounds written in. Open the result in a
 * browser to see what Chromium prints. It is for Chromium only: the declarations it adds are outside the
 * profile, so the WASM renderer, which needs none of them, rejects it, and it is laid out at PRINT_ZOOM times the
 * deck size, which `page.pdf()` scales back (a browser shows it at 1 / PRINT_ZOOM page zoom). The same input always
 * gives the same output. The document must write out its `<html>` start tag, which carries the zoom.
 */
export function printHtml(html: string): string {
    // parse5 tokenizes every character, so parse the document with data: URI payloads emptied (about 30 ms per MB
    // of payload otherwise) and put them back afterwards, in order: no edit below writes a src attribute.
    const payloads: string[] = [];
    const masked = html.replace(DATA_URI_PAYLOAD, (uri: string, head: string) => {
        payloads.push(uri.slice(head.length));

        return head;
    });
    const edits: SourceEdit[] = [];

    for (const element of descendants(parse(masked, { sourceCodeLocationInfo: true }))) {
        if (hasClass(element, "slide-element")) {
            // Inner shadow: the profile draws one only on a picture, over it and inside its frame. Chromium paints an inset
            // box-shadow under the box's content, where the <img> hides it, so the shadow moves onto an empty box laid over
            // the frame. On any other box it would be drawn where the WASM renderer draws none ("inner shadow not rendered"):
            // addShape and addText reject it, so only hand-written HTML gets here, and it fails.
            const shadow = attribute(element, "style")?.match(INSET_SHADOW)?.[1];

            if (shadow !== undefined) {
                if (!hasClass(element, "slide-image")) {
                    throw new Error(`Cannot print '${objectName(element)}': its box-shadow is inset, and the profile draws an inner shadow only on a .slide-image; remove the shadow or make it an outer one (PdfLapas HTML profile)`);
                }

                const end = element.sourceCodeLocation?.endTag;

                if (!end) {
                    throw new Error(`Cannot print '${objectName(element)}': its .slide-image must be written out with an end tag`);
                }

                const overlay = `<div style="position: absolute; inset: 0; border-radius: inherit; box-shadow: inset ${shadow}; pointer-events: none;"></div>`;

                edits.push(addStyle(element, "box-shadow: none;"), { start: end.startOffset, end: end.startOffset, text: overlay });
            }
        }

        if (element.tagName === "html") {
            edits.push(addStyle(element, `zoom: ${PRINT_ZOOM};`));
        } else if (hasClass(element, "text-run") || hasClass(element, "text-bullet")) {
            // text-shadow has no inset form either: Chromium would draw a run's inner shadow outside its glyphs.
            if (attribute(element, "data-shadow-inset") !== undefined) {
                throw new Error(`Cannot print '${objectName(element)}': a .text-run has data-shadow-inset, and the profile draws an inner shadow only on a .slide-image (text-shadow has no inset form); remove data-shadow-inset or the run's shadow (PdfLapas HTML profile)`);
            }

            // Font fallback: Chromium does not apply LibreOffice's Microsoft-font substitutions to an unknown
            // single-family declaration. Keep the face first, then the metric-compatible sans fallback the
            // fixtures use. Written into the document, so the font loading Puppeteer awaits sees the final families.
            const style = attribute(element, "style") ?? "";
            const face = style.match(FONT_FAMILY)?.[2]?.toLowerCase();

            // A bullet takes its first run's font; one without runs has none.
            if (face === undefined) {
                continue;
            }

            const substitute = metricSubstitute(face);
            const fallback = substitute === "Carlito" ? CALIBRI_FALLBACK : substitute === "Caladea" ? CAMBRIA_FALLBACK : SANS_FALLBACK;

            edits.push(setAttribute(element, "style", style.replace(FONT_FAMILY, `$1, ${fallback}`)));
            // data-non-breaking-hyphen="hyphen-minus": Chromium picks a face by the character, so it draws U+2011 in a
            // fallback face where the run's face lacks it; U+002D is in the face. No break opportunity is added.
            if (attribute(element, "data-non-breaking-hyphen") === "hyphen-minus") {
                edits.push(...nonBreakingHyphenEdits(element, masked));
            }
        } else if (hasClass(element, "text-paragraph")) {
            // Line box: the paragraph's 0px-font strut (stylesheet) puts the baseline about the middle of `line-height`
            // (the strut baseline below); moving the paragraph puts it at data-line-baseline, where LibreOffice puts it.
            // shortcut: vertical text keeps the centred baseline; shift along the block axis once it is measured.
            const content = parentElement(element);
            const box = content && parentElement(content);

            if (!content || !box || !hasClass(content, "text-content") || attribute(box, "data-text-direction") !== "horizontal") {
                continue;
            }

            const height = px(element, LINE_HEIGHT, "line-height");
            const baseline = number(element, attribute(element, "data-line-baseline"), "numeric data-line-baseline");
            // Strut baseline: Chromium puts the 0px-font strut's baseline its half-leading below the line top, that is half the
            // line height in its 1/64 px layout unit floored to a whole px of the zoomed layout (Blink FontHeight::AddLeading
            // floors the half-leading), then paints the baseline at the nearest device px. Measured on 80 Arial text boxes and
            // cells (6-18pt, fractional y): a 9.6px line puts the baseline 0.398 device px above the line's middle, 11.2px 0.797,
            // 12.8px 0.203, and every painted baseline is that layout baseline rounded. Moving by the centre instead printed
            // baselines 0.049pt high on average (sd 0.04, up to 0.12pt).
            // 1e-6 keeps float noise in `height x PRINT_ZOOM` from flooring a whole layout unit away.
            const strutBaseline = Math.floor(Math.floor(height * PRINT_ZOOM * LAYOUT_UNITS_PER_PX + 1e-6) / (2 * LAYOUT_UNITS_PER_PX)) / PRINT_ZOOM;

            edits.push(addStyle(element, `position: relative; top: ${baseline - strutBaseline}px;`));
        } else if (hasClass(element, "slide-text")) {
            // Text outline: DrawingML centres a text box's line on its edge and measures the inset from the edge;
            // a CSS border lies inside the box and pushes the text in by its width. An outline moves nothing.
            const style = attribute(element, "style") ?? "";
            const border = style.match(TEXT_BORDER);

            if (!border || border[3] === "none") {
                continue;
            }

            const width = number(element, border[2], "numeric border-width");

            edits.push(addStyle(element, `border-style: none; outline: ${width}px ${border[3]} ${border[1]}; outline-offset: ${-width / 2}px;`));
        } else if (element.tagName === "svg" && hasClass(element, "shape-svg")) {
            // drop-shadow() has no inset form, so Chromium would draw an inner shadow outside the shape. addShape rejects
            // one, so only hand-written HTML gets here: fail, as the WASM renderer does by default ("inner shadow not rendered").
            if (attribute(element, "data-shadow-inset") !== undefined) {
                throw new Error(`Cannot print '${objectName(element)}': its .shape-svg has data-shadow-inset, and Puppeteer cannot draw an inner shadow on a shape (drop-shadow() has no inset form); remove data-shadow-inset or the shadow (PdfLapas HTML profile)`);
            }

            // Print snap: Chromium paints an SVG root from a whole device px, 1 / PRINT_ZOOM CSS px under the print
            // zoom. In print it rounds the object's offset on its page half up (-10.5 -> -10) and moves the drawing by
            // the difference, in page space even under the object's rotation or flip. Measured from the PDF matrices
            // (issue #42), also on later A4 pages, whose 793.92px height puts them at fractional document offsets.
            // Translate the drawing back, in the SVG's own pre-transform space. Print only: on screen the snap step is
            // 1 / (devicePixelRatio * zoom).
            const object = parentElement(element);

            if (!object) {
                continue;
            }

            const dx = fraction(px(object, LEFT, "left") * PRINT_ZOOM) / PRINT_ZOOM;
            const dy = fraction(px(object, TOP, "top") * PRINT_ZOOM) / PRINT_ZOOM;

            if (dx || dy) {
                // Undo the object's `rotate() scaleX() scaleY()` on the page-space offset.
                const box = attribute(object, "style") ?? "";
                const angle = degreesToRadians(Number(box.match(ROTATE)?.[1] ?? 0));
                const x = local((dx * Math.cos(angle) + dy * Math.sin(angle)) * (box.includes("scaleX(-1)") ? -1 : 1));
                const y = local((dy * Math.cos(angle) - dx * Math.sin(angle)) * (box.includes("scaleY(-1)") ? -1 : 1));

                edits.push(addStyle(element, `transform: translate(${x}px, ${y}px);`));
            }

            // Dash rewrite: Chromium's PDF keeps a zero-length dash, which poppler paints as a hairline in every
            // gap. Draw a pattern that starts with a gap (startDashAt) as the same pattern shifted by an offset.
            for (const stroked of descendants(element)) {
                const dashes = attribute(stroked, "stroke-dasharray");

                if (dashes === undefined) {
                    continue;
                }

                const [first, gap = 0, ...rest] = dashes.split(" ").map(Number);
                const last = rest.at(-1);

                if (first !== 0 || last === undefined) {
                    continue;
                }

                const pattern = [...rest.slice(0, -1), last + gap];
                let period = 0;

                for (const part of pattern) {
                    period += part;
                }

                edits.push(setAttribute(stroked, "stroke-dasharray", pattern.join(" ")));
                edits.push(setAttribute(stroked, "stroke-dashoffset", String(period - gap)));
            }
        } else if (element.tagName === "table" && hasClass(element, "slide-table")) {
            // The table's cells placed on its grid as HTML table layout places them: each in the first free column of its row.
            const taken = new Set<string>();
            const cells: GridCell[] = [];
            let row = 0;

            for (const tr of descendants(element)) {
                if (tr.tagName !== "tr") {
                    continue;
                }

                let column = 0;

                for (const td of tr.childNodes) {
                    if (!isElement(td) || td.tagName !== "td") {
                        continue;
                    }

                    while (taken.has(`${row},${column}`)) {
                        column++;
                    }

                    const rows = Math.max(1, Number(attribute(td, "rowspan") ?? 1) || 1);
                    const columns = Math.max(1, Number(attribute(td, "colspan") ?? 1) || 1);

                    for (let r = row; r < row + rows; r++) {
                        for (let c = column; c < column + columns; c++) {
                            taken.add(`${r},${c}`);
                        }
                    }

                    const borders = { top: 0, right: 0, bottom: 0, left: 0 };

                    for (const [, side, width] of (attribute(td, "style") ?? "").matchAll(BORDER_WIDTH)) {
                        // The pattern's alternation matches only these four sides. A hidden border is written 0px wide.
                        // Border snap: Chromium lays a border out at a whole device px, its width floored (at least 1 device
                        // px), so under the print zoom a 1pt (1.333px) border is 10/8 px wide, not 10.667/8. Measured on the
                        // collapsed table borders of the visual fixture (#196): a row was 1/12 px shorter than its margins and
                        // line height, 1px every 12 rows.
                        const snapped = number(td, width, "numeric border width");

                        borders[side as keyof Sides] = snapped > 0 ? Math.max(1, Math.floor(snapped * PRINT_ZOOM)) / PRINT_ZOOM : 0;
                    }

                    cells.push({ element: td, row, column, rows, columns, borders });
                    column += columns;
                }

                row++;
            }

            let top = 0;
            let left = 0;

            for (const cell of cells) {
                // Each side of the cell as Chromium collapses it: the widest of its own border and the facing borders of the
                // cells across that grid line (CSS 2.1 17.6.2.1; none and hidden borders are written 0px wide).
                const overlaps = (start: number, count: number, otherStart: number, otherCount: number) => start < otherStart + otherCount && otherStart < start + count;
                const facing = (side: keyof Sides, opposite: keyof Sides, across: (other: GridCell) => boolean) => {
                    let widest = cell.borders[side];

                    for (const other of cells) {
                        if (across(other)) {
                            widest = Math.max(widest, other.borders[opposite]);
                        }
                    }

                    return widest;
                };
                const sameRows = (other: GridCell) => overlaps(cell.row, cell.rows, other.row, other.rows);
                const sameColumns = (other: GridCell) => overlaps(cell.column, cell.columns, other.column, other.columns);
                const borders: Sides = {
                    top: facing("top", "bottom", other => other.row + other.rows === cell.row && sameColumns(other)),
                    right: facing("right", "left", other => other.column === cell.column + cell.columns && sameRows(other)),
                    bottom: facing("bottom", "top", other => other.row === cell.row + cell.rows && sameColumns(other)),
                    left: facing("left", "right", other => other.column + other.columns === cell.column && sameRows(other)),
                };

                if (cell.row === 0) {
                    top = Math.max(top, borders.top);
                }

                if (cell.column === 0) {
                    left = Math.max(left, borders.left);
                }

                const text = cell.element.childNodes.find((child): child is Element => isElement(child) && hasClass(child, "table-cell-text"));
                // PptxGenJS writes a bare <a:bodyPr/> in a cell, so the profile has no cell autofit; the WASM parser rejects it too.
                const fit = text && attribute(text, "data-text-fit");

                if (text && fit !== undefined && fit !== "none") {
                    throw new Error(`Cannot print '${objectName(text)}': its .table-cell-text needs data-text-fit="none", since a table cell has no autofit and its row grows to the text (PdfLapas HTML profile)`);
                }

                const { top: t, right: r, bottom: b, left: l } = borders;

                if (text && (t || r || b || l)) {
                    // Cell inset: DrawingML measures a cell's margins from the grid line under its centred border; Chromium puts the
                    // inner half of a collapsed border inside the cell, its neighbour's when that one is wider, and the margins after it.
                    // Grow the cell's text box over that half on each side, or a row whose text fills it grows by the half (a 0.5pt
                    // bottom border on 0.2667in rows of 10pt text printed them 19.41-19.50pt apart, not 19.2): an absolute box by its
                    // inset, one in flow by negative margins and a wider width.
                    const [halfTop, halfRight, halfBottom, halfLeft] = [t / 2, r / 2, b / 2, l / 2];

                    if (ABSOLUTE.test(attribute(text, "style") ?? "")) {
                        edits.push(addStyle(text, `inset: ${-halfTop}px ${-halfRight}px ${-halfBottom}px ${-halfLeft}px;`));
                    } else {
                        edits.push(addStyle(text, `margin: ${-halfTop}px ${-halfRight}px ${-halfBottom}px ${-halfLeft}px; width: calc(100% + ${halfLeft + halfRight}px);`));
                    }
                }
            }

            // Table offset: DrawingML centres table borders on the grid; Chromium puts the outer half of the first row's
            // top borders and of the first column's left borders inside the table box, so move the grid up and left by them.
            if (top || left) {
                edits.push(addStyle(element, `position: relative; left: ${-left / 2}px; top: ${-top / 2}px;`));
            }
        }
    }

    let next = 0;

    return applySourceEdits(masked, edits).replace(DATA_URI_PAYLOAD, (head: string) => `${head}${payloads[next++] ?? ""}`);
}

/** Each U+2011 in the text of `run` and its word spans, in `source`, as U+002D and a word joiner. */
function nonBreakingHyphenEdits(run: Element, source: string): SourceEdit[] {
    const edits: SourceEdit[] = [];

    for (const child of run.childNodes) {
        if (isElement(child)) {
            edits.push(...nonBreakingHyphenEdits(child, source));
            continue;
        }

        const at = child.nodeName === "#text" ? child.sourceCodeLocation : undefined;

        if (!at) {
            continue;
        }

        for (const match of source.slice(at.startOffset, at.endOffset).matchAll(NON_BREAKING_HYPHEN)) {
            edits.push({ start: at.startOffset + match.index, end: at.startOffset + match.index + match[0].length, text: HYPHEN_MINUS_NO_BREAK });
        }
    }

    return edits;
}

type Sides = Record<"top" | "right" | "bottom" | "left", number>;

/** A `<td>` at its place in the table grid, with the snapped width of each border it writes. */
interface GridCell {
    element: Element;
    row: number;
    column: number;
    rows: number;
    columns: number;
    borders: Sides;
}
