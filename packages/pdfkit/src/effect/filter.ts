// Blur and dilation of a coverage mask (row-major, alpha in [0, 1]): pdf-core's effect/filter.rs.
// The Gaussian blur is three box blurs per axis (the sizes that best match sigma, after W. Wells, "Efficient synthesis
// of Gaussian filters by cascaded uniform filters", 1986), linear in the radius. Dilation grows the mask by a Euclidean
// distance with the exact squared distance transform of Felzenszwalb and Huttenlocher (2012), also linear.

/** Box blurs per axis that approximate a Gaussian. */
const BOX_PASSES = 3;
/** Squared distance standing for "no covered pixel on this line": above any real one, exact when added to. */
const FAR = 1e12;

/** The radii of the BOX_PASSES box blurs whose cascade has standard deviation closest to `sigma`. */
export function boxRadii(sigma: number): number[] {
    // f32 as in pdf-core, so both renderers pick the same box sizes.
    const f = Math.fround;
    const n = BOX_PASSES;
    const ideal = f(Math.sqrt(f(f(f(12 * sigma) * sigma) / n) + 1));
    let lower = Math.floor(ideal);
    if (lower % 2 === 0) lower = Math.max(0, lower - 1);
    const wl = lower;
    const m = Math.round(f(f(f(12 * sigma) * sigma) - n * wl * wl - 4 * n * wl - 3 * n) / f(-4 * wl - 4));
    return Array.from({ length: BOX_PASSES }, (_, index) => (index < m ? Math.floor(lower / 2) : Math.floor(lower / 2) + 1));
}

/** Blurs `mask` (`w` x `h`) with a Gaussian of standard deviation `sigma` px; zero outside. */
export function gaussianBlur(mask: Float32Array, w: number, h: number, sigma: number): void {
    if (!(sigma > 0) || w === 0 || h === 0 || mask.length !== w * h) return;
    const line = new Float32Array(Math.max(w, h));
    for (const radius of boxRadii(sigma)) {
        for (let y = 0; y < h; y++) boxLine(mask, y * w, 1, w, radius, line);
        for (let x = 0; x < w; x++) boxLine(mask, x, w, h, radius, line);
    }
}

/** Box-blurs the `n` values `mask[start], mask[start + stride], ...` in place. */
function boxLine(mask: Float32Array, start: number, stride: number, n: number, radius: number, line: Float32Array): void {
    if (radius === 0) return;
    for (let i = 0; i < n; i++) line[i] = mask[start + i * stride] ?? 0;
    const scale = Math.fround(1 / (2 * radius + 1));
    // Running sum of line[x - radius ..= x + radius].
    let sum = 0;
    for (let i = 0; i < Math.min(radius, n); i++) sum = Math.fround(sum + (line[i] ?? 0));
    for (let x = 0; x < n; x++) {
        if (x + radius < n) sum = Math.fround(sum + (line[x + radius] ?? 0));
        if (x - radius - 1 >= 0) sum = Math.fround(sum - (line[x - radius - 1] ?? 0));
        mask[start + x * stride] = Math.max(sum * scale, 0);
    }
}

/** Grows the covered area (coverage >= 0.5) by `radius` px, with an anti-aliased edge. */
export function dilate(mask: Float32Array, w: number, h: number, radius: number): void {
    if (!(radius > 0) || w === 0 || h === 0 || mask.length !== w * h) return;
    // Squared distance from each pixel centre to the nearest covered one: columns, then rows.
    const dist = Float64Array.from(mask, a => (a >= 0.5 ? 0 : FAR));
    const f = new Float64Array(Math.max(w, h));
    const d = new Float64Array(Math.max(w, h));
    const v = new Int32Array(Math.max(w, h));
    const z = new Float64Array(Math.max(w, h) + 1);
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) f[y] = dist[y * w + x] ?? FAR;
        distance1d(f, h, d, v, z);
        for (let y = 0; y < h; y++) dist[y * w + x] = d[y] ?? FAR;
    }
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) f[x] = dist[y * w + x] ?? FAR;
        distance1d(f, w, d, v, z);
        for (let x = 0; x < w; x++) dist[y * w + x] = d[x] ?? FAR;
    }
    for (let i = 0; i < mask.length; i++) {
        const grown = Math.min(Math.max(radius + 0.5 - Math.sqrt(dist[i] ?? FAR), 0), 1);
        mask[i] = Math.max(mask[i] ?? 0, grown);
    }
}

/** 1D squared distance transform of the first `n` values of `f`: `d[q] = min over p of (q - p)^2 + f[p]`. */
function distance1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
    if (n === 0) return;
    const at = (array: Float64Array | Int32Array, index: number) => array[index] ?? 0;
    let k = 0;
    v[0] = 0;
    z[0] = Number.NEGATIVE_INFINITY;
    z[1] = Number.POSITIVE_INFINITY;
    for (let q = 1; q < n; q++) {
        const intersection = (p: number) => (at(f, q) + q * q - (at(f, p) + p * p)) / (2 * q - 2 * p);
        // z[0] is -inf, so k stops at 0.
        let s = intersection(at(v, k));
        while (s <= at(z, k)) {
            k--;
            s = intersection(at(v, k));
        }
        k++;
        v[k] = q;
        z[k] = s;
        z[k + 1] = Number.POSITIVE_INFINITY;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
        while (at(z, k + 1) < q) k++;
        const p = at(v, k);
        d[q] = (q - p) ** 2 + at(f, p);
    }
}
