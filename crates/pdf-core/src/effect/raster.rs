//! Anti-aliased coverage of flattened outlines, for the silhouette a shadow or glow is blurred from.
//!
//! Signed-area accumulation (as in font-rs): each edge adds, to the cells of every row it crosses,
//! the area it sweeps right of each cell boundary; a running sum along the rows is then the winding
//! coverage. Coverage is |winding| capped at 1, which is the nonzero rule.

/// An edge in mask pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Line {
    pub(crate) x0: f32,
    pub(crate) y0: f32,
    pub(crate) x1: f32,
    pub(crate) y1: f32,
}

/// Accumulates `lines` (closed outlines; points outside the `w` x `h` mask are clamped to its
/// border) into `cells`, which must hold `w * h + 2` zeros, and composites their coverage times
/// `alpha` over `mask` (`w * h`, alpha in [0, 1], "over" compositing). Leaves `cells` zeroed.
pub(crate) fn composite(lines: &[Line], alpha: f32, w: usize, h: usize, cells: &mut [f32], mask: &mut [f32]) {
    let (mut top, mut bottom) = (h, 0);
    for line in lines {
        if let Some((from, to)) = accumulate(line, w, h, cells) {
            top = top.min(from);
            bottom = bottom.max(to);
        }
    }
    // One running sum over the rows: an edge clamped to the right border spills into the first
    // cells of the next row, which the sum carries over and cancels there.
    let mut winding = 0.0;
    for i in top * w..bottom * w {
        let (Some(cell), Some(out)) = (cells.get_mut(i), mask.get_mut(i)) else {
            break;
        };
        winding += *cell;
        *cell = 0.0;
        *out += winding.abs().min(1.0) * alpha * (1.0 - *out);
    }
    if let Some(spill) = cells.get_mut(bottom * w..bottom * w + 2) {
        spill.fill(0.0);
    }
}

/// Adds one edge to `cells`; returns the rows it touched.
fn accumulate(line: &Line, w: usize, h: usize, cells: &mut [f32]) -> Option<(usize, usize)> {
    let &Line { x0, y0, x1, y1 } = line;
    if !(x0.is_finite() && y0.is_finite() && x1.is_finite() && y1.is_finite()) || y0 == y1 {
        return None;
    }
    let (dir, (ax, ay), (bx, by)) = if y0 < y1 { (1.0, (x0, y0), (x1, y1)) } else { (-1.0, (x1, y1), (x0, y0)) };
    let dxdy = (bx - ax) / (by - ay);
    let (top, bottom) = (ay.max(0.0), by.min(h as f32));
    if top >= bottom {
        return None;
    }
    let clamp_x = |x: f32| x.clamp(0.0, w as f32);
    let mut add = |i: usize, v: f32| {
        if let Some(cell) = cells.get_mut(i) {
            *cell += v;
        }
    };
    let (start, end) = (top as usize, (bottom.ceil() as usize).min(h));
    let mut x = ax + (top - ay) * dxdy;
    for row in start..end {
        let row_start = row * w;
        let dy = ((row + 1) as f32).min(bottom) - (row as f32).max(top);
        let x_next = x + dxdy * dy;
        let d = dy * dir;
        let (l, r) = if x < x_next {
            (clamp_x(x), clamp_x(x_next))
        } else {
            (clamp_x(x_next), clamp_x(x))
        };
        let l_floor = l.floor();
        let li = l_floor as usize;
        let r_ceil = r.ceil();
        let ri = r_ceil as usize;
        if ri <= li + 1 {
            // Within one cell: split by the midpoint.
            let mid = 0.5 * (l + r) - l_floor;
            add(row_start + li, d * (1.0 - mid));
            add(row_start + li + 1, d * mid);
        } else {
            let s = (r - l).recip();
            let lf = l - l_floor;
            let a0 = 0.5 * s * (1.0 - lf) * (1.0 - lf);
            let rf = r - r_ceil + 1.0;
            let am = 0.5 * s * rf * rf;
            add(row_start + li, d * a0);
            if ri == li + 2 {
                add(row_start + li + 1, d * (1.0 - a0 - am));
            } else {
                let a1 = s * (1.5 - lf);
                add(row_start + li + 1, d * (a1 - a0));
                for xi in li + 2..ri - 1 {
                    add(row_start + xi, d * s);
                }
                let a2 = a1 + (ri - li - 3) as f32 * s;
                add(row_start + ri - 1, d * (1.0 - a2 - am));
            }
            add(row_start + ri, d * am);
        }
        x = x_next;
    }
    Some((start, end))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn l(x0: f32, y0: f32, x1: f32, y1: f32) -> Line {
        Line { x0, y0, x1, y1 }
    }

    fn square(x0: f32, y0: f32, x1: f32, y1: f32) -> [Line; 4] {
        [l(x0, y0, x1, y0), l(x1, y0, x1, y1), l(x1, y1, x0, y1), l(x0, y1, x0, y0)]
    }

    #[test]
    fn covers_a_square_with_anti_aliased_edges() {
        let (w, h) = (6, 4);
        let mut cells = vec![0.0; w * h + 2];
        let mut mask = vec![0.0; w * h];
        composite(&square(1.5, 1.0, 4.0, 3.0), 1.0, w, h, &mut cells, &mut mask);
        assert_eq!(&mask[w..2 * w], &[0.0, 0.5, 1.0, 1.0, 0.0, 0.0]);
        assert!(mask[..w].iter().chain(&mask[3 * w..]).all(|v| *v == 0.0));
        assert!(cells.iter().all(|v| v.abs() < 1e-6), "cells are left zeroed");
    }

    #[test]
    fn composites_overlapping_outlines_over_each_other() {
        let (w, h) = (4, 2);
        let mut cells = vec![0.0; w * h + 2];
        let mut mask = vec![0.0; w * h];
        composite(&square(0.0, 0.0, 2.0, 2.0), 0.5, w, h, &mut cells, &mut mask);
        composite(&square(1.0, 0.0, 3.0, 2.0), 0.5, w, h, &mut cells, &mut mask);
        assert_eq!(&mask[..w], &[0.5, 0.75, 0.5, 0.0]);
    }

    #[test]
    fn covers_half_the_cells_a_diagonal_crosses_and_clamps_outside_points() {
        let (w, h) = (4, 4);
        let mut cells = vec![0.0; w * h + 2];
        let mut mask = vec![0.0; w * h];
        // Right triangle below the diagonal of the 4 x 4 mask.
        composite(
            &[l(0.0, 0.0, 4.0, 4.0), l(4.0, 4.0, 0.0, 4.0), l(0.0, 4.0, 0.0, 0.0)],
            1.0,
            w,
            h,
            &mut cells,
            &mut mask,
        );
        for i in 0..w {
            assert!((mask[i * w + i] - 0.5).abs() < 1e-5, "{mask:?}");
        }
        assert!((mask.iter().sum::<f32>() - 8.0).abs() < 1e-4);
        // A square far past every border covers the mask; NaN and horizontal edges add nothing.
        let mut full = vec![0.0; w * h];
        composite(&square(-1e9, -1e9, 1e9, 1e9), 1.0, w, h, &mut cells, &mut full);
        composite(&[l(f32::NAN, 0.0, 1.0, 1.0), l(0.0, 1.0, 3.0, 1.0)], 1.0, w, h, &mut cells, &mut full);
        assert!(full.iter().all(|v| (*v - 1.0).abs() < 1e-5), "{full:?}");
        assert!(cells.iter().all(|v| v.abs() < 1e-6));
    }
}
