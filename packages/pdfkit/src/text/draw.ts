// Draws a laid-out text box: highlights, glyphs, decorations, links and bullets, on the profile's line boxes.
import { type Face, fallbackFamily } from "#src/fonts";
import { fill, glyphs, type Paint, stroke, useFace } from "#src/paint";
import { type BoxLayout, type Fragment, layoutText } from "./layout";
import type { Decoration, Run, TextBox } from "./read";
import { features } from "./shaper";

export interface Frame {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** Lays the box out in `frame`, shrinking it as its `data-text-fit` rule says; returns the layout and its content top. */
export function layoutBox(paint: Paint, box: TextBox, frame: Frame): { layout: BoxLayout; top: number; height: number } {
    const [padTop, padRight, padBottom, padLeft] = box.padding;
    const innerWidth = frame.width - padLeft - padRight;
    let innerHeight = frame.height - padTop - padBottom;
    const missing = (run: Run) => paint.missingFace(run.face.family, fallbackFamily(paint.shaper.chain(run.face)));
    let layout = layoutText(box, innerWidth, 1, paint.shaper, missing);
    if (box.fit.kind === "shrink") {
        let scale = 1;
        for (let step = 0; step < box.fit.maxSteps; step++) {
            if (layout.height <= innerHeight + box.fit.tolerance && layout.width <= innerWidth + box.fit.tolerance) break;
            scale *= box.fit.step;
            layout = layoutText(box, innerWidth, scale, paint.shaper, missing);
        }
    }
    // `fit: resize` writes the height as min-height: the box grows to its text.
    if (box.fit.kind === "resize") innerHeight = Math.max(innerHeight, layout.height);
    const slack = innerHeight - layout.height;
    const offset = box.anchor === "center" ? slack / 2 : box.anchor === "flex-end" ? slack : 0;
    return { layout, top: frame.y + padTop + offset, height: innerHeight + padTop + padBottom };
}

/** The font's metrics in px at `size`: hhea ascent and descent, post underline, OS/2 strikeout. */
function metrics(face: Face, size: number) {
    const font = face.font;
    const scale = size / font.unitsPerEm;
    const os2 = font["OS/2"] as { yStrikeoutPosition?: number; yStrikeoutSize?: number } | undefined; // `as`: the declared Os2Table omits these fields
    return {
        ascent: font.ascent * scale,
        descent: -font.descent * scale,
        underlinePosition: -font.underlinePosition * scale,
        underlineThickness: font.underlineThickness * scale,
        strikePosition: -(os2?.yStrikeoutPosition ?? 0) * scale,
        strikeThickness: (os2?.yStrikeoutSize ?? font.underlineThickness) * scale,
    };
}

/** One decoration line (or two, double) of `thickness` centred `offset` px below the baseline. */
function decorate(paint: Paint, decoration: Decoration, x: number, width: number, baseline: number, offset: number, thickness: number): void {
    const doc = paint.doc;
    doc.save();
    stroke(paint, decoration.color, thickness);
    if (decoration.style === "dashed") doc.dash(thickness * 3, { space: thickness * 3 });
    if (decoration.style === "dotted") doc.dash(thickness, { space: thickness });
    const ys = decoration.style === "double" ? [offset - thickness, offset + thickness] : [offset];
    for (const y of ys)
        doc.moveTo(x, baseline + y)
            .lineTo(x + width, baseline + y)
            .stroke();
    doc.restore();
}

function drawFragment(paint: Paint, fragment: Fragment, left: number, baseline: number): void {
    const { run, face, size } = fragment;
    const doc = paint.doc;
    const x = left + fragment.x;
    const y = baseline + run.shift;
    const m = metrics(face, size);
    if (run.highlight) {
        fill(paint, run.highlight);
        doc.rect(x, y - m.ascent, fragment.width, m.ascent + m.descent).fill();
    }
    useFace(paint, face, size);
    fill(paint, run.color);
    if (run.outline) stroke(paint, run.outline.color, run.outline.width);
    glyphs(paint, fragment.text, x, y, { features: fragment.features, letterSpacing: run.letterSpacing, outline: run.outline !== undefined });
    if (run.underline) decorate(paint, run.underline, x, fragment.width, y, m.underlinePosition, m.underlineThickness);
    if (run.strike) decorate(paint, run.strike, x, fragment.width, y, m.strikePosition, m.strikeThickness);
    const link = run.link;
    if (link?.href !== undefined) doc.link(x, y - m.ascent, fragment.width, m.ascent + m.descent, link.href);
    else if (link?.slide !== undefined) doc.goTo(x, y - m.ascent, fragment.width, m.ascent + m.descent, `slide-${link.slide}`);
}

/** Draws `layout` with its content box's left edge at `left` and top at `top`. */
export function drawLayout(paint: Paint, layout: BoxLayout, left: number, top: number): void {
    for (const line of layout.lines) for (const fragment of line.fragments) drawFragment(paint, fragment, left, top + line.baseline);
    for (const { bullet, face, size, x, baseline } of layout.bullets) {
        useFace(paint, face, size);
        fill(paint, bullet.color);
        glyphs(paint, bullet.text, left + x, top + baseline, { features: features(true, 0), letterSpacing: 0 });
    }
}
