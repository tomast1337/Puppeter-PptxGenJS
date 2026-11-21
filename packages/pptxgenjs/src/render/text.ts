import type { NormalizedShadow, NormalizedTextBox, NormalizedTextParagraph, NormalizedTextRun } from "@pdflapas/model";
import { PPTX_DEFAULTS } from "#src/defaults";
import { isSpaces, isWord, runPieces } from "#src/normalize/advanceGrid";
import { type InlineStyle, styleAttribute } from "./css";
import { type Attribute, element, escapeText, type Html, voidElement } from "./markup";
import { shadowInsetAttribute } from "./style";

/** U+200B: the text of an empty run, so an empty PowerPoint paragraph still owns a line box. */
const EMPTY_RUN_TEXT = "\u200B";
/** U+00A0 after the bullet marker: a no-break space, so the marker stays with its first word. */
const BULLET_GAP = "\u00A0";

/** A glow or shadow as a CSS text-shadow entry; "none" when it is not visible. */
function shadowCSS(shadow?: NormalizedShadow): { kind: "shadow"; css: string } | { kind: "none" } {
    if (!shadow?.visible) {
        return { kind: "none" };
    }

    return { kind: "shadow", css: `${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px ${shadow.color}` };
}

/** The face, then the run's fallback faces; the Puppeteer print step appends Chromium's own fallback list (docs/HTML_PROFILE.md). */
export function fontFamilyCSS(fontFace: string, fallbackFaces: readonly string[] = []): string {
    return [fontFace, ...fallbackFaces].map(face => `"${face.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(", ");
}

export function alignItemsCSS(verticalAlign: NormalizedTextBox["verticalAlign"]): string {
    return verticalAlign === "top" ? "flex-start" : verticalAlign === "bottom" ? "flex-end" : "center";
}

/** The shrink-to-fit rule a `data-text-fit="shrink"` box carries, so every renderer applies the same one. */
export function shrinkAttributes(): (readonly [name: string, value: string])[] {
    const { step, maxSteps, tolerancePx } = PPTX_DEFAULTS.text.shrink;

    return [
        ["data-text-fit-step", String(step)],
        ["data-text-fit-max-steps", String(maxSteps)],
        ["data-text-fit-tolerance", String(tolerancePx)],
    ];
}

/** Adds the text box's declarations to `css`, which the caller writes; returns the box's attributes and its content. */
export function renderText(css: InlineStyle, text: NormalizedTextBox): { attributes: Attribute[]; content: Html } {
    const [top, right, bottom, left] = text.margin;

    css.set("padding", `${top}px ${right}px ${bottom}px ${left}px`);
    css.set("align-items", alignItemsCSS(text.verticalAlign));
    css.set("white-space", text.wrap ? "pre-wrap" : "pre");
    css.set("overflow-wrap", text.wrap ? "break-word" : "normal");
    css.set("direction", text.rtl ? "rtl" : "ltr");

    // shortcut: the box grows to the text, while PowerPoint and LibreOffice draw an <a:spAutoFit/> box at its stored
    // size; keep the size once a migration needs the PowerPoint layout rather than the text in full.
    if (text.fit === "resize") {
        const minimumHeight = css.get("height");

        css.set("height", "auto");

        if (minimumHeight !== undefined) {
            css.set("min-height", minimumHeight);
        }

        css.set("overflow", "visible");
    } else if (!text.wrap) {
        // PptxGenJS emits `wrap="none"`, which allows a single line to paint
        // outside the text-box bounds while the slide itself remains clipped.
        css.set("overflow", "visible");
    }

    const contentCss: InlineStyle = new Map([["width", "100%"]]);

    if (text.direction !== "horizontal") {
        contentCss.set("writing-mode", text.direction === "vertical270" ? "vertical-rl" : "vertical-lr");
        contentCss.set("text-orientation", text.direction === "stacked" ? "upright" : "mixed");
        contentCss.set("height", "100%");
    }

    const paragraphs: Html[] = [];

    for (const paragraph of text.paragraphs) {
        const { lineBox, bullet } = paragraph;
        const content: Html[] = [];

        // The bullet marker, in the first run's font.
        if (bullet) {
            const markerCss: InlineStyle = new Map([
                ["display", "inline-block"],
                ["width", `${bullet.indent / (bullet.level + 1)}px`],
            ]);
            const firstRun = paragraph.runs[0];

            if (firstRun) {
                markerCss.set("font-family", fontFamilyCSS(firstRun.fontFace, firstRun.fallbackFaces));
                markerCss.set("font-size", `${firstRun.fontSize}px`);
                markerCss.set("color", firstRun.color);
            }

            content.push(element("span", [["class", "text-bullet"], styleAttribute(markerCss)], escapeText(`${bullet.marker}${BULLET_GAP}`)));
        }

        for (const [index, run] of paragraph.runs.entries()) {
            // A soft break separates a run from what precedes it in the paragraph; the bullet marker does not count.
            if (run.softBreakBefore && index > 0) {
                content.push(voidElement("br", []));
            }

            // The run's attributes after its link, in the order the profile writes them.
            const runCss: InlineStyle = new Map([
                ["font-family", fontFamilyCSS(run.fontFace, run.fallbackFaces)],
                ["font-size", `${run.fontSize}px`],
                ["color", run.color],
                ["font-weight", run.bold ? "bold" : "normal"],
                ["font-style", run.italic ? "italic" : "normal"],
            ]);
            const lines: string[] = [];

            if (run.decoration.underline) {
                lines.push("underline");
            }

            if (run.decoration.strike) {
                lines.push("line-through");
            }

            if (lines.length) {
                runCss.set("text-decoration-line", lines.join(" "));
            }

            runCss.set("text-decoration-style", run.decoration.underlineStyle);

            if (run.decoration.underlineColor) {
                runCss.set("text-decoration-color", run.decoration.underlineColor);
            }

            // The face's post table band, which Chromium draws only when told (target/powerpoint.ts `underlineFromFont`), or the
            // caller's band in its place (`underlineBand`): CSS's offset is the band's top below the baseline.
            if (run.decoration.underlineFromFont) {
                const band = run.decoration.underlineBand;

                runCss.set("text-decoration-thickness", band ? `${band.thickness}em` : "from-font");

                if (band) {
                    runCss.set("text-underline-offset", `${-band.position}em`);
                } else {
                    runCss.set("text-underline-position", "from-font");
                }

                runCss.set("text-decoration-skip-ink", "none");
            }

            // CSS has one decoration style per box, so the underline style the double strike replaces is kept in data-underline-style.
            if (run.decoration.doubleStrike) {
                runCss.set("text-decoration-style", "double");
            }

            if (run.baselineOffset) {
                runCss.set("position", "relative");
                runCss.set("top", `${-run.baselineOffset}px`);
            }

            if (run.characterSpacing) {
                runCss.set("letter-spacing", `${run.characterSpacing}px`);
            }

            if (run.kerning === false) {
                runCss.set("font-kerning", "none");
            }

            if (run.highlight) {
                runCss.set("background-color", run.highlight);
            }

            if (run.outline) {
                runCss.set("-webkit-text-stroke", `${run.outline.width}px ${run.outline.color}`);
            }

            const glow = shadowCSS(run.glow);
            const shadow = shadowCSS(run.shadow);
            const textShadows: string[] = [];
            const textShadowNames: string[] = [];

            if (glow.kind === "shadow") {
                textShadows.push(glow.css);
                textShadowNames.push("glow");
            }

            if (shadow.kind === "shadow") {
                textShadows.push(shadow.css);
                textShadowNames.push("shadow");
            }

            if (textShadows.length) {
                runCss.set("text-shadow", textShadows.join(", "));
            }

            // The run's text, each word in a span of its own letter-spacing when the run has `wordCharacterSpacing`; the
            // spaces and tabs between stay in the run, with its letter-spacing, except a stretch of spaces whose
            // `spaceCharacterSpacing` differs from it, in a span of its own.
            const spacings = run.wordCharacterSpacing;
            let runContent: Html | Html[];

            if (!spacings) {
                runContent = escapeText(run.text || EMPTY_RUN_TEXT);
            } else {
                const span = (spacing: number, piece: string) => element("span", [styleAttribute(new Map([["letter-spacing", `${spacing}px`]]))], escapeText(piece));
                const pieces: Html[] = [];
                let word = 0;
                let spaces = 0;

                for (const piece of runPieces(run.text)) {
                    if (isSpaces(piece) && run.spaceCharacterSpacing) {
                        const spacing = run.spaceCharacterSpacing[spaces++];

                        if (spacing === undefined) {
                            throw new Error(`A text run has ${run.spaceCharacterSpacing.length} spaceCharacterSpacing values but more stretches of spaces: "${run.text}"; give one value per stretch`);
                        }

                        pieces.push(spacing === run.characterSpacing ? escapeText(piece) : span(spacing, piece));
                        continue;
                    }

                    if (!isWord(piece)) {
                        pieces.push(escapeText(piece));
                        continue;
                    }

                    const spacing = spacings[word++];

                    if (spacing === undefined) {
                        throw new Error(`A text run has ${spacings.length} wordCharacterSpacing values but more words: "${run.text}"; give one value per word`);
                    }

                    pieces.push(span(spacing, piece));
                }

                runContent = pieces;
            }

            const link = run.link;

            content.push(
                element(
                    link ? "a" : "span",
                    [
                        ["class", "text-run"],
                        ["href", link?.href],
                        ["title", link?.tooltip || undefined],
                        ["data-slide", link?.slide ? String(link.slide) : undefined],
                        ["data-double-strike", run.decoration.doubleStrike ? "" : undefined],
                        ["data-underline-style", run.decoration.doubleStrike ? run.decoration.underlineStyle : undefined],
                        ["data-underline-heavy", run.decoration.underlineHeavy ? "" : undefined],
                        ["data-vertical-align", run.verticalAlign !== "baseline" ? run.verticalAlign : undefined],
                        ["data-synthetic-bold", run.syntheticBold === undefined ? undefined : String(run.syntheticBold)],
                        ["data-synthetic-italic", run.syntheticItalic === undefined ? undefined : String(run.syntheticItalic)],
                        ["data-non-breaking-hyphen", run.nonBreakingHyphen],
                        // Names the text-shadow entries in order, so one entry still says whether it is the glow or the shadow.
                        ["data-text-shadow", textShadowNames.length ? textShadowNames.join(" ") : undefined],
                        styleAttribute(runCss),
                        shadowInsetAttribute(run.shadow),
                        ["lang", run.language],
                        // data-empty tells an empty run from a real U+200B.
                        ["data-empty", run.text ? undefined : ""],
                        ["data-soft-break-before", run.softBreakBefore ? "" : undefined],
                    ],
                    runContent,
                ),
            );
        }

        const paragraphCss: InlineStyle = new Map([["text-align", paragraph.align], ...(paragraph.textJustify ? ([["text-justify", paragraph.textJustify]] as const) : []), ["direction", paragraph.rtl ? "rtl" : "ltr"], ["margin-top", `${paragraph.spaceBefore}px`], ["margin-bottom", `${paragraph.spaceAfter}px`]]);

        // The line box. The stylesheet's strut and the print step's baseline shift draw it (docs/HTML_PROFILE.md).
        paragraphCss.set("line-height", `${lineBox.height}px`);
        // Default stops only: CSS has no explicit tab stops.
        // shortcut: Chromium has only `tab-size`, so the Puppeteer renderer ignores data-tab-stops (the WASM one draws
        // them); lay the stops out in the print step once a reference renderer shows them (LibreOffice drops the list).
        paragraphCss.set("tab-size", `${paragraph.defaultTabStop}px`);

        if (bullet) {
            // PptxGenJS writes marL = indent and indent = -levelIndent: wrapped lines hang under the first line's text.
            paragraphCss.set("padding-left", `${bullet.indent}px`);
            paragraphCss.set("text-indent", `${-bullet.indent / (bullet.level + 1)}px`);
        }

        paragraphs.push(
            element(
                "div",
                [
                    ["class", "text-paragraph"],
                    ["data-line-baseline", String(lineBox.baseline)],
                    ["data-mark-baseline", lineBox.markBaseline === undefined ? undefined : String(lineBox.markBaseline)],
                    ["data-break-baseline", lineBox.breakBaseline === undefined ? undefined : String(lineBox.breakBaseline)],
                    ["data-tab-stops", paragraph.tabStops.length ? paragraph.tabStops.map(stop => `${stop.position}:${stop.alignment}`).join(",") : undefined],
                    ["data-bullet-level", bullet ? String(bullet.level) : undefined],
                    ["data-bullet-type", bullet?.kind],
                    // The marker text and widths only show the result; these keep the model values.
                    ["data-bullet-indent", bullet ? String(bullet.indent) : undefined],
                    ["data-bullet-start", bullet ? String(bullet.start) : undefined],
                    ["data-bullet-number-type", bullet?.numberType || undefined],
                    styleAttribute(paragraphCss),
                ],
                content,
            ),
        );
    }

    return {
        attributes: [["data-text-fit", text.fit], ...(text.fit === "shrink" ? shrinkAttributes() : []), ["data-text-direction", text.direction]],
        content: element("div", [["class", "text-content"], styleAttribute(contentCss)], paragraphs),
    };
}
