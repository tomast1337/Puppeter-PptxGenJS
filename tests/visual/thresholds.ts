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
// Scores measured in the pinned image (`bun run test:visual:docker`); each limit is the score plus at
// least BASELINE_EPSILON, capped at PAGE_THRESHOLD.

/**
 * Table crops still off LibreOffice's (#44, #49). Grid geometry (column widths, row heights, pagination
 * breaks) matches the reference, and since the print zoom and cell inset (printWorkarounds.ts) cell text
 * lands within 0.1 px of LibreOffice's in the pagination and tableToSlides tables (all under CROP_TARGET).
 *
 * table-inheritance, 0.0957: its text sits 0.6-0.8 px above LibreOffice's and its row lines one pixel row
 * higher at 96 dpi. Likely cause: the table offset moves the whole grid up by half the table's widest
 * stroke (2pt), more than half of the thinner borders around these cells. The border between the second
 * and third rows that LibreOffice draws is missing.
 */
export const TABLE_TEXT_OFFSET_CROP_THRESHOLDS: Readonly<Record<string, number>> = {
    "table-inheritance": 0.098,
};

/**
 * text-line-hairline, 0.0856: a text box line without width, which PptxGenJS writes without `w` (a
 * hairline). Its box spans px [528, 912) x [120, 192). LibreOffice draws the 1 px hairline inside the box
 * on rows 120 and 191; ours is centred on the edges, which pdftoppm rounds to rows 119 and 191, so the
 * top line is one pixel row higher. The text matches (baseline within 0.05 px). The same box with a 2pt
 * line, where the strokes overlap, scores under CROP_TARGET.
 *
 * text-line-feed-tail-run, 0.0800 (0.1626 before the line-feed tail fix): six dense 8pt Arial lines under a 16pt
 * head. Every line band matches LibreOffice's to one pixel row: ink rows 109-129 (head), 158-167, 171-180 (ours
 * 170-179), 183-192, 196-205, 222-231, 235-244 (ours 234-243), so the 12.8 px pitch rounds one row up on two
 * lines; the rest is LibreOffice's and Chromium's different sub-pixel glyph advances at 8pt along each line.
 */
export const TEXT_LINE_SNAP_CROP_THRESHOLDS: Readonly<Record<string, number>> = {
    "text-line-hairline": 0.088,
    "text-line-feed-tail-run": 0.082,
};

/**
 * Puppeteer crops of the double underlines on the "Underline styles" slide. The HTML says
 * `text-decoration-style: double`; at 20pt Chromium prints it as one 5px band (rows 148-152 at 96 dpi, the
 * two lines and their gap merged), where LibreOffice draws two 1px lines 3px apart (rows 148 and 151), and
 * draws `wavyDbl` as a faint double wave. The glyphs match. text-underline-dbl 0.0854, text-underline-wavyDbl
 * 0.1073, measured with `bun run test:visual` outside the pinned image (#205); the Visual parity job's
 * scores replace these.
 */
export const UNDERLINE_DOUBLE_CROP_THRESHOLDS: Readonly<Record<string, number>> = {
    "text-underline-dbl": 0.088,
    "text-underline-wavyDbl": 0.11,
};
