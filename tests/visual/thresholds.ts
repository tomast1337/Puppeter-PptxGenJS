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
 * Table crops whose text sits off LibreOffice's (#44). Scores measured in the pinned image
 * (`bun run test:visual:docker`); each limit is the score plus at least BASELINE_EPSILON, capped at
 * PAGE_THRESHOLD. Grid geometry (column widths, row heights, pagination breaks) matches the reference;
 * two Chromium effects remain:
 *
 * - Glyphs sit 1-4 px (96 dpi) higher than in LibreOffice, in every cell and valign. It is not
 *   table-specific: the plain addText titles on pages 47 and 48 sit 2 px higher too. Shifting the
 *   whole PuppeteerGen crop down 1 px lowers five of these six scores even though it misaligns
 *   the grid lines (table-html-first 0.1011 -> 0.0780, table-pagination-first 0.1002 -> 0.0909).
 * - Chromium floors CSS border widths to whole CSS px: 1pt (1.33 px) draws as 1 px and 2pt as 2 px
 *   (measured at 384 dpi), which also moves row lines up ~1 px. Drawing the borders as exact SVG
 *   strokes instead fixes the widths (table-inheritance 0.1183 -> 0.0956) but makes the 0.75pt
 *   pagination grids worse (table-pagination-first 0.1002 -> 0.1148): pdftoppm snaps LibreOffice's
 *   1 px strokes to the pixel grid, while a stroke at a fractional position antialiases over 2 px.
 */
export const TABLE_TEXT_OFFSET_CROP_THRESHOLDS: Readonly<Record<string, number>> = {
    // 0.1183 (only 0.0017 under the cap). Largest offset: 3 px in the 13pt header, up to 4 px in the
    // valign cells, plus the 1pt and 2pt borders drawn thinner.
    "table-inheritance": PAGE_THRESHOLD,
    // 0.1002, 0.1030, 0.0816: every row's text 1 px higher; 0.75pt borders are already whole px.
    "table-pagination-first": 0.105,
    "table-pagination-second": 0.105,
    "table-pagination-third": 0.085,
    // 0.1011, 0.0918: the same 1 px text offset in the tableToSlides import.
    "table-html-first": 0.105,
    "table-html-second": 0.095,
};
