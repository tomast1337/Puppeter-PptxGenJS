import type { NormalizedShadow, NormalizedTextBox, NormalizedTextParagraph, NormalizedTextRun } from "@pdfdeck/model";
import { type InlineStyle, writeStyle } from "./css";

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

function applyRunStyle(element: HTMLElement, run: NormalizedTextRun): void {
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
    if (run.decoration.doubleStrike) css.set("text-decoration-style", "double");
    // Glyphs must not size the line box; the paragraph's strut does (applyParagraphStyle).
    css.set("line-height", "0");
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
    writeStyle(element, css);
    element.lang = run.language;
}

function renderRun(document: Document, run: NormalizedTextRun): HTMLElement {
    const element = run.link ? document.createElement("a") : document.createElement("span");
    element.className = "text-run";
    if (run.link) {
        const anchor = element as HTMLAnchorElement;
        anchor.href = run.link.href;
        if (run.link.tooltip) anchor.title = run.link.tooltip;
        if (run.link.slide) anchor.dataset.slide = String(run.link.slide);
    }
    applyRunStyle(element, run);
    // An empty PowerPoint paragraph still owns a line box.
    element.textContent = run.text || "​";
    return element;
}

function applyParagraphStyle(element: HTMLDivElement, paragraph: NormalizedTextParagraph, horizontal: boolean): void {
    const css: InlineStyle = new Map([
        ["text-align", paragraph.align],
        ["direction", paragraph.rtl ? "rtl" : "ltr"],
        ["margin-top", `${paragraph.spaceBefore}px`],
        ["margin-bottom", `${paragraph.spaceAfter}px`],
    ]);
    // A 0px font makes each line's strut exactly `height` tall with its baseline in the middle, whatever
    // the fonts' ascent and descent; runs have line-height 0, so the strut alone sizes the line. Moving
    // the paragraph then puts every baseline where LibreOffice puts it.
    const { lineBox } = paragraph;
    css.set("font-size", "0px");
    css.set("line-height", `${lineBox.height}px`);
    // shortcut: vertical text keeps the centred baseline; shift along the block axis once it is measured.
    if (horizontal) {
        css.set("position", "relative");
        css.set("top", `${lineBox.baseline - lineBox.height / 2}px`);
    }
    // Default stops only: CSS has no explicit tab stops.
    css.set("tab-size", `${paragraph.defaultTabStop}px`);
    if (paragraph.tabStops.length) {
        element.dataset.tabStops = paragraph.tabStops.map(stop => `${stop.position}:${stop.alignment}`).join(",");
    }
    if (paragraph.bullet) {
        const levelIndent = paragraph.bullet.indent / (paragraph.bullet.level + 1);
        css.set("padding-left", `${levelIndent * paragraph.bullet.level}px`);
        css.set("text-indent", "0px");
        element.dataset.bulletLevel = String(paragraph.bullet.level);
        element.dataset.bulletType = paragraph.bullet.kind;
    }
    writeStyle(element, css);
}

/** Adds the text box's declarations to `css`, which the caller writes onto `element`, and appends its content. */
export function renderText(document: Document, element: HTMLElement, css: InlineStyle, text: NormalizedTextBox): void {
    const [top, right, bottom, left] = text.margin;
    css.set("padding", `${top}px ${right}px ${bottom}px ${left}px`);
    css.set("align-items", text.verticalAlign === "top" ? "flex-start" : text.verticalAlign === "bottom" ? "flex-end" : "center");
    css.set("white-space", text.wrap ? "pre-wrap" : "pre");
    css.set("overflow-wrap", text.wrap ? "break-word" : "normal");
    css.set("direction", text.rtl ? "rtl" : "ltr");
    css.set("border-radius", `${text.borderRadius}%`);
    element.dataset.textFit = text.fit;
    element.dataset.textDirection = text.direction;
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

    const content = document.createElement("div");
    content.className = "text-content";
    const contentCss: InlineStyle = new Map([["width", "100%"]]);
    if (text.direction !== "horizontal") {
        contentCss.set("writing-mode", text.direction === "vertical270" ? "vertical-rl" : "vertical-lr");
        contentCss.set("text-orientation", text.direction === "stacked" ? "upright" : "mixed");
        contentCss.set("height", "100%");
    }
    writeStyle(content, contentCss);

    text.paragraphs.forEach(paragraph => {
        const paragraphElement = document.createElement("div");
        paragraphElement.className = "text-paragraph";
        applyParagraphStyle(paragraphElement, paragraph, text.direction === "horizontal");
        if (paragraph.bullet) {
            const marker = document.createElement("span");
            marker.className = "text-bullet";
            marker.textContent = `${paragraph.bullet.marker} `;
            const markerCss: InlineStyle = new Map([
                ["display", "inline-block"],
                ["width", `${paragraph.bullet.indent / (paragraph.bullet.level + 1)}px`],
            ]);
            const firstRun = paragraph.runs[0];
            if (firstRun) {
                markerCss.set("font-family", fontFamilyCSS(firstRun.fontFace));
                markerCss.set("font-size", `${firstRun.fontSize}px`);
                markerCss.set("color", firstRun.color);
                markerCss.set("line-height", "0");
            }
            writeStyle(marker, markerCss);
            paragraphElement.appendChild(marker);
        }
        paragraph.runs.forEach(run => {
            if (run.softBreakBefore && paragraphElement.childNodes.length > (paragraph.bullet ? 1 : 0)) {
                paragraphElement.appendChild(document.createElement("br"));
            }
            paragraphElement.appendChild(renderRun(document, run));
        });
        content.appendChild(paragraphElement);
    });
    element.querySelector(":scope > .text-content")?.remove();
    element.appendChild(content);
}
