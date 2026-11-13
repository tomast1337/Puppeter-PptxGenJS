//! Blur and dilation of a coverage mask (row-major, alpha in [0, 1]).
//!
//! The Gaussian blur is three box blurs per axis (the sizes that best match `sigma`, after
//! W. Wells, "Efficient synthesis of Gaussian filters by cascaded uniform filters", 1986), linear in
//! the radius. Dilation grows the mask by a Euclidean distance with the exact squared distance
//! transform of Felzenszwalb and Huttenlocher (2012), also linear. Indices in this file come from
//! the loops over the mask's own dimensions, never from model data.

/// Box blurs per axis that approximate a Gaussian.
const BOX_PASSES: usize = 3;
/// Squared distance standing for "no covered pixel on this line": above any real one (masks are
/// at most `MAX_SIDE` px a side, so below 2^27), small enough that f64 keeps unit precision added to it.
const FAR: f64 = 1e12;

/// Reusable buffers, so repeated effects do not reallocate.
#[derive(Default)]
pub(crate) struct Scratch {
    line: Vec<f32>,
    dist: Vec<f64>,
    f: Vec<f64>,
    d: Vec<f64>,
    v: Vec<usize>,
    z: Vec<f64>,
}

/// The radii of the `BOX_PASSES` box blurs whose cascade has standard deviation closest to `sigma`.
fn box_radii(sigma: f32) -> [usize; BOX_PASSES] {
    let n = BOX_PASSES as f32;
    let ideal = (12.0 * sigma * sigma / n + 1.0).sqrt();
    let mut lower = ideal.floor() as usize;
    if lower.is_multiple_of(2) {
        lower = lower.saturating_sub(1);
    }
    let wl = lower as f32;
    let m = ((12.0 * sigma * sigma - n * wl * wl - 4.0 * n * wl - 3.0 * n) / (-4.0 * wl - 4.0)).round();
    std::array::from_fn(|i| if (i as f32) < m { lower / 2 } else { lower / 2 + 1 })
}

/// Blurs `mask` (`w` x `h`) with a Gaussian of standard deviation `sigma` px; zero outside.
pub(crate) fn gaussian_blur(mask: &mut [f32], w: usize, h: usize, sigma: f32, scratch: &mut Scratch) {
    if sigma.is_nan() || sigma <= 0.0 || w == 0 || h == 0 || mask.len() != w * h {
        return;
    }
    for radius in box_radii(sigma) {
        for row in mask.chunks_exact_mut(w) {
            box_line(row, 1, radius, &mut scratch.line);
        }
        for x in 0..w {
            if let Some(column) = mask.get_mut(x..) {
                box_line(column, w, radius, &mut scratch.line);
            }
        }
    }
}

/// Box-blurs the line `values[0], values[stride], ...` in place.
fn box_line(values: &mut [f32], stride: usize, radius: usize, line: &mut Vec<f32>) {
    if radius == 0 {
        return;
    }
    line.clear();
    line.extend(values.iter().step_by(stride));
    let n = line.len();
    let scale = 1.0 / (2 * radius + 1) as f32;
    // Running sum of line[x - radius ..= x + radius].
    let mut sum: f32 = line.iter().take(radius).sum();
    for (x, out) in values.iter_mut().step_by(stride).enumerate() {
        if let Some(entering) = line.get(x + radius) {
            sum += entering;
        }
        if let Some(leaving) = x.checked_sub(radius + 1).and_then(|i| line.get(i)) {
            sum -= leaving;
        }
        *out = (sum * scale).max(0.0);
    }
    debug_assert_eq!(n, line.len());
}

/// Grows the covered area (coverage >= 0.5) by `radius` px, with an anti-aliased edge.
pub(crate) fn dilate(mask: &mut [f32], w: usize, h: usize, radius: f32, scratch: &mut Scratch) {
    if radius.is_nan() || radius <= 0.0 || w == 0 || h == 0 || mask.len() != w * h {
        return;
    }
    let Scratch { dist, f, d, v, z, .. } = scratch;
    // Squared distance from each pixel centre to the nearest covered one: columns, then rows.
    dist.clear();
    dist.extend(mask.iter().map(|&a| if a >= 0.5 { 0.0 } else { FAR }));
    for x in 0..w {
        f.clear();
        f.extend(dist.iter().skip(x).step_by(w));
        distance_1d(f, d, v, z);
        for (out, value) in dist.iter_mut().skip(x).step_by(w).zip(d.iter()) {
            *out = *value;
        }
    }
    for row in dist.chunks_exact_mut(w) {
        f.clear();
        f.extend_from_slice(row);
        distance_1d(f, d, v, z);
        row.copy_from_slice(d);
    }
    for (a, d2) in mask.iter_mut().zip(dist.iter()) {
        let grown = (f64::from(radius) + 0.5 - d2.sqrt()).clamp(0.0, 1.0) as f32;
        *a = a.max(grown);
    }
}

/// 1D squared distance transform: `d[q] = min over p of (q - p)^2 + f[p]` (lower envelope of parabolas).
fn distance_1d(f: &[f64], d: &mut Vec<f64>, v: &mut Vec<usize>, z: &mut Vec<f64>) {
    let n = f.len();
    d.clear();
    d.resize(n, FAR);
    v.clear();
    v.resize(n, 0);
    z.clear();
    z.resize(n + 1, 0.0);
    if n == 0 {
        return;
    }
    let mut k = 0;
    z[0] = f64::NEG_INFINITY;
    z[1] = f64::INFINITY;
    for q in 1..n {
        let qf = q as f64;
        let intersection = |p: usize| {
            let pf = p as f64;
            ((f[q] + qf * qf) - (f[p] + pf * pf)) / (2.0 * qf - 2.0 * pf)
        };
        // z[0] is -inf, so k stops at 0.
        let mut s = intersection(v[k]);
        while s <= z[k] {
            k -= 1;
            s = intersection(v[k]);
        }
        k += 1;
        v[k] = q;
        z[k] = s;
        z[k + 1] = f64::INFINITY;
    }
    let mut k = 0;
    for (q, out) in d.iter_mut().enumerate() {
        let qf = q as f64;
        while z[k + 1] < qf {
            k += 1;
        }
        let p = v[k];
        *out = (qf - p as f64).powi(2) + f[p];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_box_sizes_whose_cascade_matches_sigma() {
        for sigma in [1.0f32, 2.5, 3.7, 7.0, 20.0] {
            let variance: f32 = box_radii(sigma).iter().map(|r| ((2 * r + 1).pow(2) - 1) as f32 / 12.0).sum();
            assert!((variance.sqrt() - sigma).abs() < 0.25 * sigma.max(1.0), "{sigma}: {}", variance.sqrt());
        }
    }

    #[test]
    fn blurs_a_step_to_half_at_the_edge_and_keeps_the_mass() {
        let (w, h) = (80, 80);
        let inside = |i: usize| (20..60).contains(&(i % w)) && (20..60).contains(&(i / w));
        let mut mask: Vec<f32> = (0..w * h).map(|i| if inside(i) { 1.0 } else { 0.0 }).collect();
        gaussian_blur(&mut mask, w, h, 4.0, &mut Scratch::default());
        // Symmetric around the edge, so half there; the mass stays away from the border.
        let row = 40 * w;
        assert!((mask[row + 19] + mask[row + 20] - 1.0).abs() < 0.02, "{} {}", mask[row + 19], mask[row + 20]);
        assert!((mask.iter().sum::<f32>() - 1600.0).abs() < 0.1);
        assert!(mask[row + 40] > 0.99 && mask[row + 2] < 1e-3);
    }

    #[test]
    fn blurs_columns_like_rows() {
        let (w, h) = (9, 9);
        let mut mask = vec![0.0; w * h];
        mask[4 * w + 4] = 1.0;
        gaussian_blur(&mut mask, w, h, 1.5, &mut Scratch::default());
        for i in 0..w {
            for j in 0..h {
                assert!((mask[j * w + i] - mask[i * w + j]).abs() < 1e-6);
            }
        }
    }

    #[test]
    fn dilates_by_euclidean_distance() {
        let (w, h) = (21, 21);
        let mut mask = vec![0.0; w * h];
        mask[10 * w + 10] = 1.0;
        dilate(&mut mask, w, h, 5.0, &mut Scratch::default());
        // A disc: 5 px along the axes and the diagonals, not a square.
        assert_eq!(mask[10 * w + 15], 0.5);
        assert_eq!(mask[10 * w + 16], 0.0);
        let diagonal = mask[14 * w + 14]; // 5.66 px away
        assert!(diagonal < 0.01, "{diagonal}");
        assert_eq!(mask[13 * w + 13], 1.0); // 4.24 px away
        // An empty mask stays empty.
        let mut empty = vec![0.0; w * h];
        dilate(&mut empty, w, h, 5.0, &mut Scratch::default());
        assert!(empty.iter().all(|v| *v == 0.0));
    }
}
