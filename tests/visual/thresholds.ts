// Visual parity limits (normalized RMSE, AGENTS.md "Testing requirements"), shared by the Puppeteer and
// WASM comparisons and the fixture's crop regions.

/** Whole-slide limit. `VISUAL_DIFF_THRESHOLD` overrides it for tests/visual/compare.ts. */
export const PAGE_THRESHOLD = 0.12;

/** Target for feature-level crops, so small regressions cannot hide in large blank regions. */
export const CROP_TARGET = 0.08;

/**
 * Slack on a WASM crop's baseline.json entry. The pinned image makes scores repeatable to the last digit;
 * 0.002 absorbs the 4-decimal rounding of baseline.json plus a few antialiased pixels, well below one
 * misplaced glyph in a crop (~0.01).
 */
export const BASELINE_EPSILON = 0.002;

// Crop exceptions above CROP_TARGET (tests/visual/fixture.ts). Do not raise one to pass a regression.

/**
 * flowChartInternalStorage, flowChartPredefinedProcess (dbd52e3). LibreOffice rasterizes multiple
 * coincident 1.15pt divider strokes with fewer fully opaque pixels than Chromium; geometry and divider
 * positions match (tests/shape.test.ts "renders flowchart dividers as strokes over one filled face").
 * No scores were recorded when it was set.
 */
export const FLOWCHART_DIVIDER_CROP_THRESHOLD = 0.11;

/**
 * table-* crops (d9dbab6): dense table grids hit the same divider-stroke rasterization difference; the
 * table pages stay below 0.09 whole-slide RMSE. No per-crop scores were recorded when it was set.
 */
export const TABLE_CROP_THRESHOLD = 0.09;

/**
 * table-inheritance (d9dbab6), table-pagination-* (07e5f05), table-html-* (0f838d5): no recorded
 * evidence beyond the shared divider-stroke comment; these crops are held only to the page limit.
 */
export const TABLE_LAYOUT_CROP_THRESHOLD = PAGE_THRESHOLD;
