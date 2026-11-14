import type { NormalizedShadow, NormalizedTextBox, NormalizedTextParagraph, NormalizedTextRun } from "@pdfdeck/model";
import { type InlineStyle, styleAttribute } from "./css";
import { type Attribute, element, escapeText, voidElement } from "./markup";
import { shadowInsetAttribute } from "./style";

/** U+200B: the text of an empty run, so an empty PowerPoint paragraph still owns a line box. */
const EMPTY_RUN_TEXT = "\u200B";
/** U+00A0 after the bullet marker: a no-break space, so the marker stays with its first word. */
const BULLET_GAP = "\u00A0";

function shadowCSS(shadow?: NormalizedShadow): string | undefined {
    if (!shadow?.visible) return undefined;
    return `${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px ${shadow.color}`;
}

function fontFamilyCSS(fontFace: string): string {
    const escaped = fontFace.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    // Chromium does not apply LibreOffice's Microsoft-font substitutions to
    // an unknown single-family declaration. Keep the requested face first,
    // then use the same metric-compatible sans fallback used by our fixtures.
    const fallback = fontFace.toLowerCase().startsWith("calibri") ? '"Noto Sans", Arial, "Liberation Sans", sans-serif' : 'Arial, "Liberation Sans", sans-serif';
    return `"${escaped}", ${fallback}`;
}

/** The run's attributes after its link, in the order the profile writes them. */
function runStyleAttributes(run: NormalizedTextRun): Attribute[] {
    const css: InlineStyle = new Map([
        ["font-family", fontFamilyCSS(run.fontFace)],
        ["font-size", `${run.fontSize}px`],
        ["color", run.color],
        ["font-weight", run.bold ? "bold" : "normal"],
        ["font-style", run.italic ? "italic" : "normal"],
    ]);
    const lines: string[] = [];
    if (run.decoration.underline) lines.push("underline");
    if (run.decoration.strike) lines.push("line-through");
    if (lines.length) css.set("text-decoration-line", lines.join(" "));
    css.set("text-decoration-style", run.decoration.underlineStyle);
    if (run.decoration.underlineColor) css.set("text-decoration-color", run.decoration.underlineColor);
    // CSS has one decoration style per box, so the underline style the double strike replaces is kept in data-underline-style.
    if (run.decoration.doubleStrike) css.set("text-decoration-style", "double");
    if (run.baselineOffset) {
        css.set("position", "relative");
        css.set("top", `${-run.baselineOffset}px`);
    }
    if (run.characterSpacing) css.set("letter-spacing", `${run.characterSpacing}px`);
    if (run.highlight) css.set("background-color", run.highlight);
    if (run.outline) css.set("-webkit-text-stroke", `${run.outline.width}px ${run.outline.color}`);
    const glow = shadowCSS(run.glow);
    const shadow = shadowCSS(run.shadow);
    if (glow || shadow) css.set("text-shadow", [glow, shadow].filter(Boolean).join(", "));
    return [
        ["data-double-strike", run.decoration.doubleStrike ? "" : undefined],
        ["data-underline-style", run.decoration.doubleStrike ? run.decoration.underlineStyle : undefined],
        ["data-vertical-align", run.verticalAlign !== "baseline" ? run.verticalAlign : undefined],
        // Names the text-shadow entries in order, so one entry still says whether it is the glow or the shadow.
        ["data-text-shadow", glow || shadow ? [glow && "glow", shadow && "shadow"].filter(Boolean).join(" ") : undefined],
        styleAttribute(css),
        shadowInsetAttribute(run.shadow),
        ["lang", run.language],
    ];
}

function renderRun(run: NormalizedTextRun): string {
    const link = run.link;
    return element(
        link ? "a" : "span",
        [
            ["class", "text-run"],
            ["href", link?.href],
            ["title", link?.tooltip || undefined],
            ["data-slide", link?.slide ? String(link.slide) : undefined],
            ...runStyleAttributes(run),
            // data-empty tells an empty run from a real U+200B.
            ["data-empty", run.text ? undefined : ""],
            ["data-soft-break-before", run.softBreakBefore ? "" : undefined],
        ],
        escapeText(run.text || EMPTY_RUN_TEXT),
    );
}

function paragraphAttributes(paragraph: NormalizedTextParagraph): Attribute[] {
    const css: InlineStyle = new Map([
        ["text-align", paragraph.align],
        ["direction", paragraph.rtl ? "rtl" : "ltr"],
        ["margin-top", `${paragraph.spaceBefore}px`],
        ["margin-bottom", `${paragraph.spaceAfter}px`],
    ]);
    // The line box. The stylesheet's strut and the print step's baseline shift draw it (docs/HTML_PROFILE.md).
    const { lineBox, bullet } = paragraph;
    css.set("line-height", `${lineBox.height}px`);
    // Default stops only: CSS has no explicit tab stops.
    css.set("tab-size", `${paragraph.defaultTabStop}px`);
    if (bullet) {
        const levelIndent = bullet.indent / (bullet.level + 1);
        css.set("padding-left", `${levelIndent * bullet.level}px`);
        css.set("text-indent", "0px");
    }
    return [
        ["class", "text-paragraph"],
        ["data-line-baseline", String(lineBox.baseline)],
        ["data-tab-stops", paragraph.tabStops.length ? paragraph.tabStops.map(stop => `${stop.position}:${stop.alignment}`).join(",") : undefined],
        ["data-bullet-level", bullet ? String(bullet.level) : undefined],
        ["data-bullet-type", bullet?.kind],
        // The marker text and widths only show the result; these keep the model values.
        ["data-bullet-indent", bullet ? String(bullet.indent) : undefined],
        ["data-bullet-start", bullet ? String(bullet.start) : undefined],
        ["data-bullet-number-type", bullet?.numberType || undefined],
        styleAttribute(css),
    ];
}

function renderBulletMarker(paragraph: NormalizedTextParagraph & { bullet: NonNullable<NormalizedTextParagraph["bullet"]> }): string {
    const { bullet } = paragraph;
    const css: InlineStyle = new Map([
        ["display", "inline-block"],
        ["width", `${bullet.indent / (bullet.level + 1)}px`],
    ]);
    const firstRun = paragraph.runs[0];
    if (firstRun) {
        css.set("font-family", fontFamilyCSS(firstRun.fontFace));
        css.set("font-size", `${firstRun.fontSize}px`);
        css.set("color", firstRun.color);
    }
    return element("span", [["class", "text-bullet"], styleAttribute(css)], escapeText(`${bullet.marker}${BULLET_GAP}`));
}

function renderParagraph(paragraph: NormalizedTextParagraph): string {
    let content = paragraph.bullet ? renderBulletMarker({ ...paragraph, bullet: paragraph.bullet }) : "";
    paragraph.runs.forEach((run, index) => {
        // A soft break separates a run from what precedes it in the paragraph; the bullet marker does not count.
        if (run.softBreakBefore && index > 0) content += voidElement("br", []);
        content += renderRun(run);
    });
    return element("div", paragraphAttributes(paragraph), content);
}

/** Adds the text box's declarations to `css`, which the caller writes; returns the box's attributes and its content. */
export function renderText(css: InlineStyle, text: NormalizedTextBox): { attributes: Attribute[]; content: string } {
    const [top, right, bottom, left] = text.margin;
    css.set("padding", `${top}px ${right}px ${bottom}px ${left}px`);
    css.set("align-items", text.verticalAlign === "top" ? "flex-start" : text.verticalAlign === "bottom" ? "flex-end" : "center");
    css.set("white-space", text.wrap ? "pre-wrap" : "pre");
    css.set("overflow-wrap", text.wrap ? "break-word" : "normal");
    css.set("direction", text.rtl ? "rtl" : "ltr");
    css.set("border-radius", `${text.borderRadius}%`);
    if (text.fit === "resize") {
        const minimumHeight = css.get("height");
        css.set("height", "auto");
        if (minimumHeight !== undefined) css.set("min-height", minimumHeight);
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
    const paragraphs = text.paragraphs.map(renderParagraph).join("");
    return {
        attributes: [
            ["data-text-fit", text.fit],
            ["data-text-direction", text.direction],
        ],
        content: element("div", [["class", "text-content"], styleAttribute(contentCss)], paragraphs),
    };
}
