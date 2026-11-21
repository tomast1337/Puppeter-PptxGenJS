// Drop shadows and text glow: a blurred silhouette drawn under what casts it; a picture's inner shadow: the blurred
// outside of the silhouette, kept inside it and drawn over it. pdf-core's effect/mod.rs, step for step.
//
// PDF has no blur, so the effect is an image. While an object (or the glowing runs of a text box) is drawn, every
// fill, stroke and glyph run it draws is also flattened into a silhouette in the space the effect began in; the
// silhouette is rasterized (raster.ts), dilated for glow and blurred (filter.ts), and drawn as an image in the effect
// colour whose soft mask is the result, under what was drawn (pdf-core draws into a sub-stream; here the drawn
// content is moved after the effect in the page's content stream).
//
// Parameters follow LibreOffice, the visual reference (pdf-core measured them on LibreOffice 26.2 at 96 dpi):
// - outer shadow `blurRad` b: a Gaussian of sigma 0.46 b;
// - `glow rad` r: the glyphs grown by 0.45 r (50% there), then blurred with sigma 0.18 r;
// - inner shadow (pictures only): CSS's `box-shadow: inset`, as Chromium draws it, a Gaussian of sigma blur / 2.
import { type Color, color as parseColor, px } from "#src/css";
import { currentTransform, internals } from "#src/internals";
import { apply, flatten, invert, type Matrix, multiply, type Point, type Polyline, type Segment, type StrokeStyle, scaleOf, strokeOutline } from "#src/path";
import { dilate, gaussianBlur } from "./filter";
import { composite, type Line } from "./raster";

const SHADOW_SIGMA_PER_BLUR = 0.46;
const GLOW_SPREAD_PER_RADIUS = 0.45;
const GLOW_SIGMA_PER_RADIUS = 0.18;
/** CSS: a shadow's blur radius is twice the Gaussian's standard deviation. */
const INNER_SHADOW_SIGMA_PER_BLUR = 0.5;
/** A Gaussian is below 0.5% of its peak past three standard deviations. */
const SIGMAS_KEPT = 3;
/** Mask samples per px: viewers interpolate the image, and a blurred edge has no detail finer than a px. */
const SAMPLES_PER_PX = 1;
/** Longest mask side; a larger silhouette is sampled more coarsely. */
const MAX_SIDE = 4096;
/** Curve flattening tolerance (px). */
const FLATTEN_TOLERANCE = 0.1;
const CHANNEL_MAX = 255;
const SHADOW = /^(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/;

/** A blurred silhouette: its colour, how far it grows and blurs, its offset (px), and whether it is an inner shadow. */
export interface Effect {
    readonly color: Color;
    readonly spread: number;
    readonly sigma: number;
    readonly dx: number;
    readonly dy: number;
    readonly inner: boolean;
}

/** `<x>px <y>px <blur>px <color>`, the CSS shadow form the profile writes; undefined for anything else. */
function readShadow(value: string): { x: number; y: number; blur: number; color: Color } | undefined {
    const [, x, y, blur, shadowColor] = SHADOW.exec(value.trim()) ?? [];
    const [dx, dy, radius, parsed] = [px(x), px(y), px(blur), parseColor(shadowColor)];

    if (dx === undefined || dy === undefined || radius === undefined || !parsed) {
        return undefined;
    }

    return { x: dx, y: dy, blur: radius, color: parsed };
}

/**
 * The shadow a `box-shadow` (`inset` for an inner one) or `drop-shadow()` value states; undefined for a transparent
 * shadow, which draws nothing; a string naming why it is not drawn.
 */
export function shadowEffect(value: string, inner: boolean): Effect | string | undefined {
    const shadow = readShadow(value);

    if (!shadow) {
        return `shadow '${value}' is not '<x>px <y>px <blur>px <color>'`;
    }

    if (shadow.color.alpha <= 0) {
        return undefined;
    }

    return { color: shadow.color, spread: 0, sigma: Math.max(shadow.blur, 0) * (inner ? INNER_SHADOW_SIGMA_PER_BLUR : SHADOW_SIGMA_PER_BLUR), dx: shadow.x, dy: shadow.y, inner };
}

/** A run's glow from its `text-shadow` glow entry (the blur is the glow radius); undefined when it draws nothing. */
export function glowEffect(value: string): Effect | string | undefined {
    const glow = readShadow(value);

    if (!glow) {
        return `glow '${value}' is not '<x>px <y>px <blur>px <color>'`;
    }

    const radius = Math.max(glow.blur, 0);

    if (glow.color.alpha <= 0 || !(radius > 0) || !Number.isFinite(radius)) {
        return undefined;
    }

    return { color: glow.color, spread: radius * GLOW_SPREAD_PER_RADIUS, sigma: radius * GLOW_SIGMA_PER_RADIUS, dx: 0, dy: 0, inner: false };
}

export function sameEffect(a: Effect, b: Effect): boolean {
    return a.spread === b.spread && a.sigma === b.sigma && a.dx === b.dx && a.dy === b.dy && a.inner === b.inner && a.color.alpha === b.color.alpha && a.color.rgb.every((channel, index) => channel === b.color.rgb[index]);
}

/** The silhouette of what is drawn while a capture is active, in the user space it began in (px). */
interface Capture {
    /** Glow captures take only the glyph runs with this glow; shadow captures (undefined) take everything. */
    readonly glow: Effect | undefined;
    /** From device space back to the capture's user space. */
    readonly inverse: Matrix;
    readonly lines: Line[];
    /** Each drawn outline: its lines and its opacity. */
    readonly shapes: { start: number; end: number; alpha: number }[];
}

/** An effect ready to draw: its mask (one alpha byte per sample), size in samples, and box in user space (px). */
interface EffectImage {
    readonly alpha: Uint8Array;
    readonly w: number;
    readonly h: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** The captures in progress (innermost last) for one document. */
export class Effects {
    readonly #active: Capture[] = [];
    #paused: Capture[] = [];
    #images = 0;

    capturing(): boolean {
        return this.#active.length > 0;
    }

    /** Stops capturing until `resume`: for drawing whose silhouette was captured as a whole. */
    pause(): void {
        this.#paused = this.#active.splice(0);
    }

    resume(): void {
        this.#active.push(...this.#paused.splice(0));
    }

    /** Adds the area `segments` fill (user space of `doc` now) with `alpha` to the captures that take it. */
    fill(doc: PDFKit.PDFDocument, segments: readonly Segment[], alpha: number, glow?: Effect): void {
        this.#add(doc, segments, alpha, glow, lines => lines.map(line => line.points));
    }

    /** Adds the area `segments` stroked with `style` paints, as `fill` does. */
    stroke(doc: PDFKit.PDFDocument, segments: readonly Segment[], style: StrokeStyle, alpha: number): void {
        this.#add(doc, segments, alpha, undefined, (lines, scale) => strokeOutline(lines, { ...style, width: style.width * scale, ...(style.dashes ? { dashes: style.dashes.map(length => length * scale) } : {}) }));
    }

    /** Flattens `segments` into each capture that takes `glow`, as the closed outlines `outline` makes of them. */
    #add(doc: PDFKit.PDFDocument, segments: readonly Segment[], alpha: number, glow: Effect | undefined, outline: (lines: Polyline[], scale: number) => readonly (readonly Point[])[]): void {
        if (!this.#active.length) {
            return;
        }

        const ctm = currentTransform(doc);

        for (const capture of this.#active) {
            if (capture.glow && (!glow || !sameEffect(capture.glow, glow))) {
                continue;
            }

            const affine = multiply(ctm, capture.inverse);
            // The mask is at most MAX_SIDE samples across, so detail finer than extent / MAX_SIDE is lost anyway;
            // flattening a huge path at a fixed tolerance would push billions of lines.
            const [x0, y0, x1, y1] = bounds(segments, affine);

            if (!Number.isFinite(x1 - x0) || !Number.isFinite(y1 - y0)) {
                continue;
            }

            const tolerance = Math.max(FLATTEN_TOLERANCE, Math.max(x1 - x0, y1 - y0) / MAX_SIDE);
            const start = capture.lines.length;

            for (const polygon of outline(flatten(segments, affine, tolerance), scaleOf(affine))) {
                polygon.forEach(([ax, ay], index) => {
                    const [bx, by] = polygon[(index + 1) % polygon.length] ?? [ax, ay];

                    if (ax !== bx || ay !== by) {
                        capture.lines.push([ax, ay, bx, by]);
                    }
                });
            }

            if (capture.lines.length > start) {
                capture.shapes.push({ start, end: capture.lines.length, alpha: Math.min(Math.max(alpha, 0), 1) });
            }
        }
    }

    #begin(glow: Effect | undefined, inverse: Matrix): void {
        this.#active.push({ glow, inverse, lines: [], shapes: [] });
    }

    /** Ends the innermost capture and renders `effect` from it; undefined when nothing was captured. */
    #end(effect: Effect): EffectImage | undefined {
        const capture = this.#active.pop();

        return capture && render(capture, effect);
    }

    /**
     * Runs `draw` while capturing the silhouette of what it draws (only the glyph runs glowing with `effect` when
     * `glowing`), then puts `effect` under it (over it for an inner shadow). `opacity` is the object's.
     */
    under(doc: PDFKit.PDFDocument, effect: Effect, glowing: boolean, opacity: number, report: (what: string) => void, draw: () => void): void {
        const content = internals(doc).page.content.buffer;
        const start = content.length;
        const inverse = invert(currentTransform(doc));

        if (!inverse) {
            report("an effect on a degenerate transform is not drawn");
            draw();

            return;
        }

        this.#begin(glowing ? effect : undefined, inverse);
        draw();
        const image = this.#end(effect);

        if (!image) {
            return;
        }

        const drawn = effect.inner ? [] : content.splice(start);

        this.#draw(doc, image, effect.color, opacity);
        content.push(...drawn);
    }

    #draw(doc: PDFKit.PDFDocument, image: EffectImage, effectColor: Color, opacity: number): void {
        const pdf = internals(doc);
        const mask = pdf.ref({ Type: "XObject", Subtype: "Image", Width: image.w, Height: image.h, BitsPerComponent: 8, ColorSpace: "DeviceGray", Decode: [0, 1] });

        mask.end(image.alpha);
        const rgb = new Uint8Array(image.w * image.h * 3);

        for (let index = 0; index < rgb.length; index += 3) {
            rgb.set(effectColor.rgb, index);
        }

        // Interpolate, as krilla writes pdf-core's effect images: the mask is sampled at one sample per px.
        const xobject = pdf.ref({ Type: "XObject", Subtype: "Image", Width: image.w, Height: image.h, BitsPerComponent: 8, ColorSpace: "DeviceRGB", Interpolate: true, SMask: mask });

        xobject.end(rgb);
        const name = `FX${++this.#images}`;

        pdf.page.xobjects[name] = xobject;
        doc.save();
        if (opacity < 1) {
            doc.fillOpacity(opacity);
        }

        doc.transform(image.width, 0, 0, -image.height, image.x, image.y + image.height);
        pdf.addContent(`/${name} Do`);
        doc.restore();
    }
}

/** Rasterizes the capture's silhouette and turns it into the effect's mask (pdf-core's `Effects::render`). */
function render(capture: Capture, effect: Effect): EffectImage | undefined {
    if (!capture.lines.length) {
        return undefined;
    }

    let [x0, y0, x1, y1] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];

    for (const [ax, ay, bx, by] of capture.lines) {
        [x0, y0, x1, y1] = [Math.min(x0, ax, bx), Math.min(y0, ay, by), Math.max(x1, ax, bx), Math.max(y1, ay, by)];
    }

    // An inner shadow is cast by the outside of the offset silhouette: the mask keeps 3 sigma of it around the
    // silhouette, so the blur's zero past the mask edge never reaches inside.
    const reach = effect.inner ? Math.max(Math.abs(effect.dx), Math.abs(effect.dy)) : 0;
    const margin = effect.spread + SIGMAS_KEPT * effect.sigma + reach + 1;

    [x0, y0, x1, y1] = [x0 - margin, y0 - margin, x1 + margin, y1 + margin];
    const [areaWidth, areaHeight] = [x1 - x0, y1 - y0];

    if (!(Number.isFinite(areaWidth) && Number.isFinite(areaHeight) && areaWidth > 0 && areaHeight > 0)) {
        return undefined;
    }

    const scale = Math.min(SAMPLES_PER_PX, MAX_SIDE / Math.max(areaWidth, areaHeight));
    const [w, h] = [Math.ceil(areaWidth * scale), Math.ceil(areaHeight * scale)];
    const toMask =
        (dx: number, dy: number) =>
        (line: Line): Line => [(line[0] - x0) * scale + dx, (line[1] - y0) * scale + dy, (line[2] - x0) * scale + dx, (line[3] - y0) * scale + dy];
    const cells = new Float32Array(w * h + 2);
    const mask = new Float32Array(w * h);
    const lines = capture.lines.map(toMask(0, 0));

    for (const { start, end, alpha } of capture.shapes) {
        composite(lines.slice(start, end), alpha, w, h, cells, mask);
    }

    if (effect.inner) {
        // The outside of the silhouette moved by the offset, blurred, kept inside the silhouette. The moved
        // silhouette is opaque, so a translucent picture still has no outside within it.
        const moved = capture.lines.map(toMask(effect.dx * scale, effect.dy * scale));
        const offset = new Float32Array(w * h);

        for (const { start, end } of capture.shapes) {
            composite(moved.slice(start, end), 1, w, h, cells, offset);
        }

        gaussianBlur(offset, w, h, effect.sigma * scale);
        for (let index = 0; index < mask.length; index++) {
            mask[index] = (mask[index] ?? 0) * (1 - (offset[index] ?? 0));
        }
    } else {
        dilate(mask, w, h, effect.spread * scale);
        gaussianBlur(mask, w, h, effect.sigma * scale);
    }

    const alpha = Uint8Array.from(mask, value => Math.round(value * effect.color.alpha * CHANNEL_MAX));

    if (alpha.every(value => value === 0)) {
        return undefined;
    }

    // An inner shadow's offset is in its mask already.
    const [dx, dy] = effect.inner ? [0, 0] : [effect.dx, effect.dy];

    return { alpha, w, h, x: x0 + dx, y: y0 + dy, width: w / scale, height: h / scale };
}

/** The box of `segments`' points and control points mapped by `m`: x0, y0, x1, y1. */
function bounds(segments: readonly Segment[], m: Matrix): [number, number, number, number] {
    let [x0, y0, x1, y1] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];

    for (const segment of segments) {
        for (let index = 1; index + 1 < segment.length; index += 2) {
            const [x, y] = apply(m, segment[index] as number, segment[index + 1] as number); // `as`: odd indices of a segment are coordinates

            [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
        }
    }

    return [x0, y0, x1, y1];
}
