import type PptxGenJS from "pptxgenjs";
import type { NormalizedSlideObject } from "@pdflapas/model";
import { DEFAULT_RENDERING_TARGET, PPTX_DEFAULTS, type RenderingTarget } from "../defaults";
import type { FourSideMargin } from "../defaults";
import type { PageSize } from "../pageLayouts";
import { normalizeObjectStyle } from "./object";
import { normalizeText } from "./text";

/** PptxGenJS writes a run size, and so overrides the inherited one, only when one of these is set. */
function setsRunStyle(props: PptxGenJS.SlideNumberProps): boolean {
    return Boolean(props.fontFace || props.fontSize || props.color);
}

/**
 * The insets PptxGenJS writes, as the text normalizer takes them: a number (points) for all four sides, or an array it
 * reads as [top, right, bottom, left] (points; a missing side is 0), returned as [left, right, bottom, top]. Anything
 * else writes none, and the inset is inherited.
 */
function slideNumberMargin(margin: unknown): number | FourSideMargin | undefined {
    if (typeof margin === "number") return margin;
    if (!Array.isArray(margin)) return undefined;
    const side = (index: number) => Number(margin[index]) || 0;
    return [side(3), side(1), side(2), side(0)];
}

/**
 * `slide.slideNumber` as a text box showing `slideNumber` (the slide's 1-based position, hidden slides included, as
 * LibreOffice prints it). PptxGenJS 4.0.1 also writes the `slideNumber` set last on any slide (`last`) to the master
 * and the default layout, so the slide's placeholder inherits from it what its own props leave out: size, color and
 * font, vertical alignment and insets. Alignment and bold are the slide's own; PptxGenJS reads no other text option.
 */
export function normalizeSlideNumber(own: PptxGenJS.SlideNumberProps, last: PptxGenJS.SlideNumberProps, slideNumber: number, pageSize: PageSize, bodyFontFace: string, target: RenderingTarget = DEFAULT_RENDERING_TARGET): NormalizedSlideObject {
    const defaults = PPTX_DEFAULTS.slideNumber;
    const emuPerInch = PPTX_DEFAULTS.units.emuPerInch;
    const style = normalizeObjectStyle({ x: own.x, y: own.y, w: own.w || defaults.wEmu / emuPerInch, h: own.h || defaults.hEmu / emuPerInch }, PPTX_DEFAULTS.text, pageSize, defaults.objectName);
    const fontSize = setsRunStyle(own) ? own.fontSize || defaults.fontSizePt : setsRunStyle(last) ? last.fontSize || defaults.fontSizePt : PPTX_DEFAULTS.text.fontSizePt;
    // PptxGenJS matches the first letter: "ctr" centers, "justify" falls back to left.
    const align = own.align?.startsWith("c") ? "center" : own.align?.startsWith("r") ? "right" : defaults.align;
    const text = normalizeText(
        String(slideNumber),
        {
            fontFace: own.fontFace || last.fontFace || bodyFontFace,
            fontSize,
            color: own.color || last.color || PPTX_DEFAULTS.text.color,
            bold: Boolean(own.bold),
            align,
            valign: own.valign || last.valign || defaults.valign,
            margin: slideNumberMargin(own.margin) ?? slideNumberMargin(last.margin),
        },
        target,
    );
    return { kind: "text", style, text };
}
