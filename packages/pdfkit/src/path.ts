// Path geometry as PDFKit builds it, kept as data: the silhouettes shadows and glow are blurred from (effect/) and the
// ends line heads sit on read the same segments PDFKit draws, as pdf-core keeps its paths as kurbo paths.

/** One path command in user space. PDFKit draws a quadratic as `v` (a cubic whose first control is the current point), so it is recorded as that cubic. */
export type Segment = readonly ["M", number, number] | readonly ["L", number, number] | readonly ["C", number, number, number, number, number, number] | readonly ["Z"];

/** A PDF matrix `[a b c d e f]`: x' = a x + c y + e, y' = b x + d y + f. */
export type Matrix = readonly [number, number, number, number, number, number];

export type Point = readonly [number, number];

/** A flattened subpath: its points and whether it closes. */
export interface Polyline {
    readonly points: Point[];
    readonly closed: boolean;
}

/** How a path is stroked, in the same units as its points. */
export interface StrokeStyle {
    readonly width: number;
    readonly cap: "butt" | "square" | "round";
    readonly join: "miter" | "bevel" | "round";
    readonly miterLimit: number;
    /** SVG dash lengths; empty or undefined draws solid. */
    readonly dashes?: readonly number[];
}

/** Sides of the polygon a round cap or join is approximated with: enough that a blurred silhouette cannot show them. */
const ROUND_SIDES = 16;
/** Most points one curve is flattened into. */
const MAX_CURVE_POINTS = 1024;

/**
 * Runs `trace` on a stand-in for `doc` that records the path instead of writing it. The stand-in inherits PDFKit's
 * path builders (`path` parses SVG data, `ellipse` and `roundedRect` emit curves), so the segments are exactly the
 * ones PDFKit writes for the same calls; anything that would write other content throws.
 */
export function record(doc: PDFKit.PDFDocument, trace: (pen: PDFKit.PDFDocument) => void): Segment[] {
    const segments: Segment[] = [];
    let current: Point = [0, 0];
    let start: Point = [0, 0];
    const pen: PDFKit.PDFDocument = Object.create(doc, {
        moveTo: { value: (x: number, y: number) => (segments.push(["M", x, y]), (current = start = [x, y]), pen) },
        lineTo: { value: (x: number, y: number) => (segments.push(["L", x, y]), (current = [x, y]), pen) },
        bezierCurveTo: { value: (a: number, b: number, c: number, d: number, x: number, y: number) => (segments.push(["C", a, b, c, d, x, y]), (current = [x, y]), pen) },
        // The cubic with the quadratic's curve: each control two thirds of the way to the quadratic's. PDFKit's own
        // quadraticCurveTo writes `v`, a cubic whose first control is the current point, which is another curve, so
        // a path that may hold quadratics (SVG `Q`, `T`) is drawn by replaying its recording.
        quadraticCurveTo: {
            value: (a: number, b: number, x: number, y: number) => {
                const third = ([px, py]: Point): Point => [px + (2 / 3) * (a - px), py + (2 / 3) * (b - py)];

                segments.push(["C", ...third(current), ...third([x, y]), x, y]);
                current = [x, y];

                return pen;
            },
        },
        closePath: { value: () => (segments.push(["Z"]), (current = start), pen) },
        rect: {
            value: (x: number, y: number, w: number, h: number) => (
                pen
                    .moveTo(x, y)
                    .lineTo(x + w, y)
                    .lineTo(x + w, y + h)
                    .lineTo(x, y + h)
                    .closePath(),
                pen
            ),
        },
        addContent: {
            value: () => {
                throw new Error("internal error: a recorded path wrote content");
            },
        },
    });

    trace(pen);

    return segments;
}

/** Writes recorded `segments` to `doc` as path construction (no painting). */
export function replay(doc: PDFKit.PDFDocument, segments: readonly Segment[]): void {
    for (const segment of segments) {
        if (segment[0] === "M") {
            doc.moveTo(segment[1], segment[2]);
        } else if (segment[0] === "L") {
            doc.lineTo(segment[1], segment[2]);
        } else if (segment[0] === "C") {
            doc.bezierCurveTo(segment[1], segment[2], segment[3], segment[4], segment[5], segment[6]);
        } else {
            doc.closePath();
        }
    }
}

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m` then `n`: the matrix that applies `m` first. */
export function multiply(m: Matrix, n: Matrix): Matrix {
    return [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
}

/** The inverse of `m`; undefined when it is degenerate. */
// eslint-disable-next-line pdflapas/no-nullable-return -- phase 2 (#425)
export function invert(m: Matrix): Matrix | undefined {
    const det = m[0] * m[3] - m[1] * m[2];

    if (!det || !Number.isFinite(det)) {
        return undefined;
    }

    return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

export function apply(m: Matrix, x: number, y: number): Point {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** How much `m` scales lengths, on average over directions (the square root of its area scale). */
export function scaleOf(m: Matrix): number {
    return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

/**
 * The polylines of `segments` mapped by `m`, curves flattened to within `tolerance` (Wang's bound on the
 * cubic's second differences).
 */
export function flatten(segments: readonly Segment[], m: Matrix, tolerance: number): Polyline[] {
    const lines: Polyline[] = [];
    let points: Point[] = [];
    const finish = (closed: boolean) => {
        if (points.length) {
            lines.push({ points, closed });
        }

        points = [];
    };

    for (const segment of segments) {
        if (segment[0] === "M") {
            finish(false);
            points.push(apply(m, segment[1], segment[2]));
        } else if (segment[0] === "L") {
            points.push(apply(m, segment[1], segment[2]));
        } else if (segment[0] === "C") {
            const p0 = points.at(-1) ?? apply(m, 0, 0);

            if (!points.length) {
                points.push(p0);
            }

            const [p1, p2, p3] = [apply(m, segment[1], segment[2]), apply(m, segment[3], segment[4]), apply(m, segment[5], segment[6])];
            const dd = Math.max(Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]), Math.hypot(p1[0] - 2 * p2[0] + p3[0], p1[1] - 2 * p2[1] + p3[1]));
            const count = Math.min(MAX_CURVE_POINTS, Math.max(1, Math.ceil(Math.sqrt((0.75 * dd) / tolerance))));

            for (let index = 1; index <= count; index++) {
                const t = index / count;
                const u = 1 - t;
                const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];

                points.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
            }
        } else {
            const first = points[0];

            finish(true);
            // A path continues from the closed subpath's start.
            if (first) {
                points.push(first);
            }
        }
    }

    finish(false);

    return lines.filter(line => line.points.length > 1 || line.closed);
}

/** `polygon` turned to a positive signed area, so overlapping pieces of one outline add up under the nonzero rule. */
function oriented(polygon: Point[]): Point[] {
    // Twice the signed area of `polygon`.
    let area = 0;

    for (const [index, [x0, y0]] of polygon.entries()) {
        const [x1, y1] = polygon[(index + 1) % polygon.length] ?? [x0, y0];

        area += x0 * y1 - x1 * y0;
    }

    return area < 0 ? polygon.reverse() : polygon;
}

function disc([cx, cy]: Point, radius: number): Point[] {
    return Array.from({ length: ROUND_SIDES }, (_, index): Point => {
        const angle = (2 * Math.PI * index) / ROUND_SIDES;

        return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
    });
}

/**
 * The area `style` paints along `lines`, as polygons all of positive area: a quadrilateral per piece, the join between
 * neighbours (miter wedge within the limit, else bevel; round as a disc) and the caps. Their union under the nonzero
 * rule is the stroke, as pdf-core takes tiny-skia's stroker outline.
 */
export function strokeOutline(lines: readonly Polyline[], style: StrokeStyle): Point[][] {
    const half = style.width / 2;
    const polygons: Point[][] = [];

    if (!(half > 0)) {
        return polygons;
    }

    // Every line, cut into its dashes when the style has some (SVG `stroke-dasharray`, the pattern repeated to an even count).
    const pieces: Polyline[] = [];

    for (const line of lines) {
        if (!style.dashes?.length) {
            pieces.push(line);
            continue;
        }

        const dashes = style.dashes;
        const pattern = dashes.length % 2 ? [...dashes, ...dashes] : dashes;
        let total = 0;

        for (const length of pattern) {
            total = total + length;
        }

        if (!pattern.length || !(total > 0) || pattern.some(length => !(length >= 0))) {
            pieces.push(line);
            continue;
        }

        const points = line.closed && line.points[0] ? [...line.points, line.points[0]] : line.points;
        let [index, left, on] = [0, pattern[0] ?? 0, true];
        let dash: Point[] = on && points[0] ? [points[0]] : [];

        for (let k = 1; k < points.length; k++) {
            let [a, b]: [Point, Point] = [points[k - 1] ?? [0, 0], points[k] ?? [0, 0]];
            let length = Math.hypot(b[0] - a[0], b[1] - a[1]);

            while (length > left) {
                const t = left / length;
                const cut: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

                if (on) {
                    pieces.push({ points: [...dash, cut], closed: false });
                }

                dash = [cut];
                on = !on;
                [a, length] = [cut, length - left];
                index = (index + 1) % pattern.length;
                left = pattern[index] ?? 0;
            }

            left -= length;
            if (on) {
                dash.push(b);
            }
        }

        if (on && dash.length > 1) {
            pieces.push({ points: dash, closed: false });
        }
    }

    for (const piece of pieces) {
        const points = piece.points.filter((point, index) => {
            const previous = piece.points[index - 1];

            return !previous || previous[0] !== point[0] || previous[1] !== point[1];
        });
        const closed = piece.closed && points.length > 2;
        const count = closed ? points.length : points.length - 1;
        const normals: Point[] = [];

        for (let index = 0; index < count; index++) {
            const [a, b] = [points[index] ?? [0, 0], points[(index + 1) % points.length] ?? [0, 0]];
            const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const normal: Point = [(-(b[1] - a[1]) / length) * half, ((b[0] - a[0]) / length) * half];

            normals.push(normal);
            polygons.push(
                oriented([
                    [a[0] + normal[0], a[1] + normal[1]],
                    [b[0] + normal[0], b[1] + normal[1]],
                    [b[0] - normal[0], b[1] - normal[1]],
                    [a[0] - normal[0], a[1] - normal[1]],
                ]),
            );
        }

        if (points.length === 1 && style.cap !== "butt" && points[0]) {
            const [x, y] = points[0];

            polygons.push(
                style.cap === "round"
                    ? disc(points[0], half)
                    : oriented([
                          [x - half, y - half],
                          [x + half, y - half],
                          [x + half, y + half],
                          [x - half, y + half],
                      ]),
            );
        }

        // Joins at every inner vertex (every vertex of a closed piece).
        for (let index = closed ? 0 : 1; index < count; index++) {
            const vertex = points[index] ?? [0, 0];
            const [n0, n1] = [normals[(index - 1 + count) % count] ?? [0, 0], normals[index] ?? [0, 0]];

            if (style.join === "round") {
                polygons.push(disc(vertex, half));
                continue;
            }

            // The outer side of the turn: the normals point to its inside when the cross product is positive.
            const turn = n0[0] * n1[1] - n0[1] * n1[0];
            const side = turn > 0 ? -1 : 1;
            const [a, b]: [Point, Point] = [
                [vertex[0] + side * n0[0], vertex[1] + side * n0[1]],
                [vertex[0] + side * n1[0], vertex[1] + side * n1[1]],
            ];
            const bisector: Point = [n0[0] + n1[0], n0[1] + n1[1]];
            const cos = (n0[0] * n1[0] + n0[1] * n1[1]) / (half * half);
            const miter = 1 / Math.sqrt(Math.max((1 + cos) / 2, 1e-12));
            const bisectorLength = Math.hypot(bisector[0], bisector[1]);

            if (style.join === "miter" && miter <= style.miterLimit && bisectorLength > 0) {
                const tip: Point = [vertex[0] + (side * bisector[0] * half * miter) / bisectorLength, vertex[1] + (side * bisector[1] * half * miter) / bisectorLength];

                polygons.push(oriented([vertex, a, tip, b]));
            } else {
                polygons.push(oriented([vertex, a, b]));
            }
        }

        if (closed || style.cap === "butt" || points.length < 2) {
            continue;
        }

        for (const [end, toward] of [
            [points[0], points[1]],
            [points.at(-1), points.at(-2)],
        ] as const) {
            if (!end || !toward) {
                continue;
            }

            if (style.cap === "round") {
                polygons.push(disc(end, half));
                continue;
            }

            const length = Math.hypot(end[0] - toward[0], end[1] - toward[1]);
            const [dx, dy] = [((end[0] - toward[0]) / length) * half, ((end[1] - toward[1]) / length) * half];

            polygons.push(
                oriented([
                    [end[0] - dy, end[1] + dx],
                    [end[0] - dy + dx, end[1] + dx + dy],
                    [end[0] + dy + dx, end[1] - dx + dy],
                    [end[0] + dy, end[1] - dx],
                ]),
            );
        }
    }

    return polygons.filter(polygon => polygon.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
}

/**
 * Where a line head sits on `segments` and the direction it points: the first point, away from the path, and the
 * last point, along it. Each direction comes from the nearest control point that does not coincide with the end, as
 * SVG orients markers (pdf-core's `direction`). Undefined without a drawn segment.
 */
// eslint-disable-next-line pdflapas/no-nullable-return -- phase 2 (#425)
export function pathEnds(segments: readonly Segment[]): { start: Point; startDirection: Point; end: Point; endDirection: Point } | undefined {
    const drawn: Point[][] = [];
    let current: Point = [0, 0];
    let start: Point = [0, 0];

    for (const segment of segments) {
        if (segment[0] === "M") {
            current = start = [segment[1], segment[2]];
        } else if (segment[0] === "L") {
            drawn.push([current, [segment[1], segment[2]]]);
            current = [segment[1], segment[2]];
        } else if (segment[0] === "C") {
            drawn.push([current, [segment[1], segment[2]], [segment[3], segment[4]], [segment[5], segment[6]]]);
            current = [segment[5], segment[6]];
        } else {
            drawn.push([current, start]);
            current = start;
        }
    }

    const [first, last] = [drawn[0], drawn.at(-1)];

    if (!first || !last) {
        return undefined;
    }

    const away = (points: readonly Point[]): Point => {
        const [anchor = [0, 0]] = points;
        const other = points.find(point => point[0] !== anchor[0] || point[1] !== anchor[1]) ?? anchor;

        return [other[0] - anchor[0], other[1] - anchor[1]];
    };
    const [startAway, endAway] = [away(first), away(last.toReversed())];

    return { start: first[0] ?? [0, 0], startDirection: [-startAway[0], -startAway[1]], end: last.at(-1) ?? [0, 0], endDirection: [-endAway[0], -endAway[1]] };
}
