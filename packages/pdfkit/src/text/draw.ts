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

/** Lays the box's text out at `scale` in `width` px, the box's padding taken off. */
export function measureBox(paint: Paint, box: TextBox, width: number, scale = 1): BoxLayout {
    const missing = (run: Run) => paint.missingFace(run.face.family, fallbackFamily(paint.shaper.chain(run.face)));
    return layoutText(box, width - box.padding[1] - box.padding[3], scale, paint.shaper, missing);
}

/** The content top of `layout` placed in `frame` by the box's anchor (`align-items`), the box's padding taken off. */
export function anchorTop(box: TextBox, layout: BoxLayout, frame: Frame): number {
    const [padTop, , padBottom] = box.padding;
    const slack = frame.height - padTop - padBottom - layout.height;
    const offset = box.anchor === "center" ? slack / 2 : box.anchor === "flex-end" ? slack : 0;
    return frame.y + padTop + offset;
}

/** Lays the box out in `frame`, shrinking it as its `data-text-fit` rule says; returns the layout and its content top. */
export function layoutBox(paint: Paint, box: TextBox, frame: Frame): { layout: BoxLayout; top: number; height: number } {
    const [padTop, padRight, padBottom, padLeft] = box.padding;
    const innerWidth = frame.width - padLeft - padRight;
    let innerHeight = frame.height - padTop - padBottom;
    let layout = measureBox(paint, box, frame.width);
    if (box.fit.kind === "shrink") {
        let scale = 1;
        for (let step = 0; step < box.fit.maxSteps; step++) {
            if (layout.height <= innerHeight + box.fit.tolerance && layout.width <= innerWidth + box.fit.tolerance) break;
            scale *= box.fit.step;
            layout = measureBox(paint, box, frame.width, scale);
        }
    }
    // `fit: resize` writes the height as min-height: the box grows to its text.
    if (box.fit.kind === "resize") innerHeight = Math.max(innerHeight, layout.height);
    const height = innerHeight + padTop + padBottom;
    return { layout, top: anchorTop(box, layout, { ...frame, height }), height };
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

// Underline patterns in units of the font's underline thickness: pdf-core's (text/draw.rs), read from LibreOffice's
// PDF export of the visual fixture's "Underline styles" slide. Dots are one thickness long, as in Chromium.
const DOT_ON = 1;
const DOT_OFF = 1;
const DASH_ON = 3;
const DASH_OFF = 1.5;
const DOUBLE_LINE = 0.5;
const DOUBLE_GAP = 1;
const WAVE_PERIOD = 6;
const WAVE_HEIGHT = 1;
/** LibreOffice draws its wave thinner than the straight line. */
const WAVE_THICKNESS = 0.5;
/** The thinnest decoration band, px, as pdf-core draws it. */
const MIN_THICKNESS = 0.5;

/** `on`-long pieces of the band `top`..`top + t`, `off` apart, from `x`; the last one cut at the end. */
function dashes(doc: PDFKit.PDFDocument, x: number, top: number, width: number, t: number, on: number, off: number): void {
    for (let start = x; start < x + width; start += on + off) doc.rect(start, top, Math.min(on, x + width - start), t);
}

/** A band WAVE_THICKNESS thicknesses tall along a wave centred on `middle`: whole quadratic half-waves nearest to WAVE_PERIOD. */
function wave(doc: PDFKit.PDFDocument, x: number, middle: number, width: number, t: number): void {
    const halves = Math.max(1, Math.round(width / ((WAVE_PERIOD * t) / 2)));
    const half = width / halves;
    // A quadratic's control point is twice as far from the chord as the curve's peak.
    const reach = WAVE_HEIGHT * t;
    const band = (WAVE_THICKNESS * t) / 2;
    const control = (index: number) => (index % 2 === 0 ? -reach : reach);
    doc.moveTo(x, middle - band);
    for (let index = 0; index < halves; index++) doc.quadraticCurveTo(x + half * index + half / 2, middle - band + control(index), x + half * (index + 1), middle - band);
    doc.lineTo(x + width, middle + band);
    for (let index = halves - 1; index >= 0; index--) doc.quadraticCurveTo(x + half * index + half / 2, middle + band + control(index), x + half * index, middle + band);
    doc.closePath();
}

/** The filled band of a decoration of `style` whose straight form is `thickness` px tall from `top`, as pdf-core's `underline_path`. */
function decorate(paint: Paint, decoration: Decoration, x: number, width: number, top: number, thickness: number): void {
    const doc = paint.doc;
    const t = Math.max(thickness, MIN_THICKNESS);
    if (decoration.style === "solid") doc.rect(x, top, width, t);
    else if (decoration.style === "double") {
        const [line, gap] = [DOUBLE_LINE * t, DOUBLE_GAP * t];
        const first = top + t / 2 - gap / 2 - line;
        doc.rect(x, first, width, line).rect(x, first + line + gap, width, line);
    } else if (decoration.style === "dotted") dashes(doc, x, top, width, t, DOT_ON * t, DOT_OFF * t);
    else if (decoration.style === "dashed") dashes(doc, x, top, width, t, DASH_ON * t, DASH_OFF * t);
    else wave(doc, x, top + t / 2, width, t);
    fill(paint, decoration.color);
    doc.fill();
}

/** A strikethrough band of `thickness` from `top`, or two (double) one thickness above and below it, as pdf-core draws them. */
function strike(paint: Paint, decoration: Decoration, x: number, width: number, top: number, thickness: number): void {
    const t = Math.max(thickness, MIN_THICKNESS);
    const tops = decoration.style === "double" ? [top - t, top + t] : [top];
    for (const y of tops) paint.doc.rect(x, y, width, t);
    fill(paint, decoration.color);
    paint.doc.fill();
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
    // The face lacks the run's bold or italic style: synthesize it as the HTML says (pdf-core's text/draw.rs).
    const embolden = run.face.bold && !face.bold;
    const oblique = run.face.italic && !face.italic;
    const options = { features: fragment.features, letterSpacing: run.letterSpacing };
    doc.save();
    if (oblique) doc.transform(1, 0, -run.synthesis.italicShear, 1, run.synthesis.italicShear * y, 0);
    fill(paint, run.color);
    if (embolden) stroke(paint, run.color, size * run.synthesis.boldStroke);
    glyphs(paint, fragment.text, x, y, { ...options, fill: true, stroke: embolden });
    if (run.outline) {
        stroke(paint, run.outline.color, run.outline.width);
        glyphs(paint, fragment.text, x, y, { ...options, fill: false, stroke: true });
    }
    doc.restore();
    if (run.underline) decorate(paint, run.underline, x, fragment.width, y + m.underlinePosition, m.underlineThickness);
    if (run.strike) strike(paint, run.strike, x, fragment.width, y + m.strikePosition, m.strikeThickness);
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
        glyphs(paint, bullet.text, left + x, top + baseline, { features: features(true, 0), letterSpacing: 0, fill: true, stroke: false });
    }
}
