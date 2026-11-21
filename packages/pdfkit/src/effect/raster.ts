// Anti-aliased coverage of flattened outlines, for the silhouette a shadow or glow is blurred from: pdf-core's
// effect/raster.rs. Signed-area accumulation (as in font-rs): each edge adds, to the cells of every row it crosses,
// the area it sweeps right of each cell boundary; a running sum along the rows is then the winding coverage.
// Coverage is |winding| capped at 1, which is the nonzero rule.

/** An edge in mask pixels: x0, y0, x1, y1. */
export type Line = readonly [number, number, number, number];

/**
 * Accumulates `lines` (closed outlines; points outside the `w` x `h` mask are clamped to its border) into `cells`,
 * which must hold `w * h + 2` zeros, and composites their coverage times `alpha` over `mask` ("over" compositing).
 * Leaves `cells` zeroed.
 */
export function composite(lines: readonly Line[], alpha: number, w: number, h: number, cells: Float32Array, mask: Float32Array): void {
    let [top, bottom] = [h, 0];

    for (const line of lines) {
        const rows = accumulate(line, w, h, cells);

        if (!rows) {
            continue;
        }

        top = Math.min(top, rows[0]);
        bottom = Math.max(bottom, rows[1]);
    }

    // One running sum over the rows: an edge clamped to the right border spills into the first cells of the next
    // row, which the sum carries over and cancels there.
    let winding = 0;

    for (let index = top * w; index < bottom * w; index++) {
        winding += cells[index] ?? 0;
        cells[index] = 0;
        const out = mask[index] ?? 0;

        mask[index] = out + Math.min(Math.abs(winding), 1) * alpha * (1 - out);
    }

    cells.fill(0, bottom * w, bottom * w + 2);
}

/** Adds one edge to `cells`; returns the rows it touched. */
function accumulate([x0, y0, x1, y1]: Line, w: number, h: number, cells: Float32Array): [number, number] | undefined {
    if (!(Number.isFinite(x0) && Number.isFinite(y0) && Number.isFinite(x1) && Number.isFinite(y1)) || y0 === y1) {
        return undefined;
    }

    const [dir, ax, ay, bx, by] = y0 < y1 ? [1, x0, y0, x1, y1] : [-1, x1, y1, x0, y0];
    const dxdy = (bx - ax) / (by - ay);
    const [top, bottom] = [Math.max(ay, 0), Math.min(by, h)];

    if (top >= bottom) {
        return undefined;
    }

    const clampX = (x: number) => Math.min(Math.max(x, 0), w);
    const add = (index: number, value: number) => {
        if (index < cells.length) {
            cells[index] = (cells[index] ?? 0) + value;
        }
    };
    const [start, end] = [Math.floor(top), Math.min(Math.ceil(bottom), h)];
    let x = ax + (top - ay) * dxdy;

    for (let row = start; row < end; row++) {
        const rowStart = row * w;
        const dy = Math.min(row + 1, bottom) - Math.max(row, top);
        const xNext = x + dxdy * dy;
        const d = dy * dir;
        const [l, r] = x < xNext ? [clampX(x), clampX(xNext)] : [clampX(xNext), clampX(x)];
        const lFloor = Math.floor(l);
        const li = lFloor;
        const rCeil = Math.ceil(r);
        const ri = rCeil;

        if (ri <= li + 1) {
            // Within one cell: split by the midpoint.
            const mid = 0.5 * (l + r) - lFloor;

            add(rowStart + li, d * (1 - mid));
            add(rowStart + li + 1, d * mid);
        } else {
            const s = 1 / (r - l);
            const lf = l - lFloor;
            const a0 = 0.5 * s * (1 - lf) * (1 - lf);
            const rf = r - rCeil + 1;
            const am = 0.5 * s * rf * rf;

            add(rowStart + li, d * a0);
            if (ri === li + 2) {
                add(rowStart + li + 1, d * (1 - a0 - am));
            } else {
                const a1 = s * (1.5 - lf);

                add(rowStart + li + 1, d * (a1 - a0));
                for (let xi = li + 2; xi < ri - 1; xi++) {
                    add(rowStart + xi, d * s);
                }

                const a2 = a1 + (ri - li - 3) * s;

                add(rowStart + ri - 1, d * (1 - a2 - am));
            }

            add(rowStart + ri, d * am);
        }

        x = xNext;
    }

    return [start, end];
}
