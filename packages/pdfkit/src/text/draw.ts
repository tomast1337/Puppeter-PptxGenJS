// Draws a laid-out text box: highlights, glyphs, decorations, links and bullets, on the profile's line boxes.
import { type Effect, sameEffect } from "#src/effect/index";
import { assertLinkUrl } from "@pdflapas/model";
import { type Face, fallbackFamily } from "#src/fonts";
import { captureFill, captureGlyphs, fill, glyphs, type Paint, stroke, useFace } from "#src/paint";
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
    // Each half-wave as the cubic with the quadratic's curve, its controls two thirds of the way to the quadratic's
    // (PDFKit's quadraticCurveTo writes another curve, see `record` in path.ts).
    const halfWave = (index: number, y: number, from: number, to: number) => {
        const [cx, cy] = [x + half * index + half / 2, y + control(index)];
        doc.bezierCurveTo(from + (2 / 3) * (cx - from), y + (2 / 3) * (cy - y), to + (2 / 3) * (cx - to), y + (2 / 3) * (cy - y), to, y);
    };
    doc.moveTo(x, middle - band);
    for (let index = 0; index < halves; index++) halfWave(index, middle - band, x + half * index, x + half * (index + 1));
    doc.lineTo(x + width, middle + band);
    for (let index = halves - 1; index >= 0; index--) halfWave(index, middle + band, x + half * (index + 1), x + half * index);
    doc.closePath();
}

/** The filled band of a decoration of `style` whose straight form is `thickness` px tall from `top`, as pdf-core's `underline_path`. */
function decorate(paint: Paint, decoration: Decoration, x: number, width: number, top: number, thickness: number): void {
    const t = Math.max(thickness, MIN_THICKNESS);
    const trace = (pen: PDFKit.PDFDocument) => {
        if (decoration.style === "solid") pen.rect(x, top, width, t);
        else if (decoration.style === "double") {
            const [line, gap] = [DOUBLE_LINE * t, DOUBLE_GAP * t];
            const first = top + t / 2 - gap / 2 - line;
            pen.rect(x, first, width, line).rect(x, first + line + gap, width, line);
        } else if (decoration.style === "dotted") dashes(pen, x, top, width, t, DOT_ON * t, DOT_OFF * t);
        else if (decoration.style === "dashed") dashes(pen, x, top, width, t, DASH_ON * t, DASH_OFF * t);
        else wave(pen, x, top + t / 2, width, t);
    };
    fillBands(paint, decoration, trace);
}

function fillBands(paint: Paint, decoration: Decoration, trace: (pen: PDFKit.PDFDocument) => void): void {
    trace(paint.doc);
    fill(paint, decoration.color);
    paint.doc.fill();
    captureFill(paint, decoration.color.alpha, trace);
}

/** A strikethrough band of `thickness` from `top`, or two (double) one thickness above and below it, as pdf-core draws them. */
function strike(paint: Paint, decoration: Decoration, x: number, width: number, top: number, thickness: number): void {
    const t = Math.max(thickness, MIN_THICKNESS);
    const tops = decoration.style === "double" ? [top - t, top + t] : [top];
    fillBands(paint, decoration, pen => {
        for (const y of tops) pen.rect(x, y, width, t);
    });
}

function drawFragment(paint: Paint, fragment: Fragment, left: number, baseline: number): void {
    const { run, face, size } = fragment;
    const doc = paint.doc;
    const x = left + fragment.x;
    const y = baseline + run.shift;
    const m = metrics(face, size);
    if (run.highlight) {
        fill(paint, run.highlight);
        const trace = (pen: PDFKit.PDFDocument) => pen.rect(x, y - m.ascent, fragment.width, m.ascent + m.descent);
        trace(doc);
        doc.fill();
        captureFill(paint, run.highlight.alpha, trace);
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
    // The silhouette is the filled glyphs, without the synthetic-bold or outline strokes, as pdf-core captures it.
    captureGlyphs(paint, face, size, fragment.text, x, y, { ...options, alpha: run.color.alpha, ...(run.glow ? { glow: run.glow } : {}) });
    if (run.outline) {
        stroke(paint, run.outline.color, run.outline.width);
        glyphs(paint, fragment.text, x, y, { ...options, fill: false, stroke: true });
    }
    doc.restore();
    if (run.underline) decorate(paint, run.underline, x, fragment.width, y + m.underlinePosition, m.underlineThickness);
    if (run.strike) strike(paint, run.strike, x, fragment.width, y + m.strikePosition, m.strikeThickness);
    const link = run.link;
    // A slide link carries href="#slide-N" too: data-slide decides, as in pdf-core.
    if (link?.slide !== undefined) doc.goTo(x, y - m.ascent, fragment.width, m.ascent + m.descent, `slide-${link.slide}`);
    else if (link?.href !== undefined) {
        assertLinkUrl(link.href, "a text run");
        doc.link(x, y - m.ascent, fragment.width, m.ascent + m.descent, link.href);
    }
}

/** pdf-core's cap on distinct glows per text box: each one is a mask of the whole box. */
const MAX_GLOWS_PER_BOX = 16;

/**
 * Draws `layout` with its content box's left edge at `left` and top at `top`, each distinct run glow under the
 * runs that glow with it (pdf-core's `draw_layout`).
 */
export function drawLayout(paint: Paint, layout: BoxLayout, left: number, top: number): void {
    const glows: Effect[] = [];
    for (const line of layout.lines) {
        for (const { run } of line.fragments) if (run.glow && !glows.some(glow => run.glow && sameEffect(glow, run.glow))) glows.push(run.glow);
    }
    if (glows.length > MAX_GLOWS_PER_BOX) paint.report(`${glows.length - MAX_GLOWS_PER_BOX} glows past the first ${MAX_GLOWS_PER_BOX} in one text box are not drawn`);
    const draw = () => {
        for (const line of layout.lines) for (const fragment of line.fragments) drawFragment(paint, fragment, left, top + line.baseline);
        for (const { bullet, face, size, x, baseline } of layout.bullets) {
            useFace(paint, face, size);
            fill(paint, bullet.color);
            const options = { features: features(true, 0), letterSpacing: 0 };
            glyphs(paint, bullet.text, left + x, top + baseline, { ...options, fill: true, stroke: false });
            captureGlyphs(paint, face, size, bullet.text, left + x, top + baseline, { ...options, alpha: bullet.color.alpha });
        }
    };
    // Each glow captures only its own runs, so the glows nest around one drawing of the text.
    const nested = glows.slice(0, MAX_GLOWS_PER_BOX).reduce((inner, glow) => () => paint.effects.under(paint.doc, glow, true, paint.opacity, paint.report, inner), draw);
    nested();
}
