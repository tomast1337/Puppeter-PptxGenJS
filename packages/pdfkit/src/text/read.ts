// Reads a text box of the profile (docs/HTML_PROFILE.md "Text") into the values the layout needs. Every inline
// property and data-* attribute the renderer does not draw is reported through `report`, never dropped silently.
import { type Color, color, cssStrings, px, readStyle, type Style, sides, take } from "#src/css";
import { attribute, children, type Element, hasClass, isElement, textContent } from "#src/dom";
import type { FaceRequest } from "#src/fonts";

export interface Decoration {
    readonly style: "solid" | "double" | "dashed" | "dotted";
    readonly color: Color;
}

export interface Run {
    /** The run's text; U+200B (an empty run) and U+2060 (no break) take part in breaking only. */
    readonly text: string;
    readonly face: FaceRequest;
    readonly size: number;
    readonly color: Color;
    readonly letterSpacing: number;
    readonly kerning: boolean;
    readonly underline?: Decoration;
    readonly strike?: Decoration;
    /** `top` of a raised or lowered run (super/subscript, baseline offset), px down. */
    readonly shift: number;
    readonly highlight?: Color;
    readonly outline?: { readonly width: number; readonly color: Color };
    readonly link?: { readonly href?: string; readonly slide?: number };
    readonly softBreakBefore: boolean;
    readonly synthesis: Synthesis;
}

/** How a run is drawn when its face has no bold or italic style (`data-synthetic-bold`, `data-synthetic-italic`). */
export interface Synthesis {
    /** The stroke drawn around the filled glyphs, as a fraction of the font size. */
    readonly boldStroke: number;
    /** The shear to the right per unit of height above the baseline. */
    readonly italicShear: number;
}

export interface Bullet {
    readonly text: string;
    readonly face: FaceRequest;
    readonly size: number;
    readonly color: Color;
}

export type Align = "left" | "center" | "right" | "justify";

export interface Paragraph {
    readonly runs: readonly Run[];
    readonly align: Align;
    readonly lineHeight: number;
    readonly baseline: number;
    readonly markBaseline: number;
    readonly breakBaseline: number;
    readonly spaceBefore: number;
    readonly spaceAfter: number;
    readonly tabSize: number;
    /** `padding-left`: every line starts here. */
    readonly indent: number;
    /** `text-indent`: the first line, and its bullet, start this far from `indent`. */
    readonly textIndent: number;
    readonly bullet?: Bullet;
}

export type Fit = { readonly kind: "none" | "resize" } | { readonly kind: "shrink"; readonly step: number; readonly maxSteps: number; readonly tolerance: number };

export interface TextBox {
    readonly paragraphs: readonly Paragraph[];
    readonly padding: readonly [number, number, number, number];
    readonly anchor: "flex-start" | "center" | "flex-end";
    readonly wrap: boolean;
    readonly fit: Fit;
}

export type Report = (what: string) => void;

const ALIGNS: ReadonlySet<string> = new Set(["left", "center", "right", "justify"]);
const ANCHORS: ReadonlySet<string> = new Set(["flex-start", "center", "flex-end"]);
const DECORATION_STYLES: ReadonlySet<string> = new Set(["solid", "double", "dashed", "dotted"]);
/**
 * Chromium's synthetic styles, the default for HTML that does not state them: pdf-core's
 * CHROMIUM_SYNTHETIC_BOLD_STROKE_EM and CHROMIUM_SYNTHETIC_ITALIC_SHEAR, measured in Chromium's PDF output.
 */
const BROWSER_SYNTHESIS: Synthesis = Object.freeze({ boldStroke: 1 / 32, italicShear: 0.25 });
/** U+002D then U+2060 WORD JOINER: a U+2011 in a run with `data-non-breaking-hyphen`, drawn with the face's hyphen and still unbreakable. */
const HYPHEN_MINUS_NO_BREAK = "-\u2060";
const NON_BREAKING_HYPHEN = /\u2011/g;
/** Layout CSS that `toHtml()` writes for Chromium and that states no drawn value of its own. */
const LAYOUT_ONLY: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
    content: new Set(["width"]),
    bullet: new Set(["display", "width"]),
});

/** Reports the properties left in `style` and the data-* attributes not in `read`. */
export function reportUnread(element: Element, style: Style, read: readonly string[], report: Report, ignored: ReadonlySet<string> = new Set()): void {
    for (const [property, value] of style) if (!ignored.has(property)) report(`CSS property '${property}: ${value}' on <${element.tagName}> is not drawn`);
    for (const { name } of element.attrs) if (name.startsWith("data-") && !read.includes(name)) report(`attribute '${name}' on <${element.tagName}> is not drawn`);
}

function required(value: number | undefined, what: string): number {
    if (value === undefined || !Number.isFinite(value)) throw new Error(`invalid PdfLapas HTML: ${what} is missing or not a number`);
    return value;
}

function requiredColor(value: string | undefined, what: string): Color {
    const parsed = color(value);
    if (!parsed) throw new Error(`invalid PdfLapas HTML: ${what} '${value ?? ""}' is missing or not a color the renderer reads (#rgb, #rrggbb, rgb(), rgba())`);
    return parsed;
}

function readColor(value: string | undefined, what: string, report: Report): Color | undefined {
    const parsed = color(value);
    if (value !== undefined && !parsed) report(`${what} '${value}' is not a color the renderer reads`);
    return parsed;
}

function readFace(element: Element, style: Style): FaceRequest {
    const value = take(style, "font-family") ?? "";
    const [family, ...fallbacks] = cssStrings(value) ?? [];
    if (family === undefined) throw new Error(`invalid PdfLapas HTML: font-family '${value}' on <${element.tagName}> is not one or more quoted families separated by ', '`);
    const lang = attribute(element, "lang");
    return { family, fallbacks, ...(lang ? { lang } : {}), bold: take(style, "font-weight") === "bold", italic: take(style, "font-style") === "italic" };
}

function readSynthesis(element: Element): Synthesis {
    const number = (name: string, fallback: number) => {
        const value = attribute(element, name);
        if (value === undefined) return fallback;
        const parsed = Number(value);
        if (value.trim() === "" || !Number.isFinite(parsed)) throw new Error(`invalid PdfLapas HTML: attribute '${name}' '${value}' is not a number`);
        return parsed;
    };
    const boldStroke = number("data-synthetic-bold", BROWSER_SYNTHESIS.boldStroke);
    if (boldStroke < 0) throw new Error(`invalid PdfLapas HTML: attribute 'data-synthetic-bold' ${boldStroke} is negative`);
    return { boldStroke, italicShear: number("data-synthetic-italic", BROWSER_SYNTHESIS.italicShear) };
}

/**
 * A run's text in pieces of one `letter-spacing` each: its bare text at the run's, each word span
 * (`<span style="letter-spacing: ...">`, text only) at its own. U+2011 becomes U+002D U+2060 under `data-non-breaking-hyphen`.
 */
function runPieces(element: Element, letterSpacing: number): { text: string; letterSpacing: number; word: boolean }[] {
    const hyphen = attribute(element, "data-non-breaking-hyphen");
    if (hyphen !== undefined && hyphen !== "hyphen-minus") throw new Error(`invalid PdfLapas HTML: attribute 'data-non-breaking-hyphen' '${hyphen}' is not hyphen-minus`);
    const text = (value: string) => (hyphen === undefined ? value : value.replace(NON_BREAKING_HYPHEN, HYPHEN_MINUS_NO_BREAK));
    const pieces: { text: string; letterSpacing: number; word: boolean }[] = [];
    for (const node of element.childNodes) {
        if (!isElement(node)) {
            const value = "value" in node ? node.value : "";
            const last = pieces.at(-1);
            // Bare text pieces next to each other share the run's spacing.
            if (last && !last.word) last.text += text(value);
            else pieces.push({ text: text(value), letterSpacing, word: false });
            continue;
        }
        const style = readStyle(node);
        const spacing = px(take(style, "letter-spacing"));
        if (node.tagName !== "span" || node.attrs.length !== 1 || spacing === undefined || style.size || node.childNodes.some(isElement)) {
            throw new Error(`invalid PdfLapas HTML: <${node.tagName}> inside a run; a run holds text and word spans, <span style="letter-spacing: <n>px;"> with text only`);
        }
        pieces.push({ text: text(textContent(node)), letterSpacing: spacing, word: true });
    }
    return pieces.filter(piece => piece.text);
}

function readDecorations(element: Element, style: Style, textColor: Color, report: Report): Pick<Run, "underline" | "strike"> {
    const lines = (take(style, "text-decoration-line") ?? "").split(/\s+/);
    const cssStyle = take(style, "text-decoration-style") ?? "solid";
    const decorationColor = readColor(take(style, "text-decoration-color"), "text-decoration-color", report) ?? textColor;
    const doubleStrike = attribute(element, "data-double-strike") !== undefined;
    // A double strike takes text-decoration-style; the underline's own style is then in data-underline-style.
    const underlineStyle = (doubleStrike ? attribute(element, "data-underline-style") : cssStyle) ?? "solid";
    const decoration = (kind: string, styleName: string): Decoration | undefined => {
        if (DECORATION_STYLES.has(styleName)) return { style: styleName as Decoration["style"], color: kind === "underline" ? decorationColor : textColor }; // `as`: checked against DECORATION_STYLES
        report(`${kind} style '${styleName}' is not drawn (drawn solid)`);
        return { style: "solid", color: decorationColor };
    };
    return {
        ...(lines.includes("underline") ? { underline: decoration("underline", underlineStyle) } : {}),
        ...(lines.includes("line-through") || doubleStrike ? { strike: decoration("strike", doubleStrike ? "double" : "solid") } : {}),
    };
}

function readOutline(value: string | undefined, report: Report): Run["outline"] {
    if (value === undefined) return undefined;
    const space = value.indexOf(" ");
    const width = px(value.slice(0, space));
    const outlineColor = color(value.slice(space + 1));
    if (width === undefined || !outlineColor) {
        report(`-webkit-text-stroke '${value}' is not drawn`);
        return undefined;
    }
    return { width, color: outlineColor };
}

function readRuns(element: Element, report: Report): Run[] {
    const style = readStyle(element);
    const runColor = requiredColor(take(style, "color"), "a run's color");
    const href = attribute(element, "href");
    const slide = attribute(element, "data-slide");
    const position = take(style, "position");
    const top = px(take(style, "top")) ?? 0;
    if (position !== undefined && position !== "relative") report(`position '${position}' on a run is not drawn`);
    const highlight = readColor(take(style, "background-color"), "background-color", report);
    const letterSpacing = px(take(style, "letter-spacing")) ?? 0;
    const run: Run = {
        text: textContent(element),
        face: readFace(element, style),
        size: required(px(take(style, "font-size")), "a run's font-size"),
        color: runColor,
        letterSpacing,
        kerning: take(style, "font-kerning") !== "none",
        ...readDecorations(element, style, runColor, report),
        shift: top,
        ...(highlight && highlight.alpha > 0 ? { highlight } : {}),
        ...(style.has("-webkit-text-stroke") ? { outline: readOutline(take(style, "-webkit-text-stroke"), report) } : {}),
        ...(href !== undefined || slide !== undefined ? { link: { ...(href !== undefined ? { href } : {}), ...(slide !== undefined ? { slide: Number(slide) } : {}) } } : {}),
        softBreakBefore: attribute(element, "data-soft-break-before") !== undefined,
        synthesis: readSynthesis(element),
    };
    const read = ["data-double-strike", "data-underline-style", "data-vertical-align", "data-empty", "data-soft-break-before", "data-slide", "data-text-shadow", "data-shadow-inset"];
    reportUnread(element, style, [...read, "data-synthetic-bold", "data-synthetic-italic", "data-non-breaking-hyphen"], report);
    // One run per piece of one letter-spacing; only the first starts after a soft break.
    const pieces = runPieces(element, letterSpacing);
    if (!pieces.length) return [run];
    return pieces.map((piece, index) => ({ ...run, text: piece.text, letterSpacing: piece.letterSpacing, softBreakBefore: run.softBreakBefore && index === 0 }));
}

function readBullet(element: Element, report: Report): Bullet {
    const style = readStyle(element);
    const bullet: Bullet = {
        text: textContent(element),
        face: readFace(element, style),
        size: required(px(take(style, "font-size")), "a bullet's font-size"),
        color: requiredColor(take(style, "color"), "a bullet's color"),
    };
    reportUnread(element, style, [], report, LAYOUT_ONLY.bullet);
    return bullet;
}

function readParagraph(element: Element, report: Report): Paragraph {
    const style = readStyle(element);
    const align = take(style, "text-align") ?? "left";
    if (!ALIGNS.has(align)) report(`text-align '${align}' is not drawn`);
    if (take(style, "direction") === "rtl") report("right-to-left paragraphs are drawn left to right");
    if (attribute(element, "data-tab-stops") !== undefined) report("explicit tab stops are drawn at the default stops");
    const lineHeight = required(px(take(style, "line-height")), "a paragraph's line-height");
    const baseline = required(Number(attribute(element, "data-line-baseline")), "a paragraph's data-line-baseline");
    const optionalBaseline = (name: string) => {
        const value = attribute(element, name);
        return value === undefined ? baseline : required(Number(value), `a paragraph's ${name}`);
    };
    const parts = children(element);
    const bulletElement = parts.find(child => hasClass(child, "text-bullet"));
    const runs = parts.filter(child => hasClass(child, "text-run")).flatMap(child => readRuns(child, report));
    for (const child of parts) if (!hasClass(child, "text-run") && !hasClass(child, "text-bullet") && child.tagName !== "br") report(`<${child.tagName}> in a paragraph is not drawn`);
    const paragraph: Paragraph = {
        runs,
        align: ALIGNS.has(align) ? (align as Align) : "left", // `as`: checked against ALIGNS
        lineHeight,
        baseline,
        markBaseline: optionalBaseline("data-mark-baseline"),
        breakBaseline: optionalBaseline("data-break-baseline"),
        spaceBefore: px(take(style, "margin-top")) ?? 0,
        spaceAfter: px(take(style, "margin-bottom")) ?? 0,
        tabSize: px(take(style, "tab-size")) ?? 0,
        indent: px(take(style, "padding-left")) ?? 0,
        textIndent: px(take(style, "text-indent")) ?? 0,
        ...(bulletElement ? { bullet: readBullet(bulletElement, report) } : {}),
    };
    const bulletAttributes = ["data-bullet-level", "data-bullet-type", "data-bullet-indent", "data-bullet-start", "data-bullet-number-type"];
    reportUnread(element, style, ["data-line-baseline", "data-mark-baseline", "data-break-baseline", "data-tab-stops", ...bulletAttributes], report);
    return paragraph;
}

function readFit(element: Element): Fit {
    const fit = attribute(element, "data-text-fit") ?? "none";
    if (fit !== "shrink") return { kind: fit === "resize" ? "resize" : "none" };
    const number = (name: string) => required(Number(attribute(element, name)), `a shrink box's ${name}`);
    return { kind: "shrink", step: number("data-text-fit-step"), maxSteps: number("data-text-fit-max-steps"), tolerance: number("data-text-fit-tolerance") };
}

/**
 * The text box of `box` (`.slide-text` or `.table-cell-text`), whose style map the caller already read; the text
 * properties are taken out of it. Undefined, after a report, for vertical text.
 */
export function readTextBox(box: Element, style: Style, report: Report): TextBox | undefined {
    const direction = attribute(box, "data-text-direction") ?? "horizontal";
    const anchor = take(style, "align-items") ?? "center";
    const whiteSpace = take(style, "white-space") ?? "pre-wrap";
    take(style, "overflow-wrap");
    if (take(style, "direction") === "rtl") report("right-to-left text boxes are drawn left to right");
    const padding = sides(take(style, "padding")) ?? [0, 0, 0, 0];
    if (direction !== "horizontal") {
        report(`${direction} text is not drawn`);
        return undefined;
    }
    if (!ANCHORS.has(anchor)) report(`align-items '${anchor}' is not drawn`);
    const content = children(box).find(child => hasClass(child, "text-content"));
    if (!content) throw new Error("invalid PdfLapas HTML: a text box has no .text-content");
    const contentStyle = readStyle(content);
    reportUnread(content, contentStyle, [], report, LAYOUT_ONLY.content);
    return {
        paragraphs: children(content).map(paragraph => readParagraph(paragraph, report)),
        padding,
        anchor: ANCHORS.has(anchor) ? (anchor as TextBox["anchor"]) : "center", // `as`: checked against ANCHORS
        wrap: whiteSpace !== "pre",
        fit: readFit(box),
    };
}
