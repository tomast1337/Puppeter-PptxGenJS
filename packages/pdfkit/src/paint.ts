// The PDFKit calls every object kind shares, and the state one object is drawn with. PDFKit draws in CSS px: each
// page starts with a scale to points, so lengths from the HTML go to PDFKit unconverted.
import type { Color } from "./css";
import type { Effect, Effects } from "./effect/index";
import type { Face } from "./fonts";
import { record, type Segment, type StrokeStyle } from "./path";
import type { Report } from "./text/read";
import type { Features, Shaper } from "./text/shaper";

/** What drawing one slide object needs; `report` and `missingFace` name that object. */
export interface Paint {
    readonly doc: PDFKit.PDFDocument;
    readonly shaper: Shaper;
    readonly report: Report;
    /** Records that a run asked for `face`, which no font provides; `used` is the face drawn instead. */
    readonly missingFace: (face: string, used: string | undefined) => void;
    /** The object's `opacity`, multiplied into every fill and stroke alpha. */
    readonly opacity: number;
    /** Faces already registered with this document. */
    readonly registered: Set<string>;
    /** The document's shadow and glow captures: what is drawn adds to their silhouettes. */
    readonly effects: Effects;
}

/** Adds the area the path `trace` builds (filled with `alpha`, drawn now) to the silhouettes being captured. */
export function captureFill(paint: Paint, alpha: number, trace: (pen: PDFKit.PDFDocument) => void): void {
    if (paint.effects.capturing()) paint.effects.fill(paint.doc, record(paint.doc, trace), alpha);
}

/** Adds the area the path `trace` builds paints when stroked with `style` to the silhouettes being captured. */
export function captureStroke(paint: Paint, alpha: number, style: StrokeStyle, trace: (pen: PDFKit.PDFDocument) => void): void {
    if (paint.effects.capturing()) paint.effects.stroke(paint.doc, record(paint.doc, trace), style, alpha);
}

/** The outlines of `text` shaped in `face` at `size` px with its pen at `x` and baseline at `y`, as `glyphs` draws it. */
function glyphOutlines(face: Face, size: number, text: string, x: number, y: number, features: Features, letterSpacing: number): Segment[] {
    const run = face.font.layout(text, { ...features });
    const scale = size / face.font.unitsPerEm;
    const segments: Segment[] = [];
    let pen = x;
    run.glyphs.forEach((glyph, index) => {
        const position = run.positions[index];
        const [gx, gy] = [pen + (position?.xOffset ?? 0) * scale, y - (position?.yOffset ?? 0) * scale];
        const at = (px: number, py: number): [number, number] => [gx + px * scale, gy - py * scale];
        let current: [number, number] = [gx, gy];
        for (const { command, args } of glyph.path.commands) {
            const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = args;
            if (command === "moveTo") segments.push(["M", ...(current = at(a, b))]);
            else if (command === "lineTo") segments.push(["L", ...(current = at(a, b))]);
            else if (command === "quadraticCurveTo") {
                // The cubic with the same curve: each control two thirds of the way to the quadratic's.
                const [control, end] = [at(a, b), at(c, d)];
                const third = (from: [number, number]): [number, number] => [from[0] + (2 / 3) * (control[0] - from[0]), from[1] + (2 / 3) * (control[1] - from[1])];
                segments.push(["C", ...third(current), ...third(end), ...end]);
                current = end;
            } else if (command === "bezierCurveTo") segments.push(["C", ...at(a, b), ...at(c, d), ...(current = at(e, f))]);
            else if (command === "closePath") segments.push(["Z"]);
        }
        pen += (position?.xAdvance ?? 0) * scale + letterSpacing;
    });
    return segments;
}

/** Adds the glyph outlines `glyphs` draws for `text` (filled with `alpha`, glowing with `glow`) to the silhouettes being captured. */
export function captureGlyphs(paint: Paint, face: Face, size: number, text: string, x: number, y: number, options: { features: Features; letterSpacing: number; alpha: number; glow?: Effect }): void {
    if (paint.effects.capturing()) paint.effects.fill(paint.doc, glyphOutlines(face, size, text, x, y, options.features, options.letterSpacing), options.alpha, options.glow);
}

export function fill(paint: Paint, color: Color): void {
    paint.doc.fillColor([...color.rgb], color.alpha * paint.opacity);
}

export function stroke(paint: Paint, color: Color, width: number): void {
    paint.doc.strokeColor([...color.rgb], color.alpha * paint.opacity).lineWidth(width);
}

/** Selects `face` at `size` px, registering it with the document the first time. */
export function useFace(paint: Paint, face: Face, size: number): void {
    if (!paint.registered.has(face.key)) {
        // `as`: PDFKit 0.20 takes a parsed fontkit font (anything with `layout`), so each file is parsed once per
        // renderer, not once per document; @types/pdfkit 0.17 lists only paths and bytes.
        paint.doc.registerFont(face.key, face.font as unknown as Uint8Array);
        paint.registered.add(face.key);
    }
    paint.doc.font(face.key).fontSize(size);
}

export interface GlyphOptions {
    readonly features: Features;
    readonly letterSpacing: number;
    readonly fill: boolean;
    readonly stroke: boolean;
}

/** Draws `text` with its baseline at `y`, unwrapped, in the current face, fill and stroke. */
export function glyphs(paint: Paint, text: string, x: number, y: number, { features, letterSpacing, fill, stroke }: GlyphOptions): void {
    paint.doc.text(text, x, y, {
        lineBreak: false,
        baseline: "alphabetic",
        // A copy: fontkit writes the features it applied into the object. `as`: fontkit takes a feature map
        // (`{ kern: false }`); @types/pdfkit declares only a list of tags to turn on.
        features: { ...features } as unknown as PDFKit.Mixins.OpenTypeFeatures[],
        characterSpacing: letterSpacing,
        fill,
        stroke,
    });
}

/**
 * Sets an SVG `stroke-dasharray` (`lengths`, already in drawing units) as the PDF dash pattern. PDFKit refuses zero
 * lengths, which SVG allows (a zero dash draws nothing with butt caps), so they are folded into their neighbours and
 * a pattern that starts with a gap begins at its first dash, with a phase. Gaps only: nothing is stroked (false).
 */
export function dash(doc: PDFKit.PDFDocument, lengths: readonly number[]): boolean {
    if (!lengths.length || !lengths.every(length => Number.isFinite(length) && length >= 0)) return true;
    const pattern = lengths.length % 2 ? [...lengths, ...lengths] : lengths;
    const segments: { on: boolean; length: number }[] = [];
    pattern.forEach((length, index) => {
        const on = index % 2 === 0;
        const last = segments.at(-1);
        if (length === 0) return;
        if (last?.on === on) last.length += length;
        else segments.push({ on, length });
    });
    if (!segments.some(segment => segment.on)) return false;
    if (segments.every(segment => segment.on)) return true;
    // Rotate so the pattern starts with a dash; the phase puts the original start back at the path's start.
    let phase = 0;
    while (!segments[0]?.on || segments.at(-1)?.on) {
        const last = segments.pop();
        if (!last) break;
        phase += last.length;
        const first = segments[0];
        if (first && first.on === last.on) first.length += last.length;
        else segments.unshift(last);
    }
    const total = segments.reduce((sum, segment) => sum + segment.length, 0);
    doc.dash(
        segments.map(segment => segment.length),
        { phase: phase % total },
    );
    return true;
}

/** The box `transform` (rotation, flips) about the box centre, as CSS `transform-origin: center` applies it. */
export function transformBox(doc: PDFKit.PDFDocument, box: { x: number; y: number; width: number; height: number }, rotation: number, flipH: boolean, flipV: boolean): void {
    if (!rotation && !flipH && !flipV) return;
    const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
    doc.translate(cx, cy);
    if (rotation) doc.rotate(rotation);
    if (flipH || flipV) doc.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    doc.translate(-cx, -cy);
}
