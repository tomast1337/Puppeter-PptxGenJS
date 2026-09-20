import type { NormalizedShadow, NormalizedTextBox, NormalizedTextParagraph, NormalizedTextRun } from "../model/types";

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
    element.style.fontFamily = fontFamilyCSS(run.fontFace);
    element.style.fontSize = `${run.fontSize}px`;
    element.style.color = run.color;
    element.style.fontWeight = run.bold ? "bold" : "normal";
    element.style.fontStyle = run.italic ? "italic" : "normal";
    const lines: string[] = [];
    if (run.decoration.underline) lines.push("underline");
    if (run.decoration.strike) lines.push("line-through");
    if (lines.length) element.style.textDecorationLine = lines.join(" ");
    element.style.textDecorationStyle = run.decoration.underlineStyle;
    if (run.decoration.underlineColor) element.style.textDecorationColor = run.decoration.underlineColor;
    if (run.decoration.doubleStrike) element.style.textDecorationStyle = "double";
    element.style.verticalAlign = run.verticalAlign;
    if (run.baselineOffset) {
        element.style.position = "relative";
        element.style.top = `${-run.baselineOffset}px`;
    }
    if (run.characterSpacing) element.style.letterSpacing = `${run.characterSpacing}px`;
    if (run.highlight) element.style.backgroundColor = run.highlight;
    if (run.outline) element.style.setProperty("-webkit-text-stroke", `${run.outline.width}px ${run.outline.color}`);
    const glow = shadowCSS(run.glow);
    const shadow = shadowCSS(run.shadow);
    if (glow || shadow) element.style.textShadow = [glow, shadow].filter(Boolean).join(", ");
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
    element.textContent = run.text || "\u200b";
    return element;
}

function applyParagraphStyle(element: HTMLDivElement, paragraph: NormalizedTextParagraph): void {
    element.style.textAlign = paragraph.align;
    element.style.direction = paragraph.rtl ? "rtl" : "ltr";
    element.style.marginTop = `${paragraph.spaceBefore}px`;
    element.style.marginBottom = `${paragraph.spaceAfter}px`;
    if (paragraph.lineHeight !== undefined) {
        element.style.lineHeight = paragraph.lineHeight < 10 ? String(paragraph.lineHeight) : `${paragraph.lineHeight}px`;
    } else element.style.lineHeight = "1.2";
    if (paragraph.tabStops.length) {
        element.dataset.tabStops = paragraph.tabStops.map(stop => `${stop.position}:${stop.alignment}`).join(",");
    }
    if (paragraph.bullet) {
        const levelIndent = paragraph.bullet.indent / (paragraph.bullet.level + 1);
        element.style.paddingLeft = `${levelIndent * paragraph.bullet.level}px`;
        element.style.textIndent = "0px";
        element.dataset.bulletLevel = String(paragraph.bullet.level);
        element.dataset.bulletType = paragraph.bullet.kind;
    }
}

export function renderText(document: Document, element: HTMLElement, text: NormalizedTextBox): void {
    const [top, right, bottom, left] = text.margin;
    element.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
    element.style.alignItems = text.verticalAlign === "top" ? "flex-start" : text.verticalAlign === "bottom" ? "flex-end" : "center";
    element.style.whiteSpace = text.wrap ? "pre-wrap" : "pre";
    element.style.overflowWrap = text.wrap ? "break-word" : "normal";
    element.style.direction = text.rtl ? "rtl" : "ltr";
    element.style.borderRadius = `${text.borderRadius}%`;
    element.dataset.textFit = text.fit;
    element.dataset.textDirection = text.direction;
    if (text.fit === "resize") {
        const minimumHeight = element.style.height;
        element.style.height = "auto";
        element.style.minHeight = minimumHeight;
        element.style.overflow = "visible";
    } else if (!text.wrap) {
        // PptxGenJS emits `wrap="none"`, which allows a single line to paint
        // outside the text-box bounds while the slide itself remains clipped.
        element.style.overflow = "visible";
    }

    const content = document.createElement("div");
    content.className = "text-content";
    content.style.width = "100%";
    if (text.direction !== "horizontal") {
        content.style.writingMode = text.direction === "vertical270" ? "vertical-rl" : "vertical-lr";
        content.style.textOrientation = text.direction === "stacked" ? "upright" : "mixed";
        content.style.height = "100%";
    }

    text.paragraphs.forEach(paragraph => {
        const paragraphElement = document.createElement("div");
        paragraphElement.className = "text-paragraph";
        applyParagraphStyle(paragraphElement, paragraph);
        if (paragraph.bullet) {
            const marker = document.createElement("span");
            marker.className = "text-bullet";
            marker.textContent = `${paragraph.bullet.marker}\u00a0`;
            marker.style.display = "inline-block";
            marker.style.width = `${paragraph.bullet.indent / (paragraph.bullet.level + 1)}px`;
            const firstRun = paragraph.runs[0];
            if (firstRun) {
                marker.style.fontFamily = fontFamilyCSS(firstRun.fontFace);
                marker.style.fontSize = `${firstRun.fontSize}px`;
                marker.style.color = firstRun.color;
            }
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
