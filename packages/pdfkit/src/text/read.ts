// Reads a text box of the profile (docs/HTML_PROFILE.md "Text") into the values the layout needs. Every inline
// property and data-* attribute the renderer does not draw is reported through `report`, never dropped silently.
import { type Color, color, cssStrings, em, px, readStyle, type Style, sides, take } from "#src/css";
import { attribute, children, type Element, hasClass, isElement, textContent } from "#src/dom";
import { type Effect, glowEffect } from "#src/effect/index";
import type { FaceRequest } from "#src/fonts";

export interface Decoration {
    readonly style: "solid" | "double" | "dashed" | "dotted" | "wavy";
    readonly color: Color;
    /** `text-decoration-thickness: from-font` on an underline: PowerPoint's shapes, on the line's averaged band (draw.ts). */
    readonly fromFont?: boolean;
    /**
     * `text-decoration-thickness: <t>em; text-underline-offset: <o>em` (the model's `underlineBand`): a from-font
     * underline's band in place of the face's `post` band, in em: its top `position` above the baseline (-o), `thickness` t.
     */
    readonly band?: { readonly position: number; readonly thickness: number };
    /** `data-underline-heavy` on a from-font underline: PowerPoint's heavy band. */
    readonly heavy?: boolean;
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
    /** The run's glow: its `text-shadow` entry that `data-text-shadow` names `glow`. */
    readonly glow?: Effect;
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

export interface TabStop {
    readonly position: number;
    readonly alignment: "left" | "right" | "center" | "decimal";
}

export interface Paragraph {
    readonly runs: readonly Run[];
    readonly align: Align;
    /** `direction: rtl`: each line's words run right to left. */
    readonly rtl: boolean;
    readonly lineHeight: number;
    readonly baseline: number;
    readonly markBaseline: number;
    readonly breakBaseline: number;
    readonly spaceBefore: number;
    readonly spaceAfter: number;
    readonly tabSize: number;
    /** `data-tab-stops`, px from the text area's left edge, in order. */
    readonly tabStops: readonly TabStop[];
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
const TAB_ALIGNS: ReadonlySet<string> = new Set(["left", "right", "center", "decimal"]);
const DIRECTIONS: ReadonlySet<string> = new Set(["ltr", "rtl"]);
/** Letters of the right-to-left scripts (Hebrew, Arabic, Syriac, Thaana, NKo, …, and their presentation forms). */
const RTL_LETTER = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
/** A letter of any other script: a strong left-to-right character. */
const LTR_LETTER = /(?![\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF])\p{L}/u;
const ANCHORS: ReadonlySet<string> = new Set(["flex-start", "center", "flex-end"]);
const DECORATION_STYLES: ReadonlySet<string> = new Set(["solid", "double", "dashed", "dotted", "wavy"]);
/**
 * Chromium's synthetic styles, the default for HTML that does not state them: pdf-core's
 * CHROMIUM_SYNTHETIC_BOLD_STROKE_EM and CHROMIUM_SYNTHETIC_ITALIC_SHEAR, measured in Chromium's PDF output.
 */
const BROWSER_SYNTHESIS: Synthesis = Object.freeze({ boldStroke: 1 / 32, italicShear: 0.25 });
/** U+002D then U+2060 WORD JOINER: a U+2011 in a run with `data-non-breaking-hyphen`, drawn with the face's hyphen and still unbreakable. */
const HYPHEN_MINUS_NO_BREAK = "-\u2060";
const NON_BREAKING_HYPHEN = /\u2011/g;
/** The value of each underline geometry property that the renderer draws. */
const UNDERLINE_FROM_FONT = Object.freeze([
    ["text-decoration-thickness", "from-font"],
    ["text-underline-position", "from-font"],
    ["text-decoration-skip-ink", "none"],
] as const);
/** Layout CSS that `toHtml()` writes for Chromium and that states no drawn value of its own. */
const LAYOUT_ONLY: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
    content: new Set(["width"]),
    bullet: new Set(["display", "width"]),
});

/** Reports the properties left in `style` and the data-* attributes not in `read`. */
export function reportUnread(element: Element, style: Style, read: readonly string[], report: Report, ignored: ReadonlySet<string> = new Set()): void {
    for (const [property, value] of style) {
        if (!ignored.has(property)) {
            report(`CSS property '${property}: ${value}' on <${element.tagName}> is not drawn`);
        }
    }

    for (const { name } of element.attrs) {
        if (name.startsWith("data-") && !read.includes(name)) {
            report(`attribute '${name}' on <${element.tagName}> is not drawn`);
        }
    }
}

function required(value: number | undefined, what: string): number {
    if (value === undefined || !Number.isFinite(value)) {
        throw new Error(`invalid PdfLapas HTML: ${what} is missing or not a number`);
    }

    return value;
}

function requiredColor(value: string | undefined, what: string): Color {
    const parsed = color(value);

    if (!parsed) {
        throw new Error(`invalid PdfLapas HTML: ${what} '${value ?? ""}' is missing or not a color the renderer reads (#rgb, #rrggbb, rgb(), rgba())`);
    }

    return parsed;
}

/** `value` as a color, or reported as one the renderer does not read. */
function readColor(value: string, what: string, report: Report): { kind: "color"; color: Color } | { kind: "invalid" } {
    const parsed = color(value);

    if (!parsed) {
        report(`${what} '${value}' is not a color the renderer reads`);

        return { kind: "invalid" };
    }

    return { kind: "color", color: parsed };
}

function readFace(element: Element, style: Style): FaceRequest {
    const value = take(style, "font-family") ?? "";
    const [family, ...fallbacks] = cssStrings(value) ?? [];

    if (family === undefined) {
        throw new Error(`invalid PdfLapas HTML: font-family '${value}' on <${element.tagName}> is not one or more quoted families separated by ', '`);
    }

    const lang = attribute(element, "lang");

    return { family, fallbacks, ...(lang ? { lang } : {}), bold: take(style, "font-weight") === "bold", italic: take(style, "font-style") === "italic" };
}

/** `text-shadow` entries: commas inside `rgba(...)` do not separate them. */
const SHADOW_ENTRY = /[^,(]+(?:\([^)]*\)[^,(]*)*/g;

/**
 * The text box of `box` (`.slide-text` or `.table-cell-text`), whose style map the caller already read; the text
 * properties are taken out of it. Undefined, after a report, for vertical text.
 */
// eslint-disable-next-line pdflapas/no-nullable-return -- phase 2 (#425)
export function readTextBox(box: Element, style: Style, report: Report): TextBox | undefined {
    const direction = attribute(box, "data-text-direction") ?? "horizontal";
    const anchor = take(style, "align-items") ?? "center";
    const whiteSpace = take(style, "white-space") ?? "pre-wrap";

    take(style, "overflow-wrap");
    take(style, "direction"); // each paragraph repeats it, and pdf-core reads it there only
    const padding = sides(take(style, "padding")) ?? [0, 0, 0, 0];

    if (direction !== "horizontal") {
        report(`${direction} text is not drawn`);

        return undefined;
    }

    if (!ANCHORS.has(anchor)) {
        report(`align-items '${anchor}' is not drawn`);
    }

    const content = children(box).find(child => hasClass(child, "text-content"));

    if (!content) {
        throw new Error("invalid PdfLapas HTML: a text box has no .text-content");
    }

    const contentStyle = readStyle(content);

    reportUnread(content, contentStyle, [], report, LAYOUT_ONLY.content);
    const paragraphs: Paragraph[] = [];

    for (const paragraphElement of children(content)) {
        const paragraphStyle = readStyle(paragraphElement);
        const align = take(paragraphStyle, "text-align") ?? "left";

        if (!ALIGNS.has(align)) {
            report(`text-align '${align}' is not drawn`);
        }

        const paragraphDirection = take(paragraphStyle, "direction") ?? "ltr";

        if (!DIRECTIONS.has(paragraphDirection)) {
            throw new Error(`invalid PdfLapas HTML: a paragraph's direction is '${paragraphDirection}', expected ltr or rtl`);
        }

        const rtl = paragraphDirection === "rtl";
        const lineHeight = required(px(take(paragraphStyle, "line-height")), "a paragraph's line-height");
        const baseline = required(Number(attribute(paragraphElement, "data-line-baseline")), "a paragraph's data-line-baseline");
        const optionalBaseline = (name: string) => {
            const value = attribute(paragraphElement, name);

            return value === undefined ? baseline : required(Number(value), `a paragraph's ${name}`);
        };
        const parts = children(paragraphElement);
        const bulletElement = parts.find(child => hasClass(child, "text-bullet"));
        const runs: Run[] = [];

        for (const child of parts) {
            if (!hasClass(child, "text-run")) {
                continue;
            }

            const runStyle = readStyle(child);
            const runColor = requiredColor(take(runStyle, "color"), "a run's color");
            const href = attribute(child, "href");
            const slide = attribute(child, "data-slide");
            const position = take(runStyle, "position");
            const shift = px(take(runStyle, "top")) ?? 0;

            if (position !== undefined && position !== "relative") {
                report(`position '${position}' on a run is not drawn`);
            }

            const highlightValue = take(runStyle, "background-color");
            const highlight = highlightValue === undefined ? { kind: "none" as const } : readColor(highlightValue, "background-color", report);
            const letterSpacing = px(take(runStyle, "letter-spacing")) ?? 0;
            // The run's glow from `text-shadow`, whose entries `data-text-shadow` names in order. The `shadow` entry is the
            // object's shadow, which slide.ts draws from the box's `box-shadow` (pdf-core skips it the same way).
            const shadow = take(runStyle, "text-shadow");
            let glow: Effect | undefined;

            if (attribute(child, "data-shadow-inset") !== undefined) {
                report("inner shadow not rendered");
            }

            if (shadow !== undefined) {
                const names = (attribute(child, "data-text-shadow") ?? "").split(/\s+/).filter(Boolean);
                const entries: string[] = [];

                for (const entry of shadow.match(SHADOW_ENTRY) ?? []) {
                    const trimmed = entry.trim();

                    if (trimmed) {
                        entries.push(trimmed);
                    }
                }

                if (names.length !== entries.length) {
                    report(`text-shadow '${shadow}' has ${entries.length} entries but data-text-shadow names ${names.length}; not drawn`);
                } else {
                    for (const [index, name] of names.entries()) {
                        const entry = entries[index] ?? "";

                        if (name === "shadow") {
                            continue;
                        }

                        const effect = name === "glow" ? glowEffect(entry) : `text-shadow entry '${entry}' named '${name}' (not glow or shadow) is not drawn`;

                        if (typeof effect === "string") {
                            report(effect);
                        } else {
                            glow = effect;
                        }
                    }
                }
            }

            const face = readFace(child, runStyle);
            const size = required(px(take(runStyle, "font-size")), "a run's font-size");
            const kerning = take(runStyle, "font-kerning") !== "none";
            // The run's underline and strikethrough.
            const decorationLines = (take(runStyle, "text-decoration-line") ?? "").split(/\s+/);
            const cssStyle = take(runStyle, "text-decoration-style") ?? "solid";
            const decorationColorValue = take(runStyle, "text-decoration-color");
            const decorationColorRead = decorationColorValue === undefined ? { kind: "none" as const } : readColor(decorationColorValue, "text-decoration-color", report);
            const decorationColor = decorationColorRead.kind === "color" ? decorationColorRead.color : runColor;
            // A caller's underline band (`underlineBand`): `text-underline-offset` and `text-decoration-thickness` in em,
            // without `text-underline-position`; both taken from the style. None without an offset; any other form is reported.
            const offset = take(runStyle, "text-underline-offset");
            let band: Decoration["band"];

            if (offset !== undefined) {
                const thickness = runStyle.get("text-decoration-thickness");
                const [offsetEm, thicknessEm] = [em(offset), em(thickness)];

                if (offsetEm === undefined || thicknessEm === undefined || thicknessEm <= 0 || runStyle.has("text-underline-position")) {
                    report(`CSS property 'text-underline-offset: ${offset}' is not drawn: an underline band is '<n>em' with 'text-decoration-thickness' a positive '<n>em' and no 'text-underline-position'`);
                } else {
                    runStyle.delete("text-decoration-thickness");
                    band = { position: -offsetEm, thickness: thicknessEm };
                }
            }

            // The underline is always drawn from the face's post table, or the band above, over the descenders (draw.ts); any
            // other value is reported.
            const fromFontSet: boolean[] = [];

            for (const [property, drawn] of UNDERLINE_FROM_FONT) {
                const value = take(runStyle, property);

                if (value !== undefined && value !== drawn) {
                    report(`CSS property '${property}: ${value}' is not drawn (drawn as ${drawn})`);
                }

                fromFontSet.push(value !== undefined);
            }

            const fromFont = fromFontSet[0] || band !== undefined;
            const heavyAttribute = attribute(child, "data-underline-heavy") !== undefined;

            if (heavyAttribute && !fromFont) {
                report("attribute 'data-underline-heavy' without 'text-decoration-thickness: from-font' is not drawn (drawn at the normal thickness)");
            }

            const heavy = heavyAttribute && fromFont;
            const doubleStrike = attribute(child, "data-double-strike") !== undefined;
            // A double strike takes text-decoration-style; the underline's own style is then in data-underline-style.
            const underlineStyle = (doubleStrike ? attribute(child, "data-underline-style") : cssStyle) ?? "solid";
            const decoration = (kind: string, styleName: string): Decoration => {
                if (DECORATION_STYLES.has(styleName)) {
                    return { style: styleName as Decoration["style"], color: kind === "underline" ? decorationColor : runColor };
                } // `as`: checked against DECORATION_STYLES

                report(`${kind} style '${styleName}' is not drawn (drawn solid)`);

                return { style: "solid", color: decorationColor };
            };
            const decorations: Pick<Run, "underline" | "strike"> = {
                ...(decorationLines.includes("underline") ? { underline: { ...decoration("underline", underlineStyle), ...(fromFont ? { fromFont } : {}), ...(band ? { band } : {}), ...(heavy ? { heavy } : {}) } } : {}),
                ...(decorationLines.includes("line-through") || doubleStrike ? { strike: decoration("strike", doubleStrike ? "double" : "solid") } : {}),
            };
            // `-webkit-text-stroke: <width>px <color>`; any other value is reported.
            const hasOutline = runStyle.has("-webkit-text-stroke");
            const stroke = take(runStyle, "-webkit-text-stroke");
            let outline: Run["outline"];

            if (stroke !== undefined) {
                const space = stroke.indexOf(" ");
                const width = px(stroke.slice(0, space));
                const outlineColor = color(stroke.slice(space + 1));

                if (width === undefined || !outlineColor) {
                    report(`-webkit-text-stroke '${stroke}' is not drawn`);
                } else {
                    outline = { width, color: outlineColor };
                }
            }

            // How the run is drawn when its face has no bold or italic style (`data-synthetic-bold`, `data-synthetic-italic`).
            const syntheticNumber = (name: string, fallback: number) => {
                const value = attribute(child, name);

                if (value === undefined) {
                    return fallback;
                }

                const parsed = Number(value);

                if (value.trim() === "" || !Number.isFinite(parsed)) {
                    throw new Error(`invalid PdfLapas HTML: attribute '${name}' '${value}' is not a number`);
                }

                return parsed;
            };
            const boldStroke = syntheticNumber("data-synthetic-bold", BROWSER_SYNTHESIS.boldStroke);

            if (boldStroke < 0) {
                throw new Error(`invalid PdfLapas HTML: attribute 'data-synthetic-bold' ${boldStroke} is negative`);
            }

            const run: Run = {
                text: textContent(child),
                face,
                size,
                color: runColor,
                letterSpacing,
                kerning,
                ...decorations,
                shift,
                ...(highlight.kind === "color" && highlight.color.alpha > 0 ? { highlight: highlight.color } : {}),
                ...(hasOutline ? { outline } : {}),
                ...(href !== undefined || slide !== undefined ? { link: { ...(href !== undefined ? { href } : {}), ...(slide !== undefined ? { slide: Number(slide) } : {}) } } : {}),
                softBreakBefore: attribute(child, "data-soft-break-before") !== undefined,
                synthesis: { boldStroke, italicShear: syntheticNumber("data-synthetic-italic", BROWSER_SYNTHESIS.italicShear) },
                ...(glow ? { glow } : {}),
            };
            const read = ["data-double-strike", "data-underline-style", "data-underline-heavy", "data-vertical-align", "data-empty", "data-soft-break-before", "data-slide", "data-text-shadow", "data-shadow-inset"];

            reportUnread(child, runStyle, [...read, "data-synthetic-bold", "data-synthetic-italic", "data-non-breaking-hyphen"], report);
            // The run's text in pieces of one `letter-spacing` each: its bare text at the run's, each word span
            // (`<span style="letter-spacing: ...">`, text only) at its own. U+2011 becomes U+002D U+2060 under `data-non-breaking-hyphen`.
            const hyphen = attribute(child, "data-non-breaking-hyphen");

            if (hyphen !== undefined && hyphen !== "hyphen-minus") {
                throw new Error(`invalid PdfLapas HTML: attribute 'data-non-breaking-hyphen' '${hyphen}' is not hyphen-minus`);
            }

            const hyphenated = (value: string) => (hyphen === undefined ? value : value.replace(NON_BREAKING_HYPHEN, HYPHEN_MINUS_NO_BREAK));
            const pieces: { text: string; letterSpacing: number; word: boolean }[] = [];

            for (const node of child.childNodes) {
                if (!isElement(node)) {
                    const value = "value" in node ? node.value : "";
                    const last = pieces.at(-1);

                    // Bare text pieces next to each other share the run's spacing.
                    if (last && !last.word) {
                        last.text += hyphenated(value);
                    } else {
                        pieces.push({ text: hyphenated(value), letterSpacing, word: false });
                    }

                    continue;
                }

                const spanStyle = readStyle(node);
                const spacing = px(take(spanStyle, "letter-spacing"));

                if (node.tagName !== "span" || node.attrs.length !== 1 || spacing === undefined || spanStyle.size || node.childNodes.some(isElement)) {
                    throw new Error(`invalid PdfLapas HTML: <${node.tagName}> inside a run; a run holds text and word spans, <span style="letter-spacing: <n>px;"> with text only`);
                }

                pieces.push({ text: hyphenated(textContent(node)), letterSpacing: spacing, word: true });
            }

            // One run per piece of one letter-spacing; only the first starts after a soft break.
            const drawnPieces = pieces.filter(piece => piece.text);

            if (!drawnPieces.length) {
                runs.push(run);
            } else {
                for (const [index, piece] of drawnPieces.entries()) {
                    runs.push({ ...run, text: piece.text, letterSpacing: piece.letterSpacing, softBreakBefore: run.softBreakBefore && index === 0 });
                }
            }
        }

        for (const child of parts) {
            if (!hasClass(child, "text-run") && !hasClass(child, "text-bullet") && child.tagName !== "br") {
                report(`<${child.tagName}> in a paragraph is not drawn`);
            }
        }

        const text = runs.map(run => run.text).join("");

        // shortcut: no Unicode bidi algorithm, so a paragraph's words run in its direction; port one (or take pdf-core's
        // parley order) when a deck mixes directions.
        if (rtl ? LTR_LETTER.test(text) : RTL_LETTER.test(text)) {
            report(`${rtl ? "left-to-right words in a right-to-left" : "right-to-left words in a left-to-right"} paragraph are ordered in the paragraph's direction`);
        }

        if (rtl && text.includes("\t")) {
            report("tab stops in right-to-left paragraphs measured from the left");
        }

        const markBaseline = optionalBaseline("data-mark-baseline");
        const breakBaseline = optionalBaseline("data-break-baseline");
        // `data-tab-stops="<position>:<left|right|center|decimal>,…"`.
        const tabStopsValue = attribute(paragraphElement, "data-tab-stops");
        const tabStops: TabStop[] = [];

        if (tabStopsValue !== undefined) {
            for (const stop of tabStopsValue.split(",")) {
                const [stopPosition, alignment = ""] = stop.split(":");
                const parsed = Number(stopPosition);

                if (!stopPosition?.trim() || !Number.isFinite(parsed) || !TAB_ALIGNS.has(alignment)) {
                    throw new Error(`invalid PdfLapas HTML: attribute 'data-tab-stops': '${stop}' is not '<position>:<left|right|center|decimal>'`);
                }

                tabStops.push({ position: parsed, alignment: alignment as TabStop["alignment"] }); // `as`: checked against TAB_ALIGNS
            }
        }

        let bullet: Bullet | undefined;

        if (bulletElement) {
            const bulletStyle = readStyle(bulletElement);

            bullet = {
                text: textContent(bulletElement),
                face: readFace(bulletElement, bulletStyle),
                size: required(px(take(bulletStyle, "font-size")), "a bullet's font-size"),
                color: requiredColor(take(bulletStyle, "color"), "a bullet's color"),
            };
            reportUnread(bulletElement, bulletStyle, [], report, LAYOUT_ONLY.bullet);
        }

        const paragraph: Paragraph = {
            runs,
            align: ALIGNS.has(align) ? (align as Align) : "left", // `as`: checked against ALIGNS
            rtl,
            lineHeight,
            baseline,
            markBaseline,
            breakBaseline,
            spaceBefore: px(take(paragraphStyle, "margin-top")) ?? 0,
            spaceAfter: px(take(paragraphStyle, "margin-bottom")) ?? 0,
            tabSize: px(take(paragraphStyle, "tab-size")) ?? 0,
            tabStops,
            indent: px(take(paragraphStyle, "padding-left")) ?? 0,
            textIndent: px(take(paragraphStyle, "text-indent")) ?? 0,
            ...(bullet ? { bullet } : {}),
        };
        const bulletAttributes = ["data-bullet-level", "data-bullet-type", "data-bullet-indent", "data-bullet-start", "data-bullet-number-type"];

        reportUnread(paragraphElement, paragraphStyle, ["data-line-baseline", "data-mark-baseline", "data-break-baseline", "data-tab-stops", ...bulletAttributes], report);
        paragraphs.push(paragraph);
    }

    const fitValue = attribute(box, "data-text-fit") ?? "none";
    let fit: Fit;

    if (fitValue !== "shrink") {
        fit = { kind: fitValue === "resize" ? "resize" : "none" };
    } else {
        const number = (name: string) => required(Number(attribute(box, name)), `a shrink box's ${name}`);

        fit = { kind: "shrink", step: number("data-text-fit-step"), maxSteps: number("data-text-fit-max-steps"), tolerance: number("data-text-fit-tolerance") };
    }

    return {
        paragraphs,
        padding,
        anchor: ANCHORS.has(anchor) ? (anchor as TextBox["anchor"]) : "center", // `as`: checked against ANCHORS
        wrap: whiteSpace !== "pre",
        fit,
    };
}
