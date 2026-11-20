import { CSS_PX_PER_INCH, POINTS_PER_INCH } from "@pdflapas/model";

export type FourSideMargin = [number, number, number, number];

/** The pinned PptxGenJS release this package reproduces; `pres.version` returns it, as PptxGenJS returns its own. */
export const PPTXGENJS_VERSION = "4.0.1";
export const PPTX_DEFAULTS_VERSION = `pptxgenjs@${PPTXGENJS_VERSION}`;

const BAR_CHART_COLORS = Object.freeze(["C0504D", "4F81BD", "9BBB59", "8064A2", "4BACC6", "F79646", "628FC6", "C86360", "C0504D", "4F81BD", "9BBB59", "8064A2", "4BACC6", "F79646", "628FC6", "C86360"] as const);

const PIE_CHART_COLORS = Object.freeze(["5DA5DA", "FAA43A", "60BD68", "F17CB0", "B2912F", "B276B2", "DECF3F", "F15854", "A7A7A7", "5DA5DA", "FAA43A", "60BD68", "F17CB0", "B2912F", "B276B2", "DECF3F", "F15854", "A7A7A7"] as const);

/**
 * Defaults observed in PptxGenJS 4.0.1 and the OOXML it emits.
 *
 * Keep these values centralized: rendering code should not invent browser
 * defaults when PowerPoint/PptxGenJS has a defined behavior.
 */
export const PPTX_DEFAULTS = Object.freeze({
    sourceVersion: PPTX_DEFAULTS_VERSION,
    units: Object.freeze({
        cssDpi: CSS_PX_PER_INCH,
        pointsPerInch: POINTS_PER_INCH,
        emuPerInch: 914400,
        emuPerPoint: 12700,
        // PptxGenJS 4.0.1 reads a length number below this as inches and any other as EMU: getSmartParseNumber keeps
        // 100 itself as EMU, inch2Emu reads 100 as inches and only a number above it as EMU.
        inchesBelow: 100,
        // `<a:spcPts val>`, which PptxGenJS writes as Math.round(points * 100) for paragraph and line spacing.
        spacingPointsPerPoint: 100,
    }),
    presentation: Object.freeze({
        layout: "LAYOUT_16x9",
        layoutName: "DEFAULT",
        // `pres.layout` names; `presLayoutName` is the `presLayout.name` PptxGenJS gives each one.
        layouts: Object.freeze({
            LAYOUT_4x3: Object.freeze({ width: 10, height: 7.5, presLayoutName: "screen4x3" }),
            LAYOUT_16x9: Object.freeze({ width: 10, height: 5.625, presLayoutName: "screen16x9" }),
            LAYOUT_16x10: Object.freeze({ width: 10, height: 6.25, presLayoutName: "screen16x10" }),
            // 12192000 x 6858000 EMU: 13 1/3 in wide.
            LAYOUT_WIDE: Object.freeze({ width: 40 / 3, height: 7.5, presLayoutName: "custom" }),
        }),
        rtlMode: false,
        // No metadata defaults: PptxGenJS's title, author, subject, company and revision defaults are its branding,
        // so PdfLapas writes only the values the caller sets (owner decision, #102; PuppeteerGen.metadata).
    }),
    theme: Object.freeze({
        headFontFace: "Calibri Light",
        bodyFontFace: "Calibri",
        language: "en-US",
        colors: Object.freeze({
            dark1: "000000",
            light1: "FFFFFF",
            dark2: "44546A",
            light2: "E7E6E6",
            accent1: "4472C4",
            accent2: "ED7D31",
            accent3: "A5A5A5",
            accent4: "FFC000",
            accent5: "5B9BD5",
            accent6: "70AD47",
            hyperlink: "0563C1",
            followedHyperlink: "954F72",
        }),
    }),
    write: Object.freeze({
        compression: false,
        outputType: "blob",
        fileName: "Presentation.pptx",
        // PptxGenJS 4.0.1 writeFile() appends ".pptx" to a name that does not end in it (any case) and defaults
        // to fileName. PdfLapas replaces a trailing ".pptx" with ".pdf", appends ".pdf" to other names and
        // requires a name (resolveFileName in output.ts).
        pptxExtension: ".pptx",
        pdfExtension: ".pdf",
    }),
    fill: Object.freeze({ whenProvidedType: "solid" as const, transparency: 0 }),
    border: Object.freeze({ whenProvidedType: "solid" as const, color: "666666", widthPt: 1 }),
    shadow: Object.freeze({
        absentType: "none" as const,
        blurPt: 0,
        angle: 0,
        offsetPt: 0,
        rotateWithShape: false,
        // slideObjectToXml writes the shadow of text boxes, shapes and images with `blur || 8`,
        // `offset || 4`, `angle || 270`, `opacity || 0.75`: a falsy value (0 included) takes the
        // default. It always writes rotWithShape="0". (DEF_SHAPE_SHADOW is used by charts only.)
        objectWhenEnabled: Object.freeze({
            type: "outer" as const,
            blurPt: 8,
            offsetPt: 4,
            angle: 270,
            color: "000000",
            opacity: 0.75,
        }),
        textColorWhenEnabled: "000000",
    }),
    text: Object.freeze({
        color: "000000",
        fontFace: "Calibri",
        fontSizePt: 18,
        /**
         * `<a:defRPr kern="1200">` in presentation.xml's defaultTextStyle and every master text style: text from 12pt
         * up is kerned. A run with `charSpacing` writes `kern="0"`, which turns its kerning off.
         */
        kernMinSizePt: 12,
        generalFontSizePt: 12,
        titleFontSizePt: 18,
        align: "left" as const,
        valign: "middle" as const,
        wrap: true,
        bold: false,
        italic: false,
        underline: "none" as const,
        strike: false,
        breakLine: false,
        softBreakBefore: false,
        transparency: 0,
        textDirection: "horz" as const,
        fit: "none" as const,
        // fit: "shrink" scales every run and bullet font size, px line height and baseline shift by `step` while the
        // text overflows the box's inner size by more than `tolerancePx`, at most `maxSteps` times. Written on the box
        // (data-text-fit-*) so both renderers apply the same rule.
        // shortcut: 0.95 steps approximate LibreOffice's font and spacing scale and PowerPoint's fontScale; match one of
        // them once a fixture measures the shrunk size against the reference.
        shrink: Object.freeze({ step: 0.95, maxSteps: 20, tolerancePx: 0.5 } as const),
        flipH: false,
        flipV: false,
        rotate: 0,
        rtlMode: false,
        x: 0,
        y: 0,
        w: "75%" as const,
        // PptxGenJS 4.0.1 (and 3.12) writes cy="0" for a text box without `h`.
        h: 0,
        // PowerPoint's Normal text-box inset: top, right, bottom, left.
        marginIn: Object.freeze([0.05, 0.1, 0.05, 0.1] as const),
        glowWhenEnabled: Object.freeze({ sizePt: 8, color: "FFFFFF", opacity: 0.75 }),
        // A `line` without a width on text that is not shape "line": PptxGenJS 4.0.1 writes <a:ln> without
        // `w`, whose ECMA-376 default 0 is the thinnest line the device draws (LibreOffice: one pixel).
        // 0.75pt is one CSS px, one pixel of the 96 dpi visual raster.
        // shortcut: a fixed 0.75pt, not a zero-width device line; switch when both renderers can stroke width 0.
        hairlineWidthPt: 0.75,
        // Font-independent line box of LibreOffice's PPTX import (editeng fixed cell height,
        // ImplCalculateFontIndependentLineSpacing): a single line is 1.2x the font size, the baseline
        // sits 1.0x the font size below its top, so 0.2x below it. Spacing multiples scale the 1.2;
        // the extra (or missing) height is above the baseline. Measured at 384 dpi for Arial, Carlito
        // and Liberation Serif at 10/18/40pt: first baseline within 0.25 px of 1.0em, pitch 1.2em,
        // 1.5x spacing puts it at 1.6em with a 1.8em pitch, exact spacing H at H - 0.2em.
        singleLineEm: 1.2,
        lineDescentEm: 0.2,
        // PptxGenJS 4.0.1 genXmlTextRunProperties writes superscript as baseline="30000" and subscript as
        // baseline="-40000": the baseline moves by that fraction of the run's font size.
        superscriptBaseline: 0.3,
        subscriptBaseline: -0.4,
        // A custom `baseline` is written ahead of both as baseline="Math.round(baseline * 50)", in thousandths of a
        // percent (OOXML_PERCENT) of the run's font size: `baseline: 600` moves it by 30%.
        customBaselineScale: 50,
        // defTabSz="914400" (1in) on every level of PptxGenJS's master text styles: default tab stops
        // after the last explicit one.
        defaultTabStopIn: 1,
    }),
    table: Object.freeze({
        x: 0.5,
        y: 0.5,
        fontSizePt: 12,
        // A cell run PptxGenJS 4.0.1 writes without `sz` (tableToSlides under jsdom: no computed font-size, read as 0)
        // takes the deck's default text size: `<a:defRPr sz="1800">` on lvl1pPr of presentation.xml
        // `p:defaultTextStyle` and of the master's `p:otherStyle`. The table style PptxGenJS names in tableStyles.xml
        // ({5C22544A-…}, Medium Style 2 - Accent 1) sets fonts and colors in `a:tcTxStyle`, no size.
        unsizedRunFontSizePt: 18,
        color: "000000",
        // PptxGenJS DEF_CELL_MARGIN_IN: top, right, bottom, left.
        marginIn: Object.freeze([0.05, 0.1, 0.05, 0.1] as const),
        border: Object.freeze({ type: "none" as const, color: "666666", widthPt: 1 }),
        valign: "top" as const,
        autoPage: false,
        autoPageCharWeight: 0,
        // PptxGenJS 4.0.1 getSlidesForTableRows: chars per line = width in pt / (fontSize / (2.3 + autoPageCharWeight));
        // its comments call 2.3 the "Character Constant" (FOCO), calibrated against PowerPoint line breaks.
        autoPageCharConstant: 2.3,
        autoPageLineWeight: 0,
        autoPageRepeatHeader: false,
        autoPageHeaderRows: 1,
        autoPageSlideStartY: 0.5,
        equalColumnWidths: true,
        equalRowHeightsWhenHeightProvided: true,
        verbose: false,
        tableToSlidesAutoPage: true,
        // addTableDefinition (step 4) converts a table x, y, w or h below 20 to EMU once more, after getSmartParseNumber
        // has already done it: `w: 0.00001` is 9 EMU, then 9 inches.
        emuReadAsInchesBelow: 20,
    }),
    shape: Object.freeze({
        x: 1,
        y: 1,
        w: 1,
        h: 1,
        align: "left" as const,
        fillWhenProvided: Object.freeze({ type: "solid" as const, transparency: 0 }),
        flipH: false,
        flipV: false,
        rotate: 0,
        rectRadius: 0,
        angleRange: Object.freeze([270, 0] as const),
        arcThicknessRatio: 0.5,
        line: Object.freeze({ type: "none" as const, color: "333333", widthPt: 1 }),
        // ECMA-376 prstDash patterns in line widths (dash, space, ...), as LibreOffice 26.2 imports
        // them (oox lineproperties.cxx lclConvertPresetDash): sysDash is 3:1 and sysDot 1:1.
        dashPatterns: Object.freeze({
            dash: [4, 3],
            dashDot: [4, 3, 1, 3],
            lgDash: [8, 3],
            lgDashDot: [8, 3, 1, 3],
            lgDashDotDot: [8, 3, 1, 3, 1, 3],
            sysDash: [3, 1],
            sysDot: [1, 1],
        } as Readonly<Record<string, readonly number[]>>),
        // PptxGenJS writes headEnd/tailEnd without w/len, so heads are "med": LibreOffice 26.2 makes them
        // 3 line widths wide and long (3.5 for `arrow`), sized from at least a 0.7 mm line.
        arrowHead: Object.freeze({ widthFactor: 3, openArrowWidthFactor: 3.5, minLineWidthMm: 0.7 }),
        // The `fill` shading of a multi-face preset's path (can, cube, bevel, ...; presetShapeDefinitions.xml): the
        // share of white (lighten*) or black (darken*) each RGB channel is blended with, floored. Office's values,
        // [MS-OI29500] 2.1.1327: 40%, and 50/255 for the "Less" modes. toHtml() writes each face's shaded fill, which
        // both renderers draw as it is (#43).
        faceShading: Object.freeze({ lighten: 0.4, lightenLess: 50 / 255, darken: 0.4, darkenLess: 50 / 255 }),
    }),
    image: Object.freeze({
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        altText: "",
        flipH: false,
        flipV: false,
        rotate: 0,
        rounding: false,
        transparency: 0,
        sizing: "stretch" as const,
        fallbackExtension: "png",
    }),
    media: Object.freeze({
        x: 0,
        y: 0,
        w: 2,
        h: 2,
        type: "audio" as const,
        fallbackExtension: "mp3",
        cover: "PptxGenJS built-in play button",
    }),
    bullet: Object.freeze({
        enabled: false,
        type: "bullet" as const,
        indentPt: 27,
        character: "•",
        numberType: "arabicPeriod" as const,
        numberStartAt: 1,
    }),
    chart: Object.freeze({
        x: 1,
        y: 1,
        w: "50%" as const,
        h: "50%" as const,
        // PptxGenJS writes `<a:latin typeface="${titleFontFace || 'Arial'}">` for the title and axis titles, and
        // `|| 'Arial'` for axis labels and data labels (gen-charts.ts); only the legend has no default (below).
        fontFace: "Arial",
        fontSizePt: 12,
        titleFontSizePt: 18,
        border: Object.freeze({ color: "363636", widthPt: 1 }),
        gridLine: Object.freeze({ color: "888888", style: "solid" as const, widthPt: 1, cap: "flat" as const }),
        scatterGridLine: Object.freeze({ color: "D9D9D9", widthPt: 1 }),
        barDirection: "col" as const,
        grouping: Object.freeze({ area: "standard" as const, bar: "clustered" as const, bar3D: "standard" as const }),
        stackedGapWidthPct: 50,
        barGapWidthPct: 150,
        barGapDepthPct: 150,
        barOverlapPct: 0,
        bar3DShape: "box" as const,
        legendPosition: "r" as const,
        // PptxGenJS omits legend <c:txPr> unless a legend font option is set; Office then
        // uses the 10pt chart text default in the theme minor (body) font.
        legendFontSizePt: 10,
        // OOXML has no legend key size: Office and LibreOffice draw the square key of a bar, area or pie entry at
        // 0.6 of the legend font size (LibreOffice chart2 VLegend: `nSymbolHeight = fViewFontSize * 0.6`).
        legendKeyFontRatio: 0.6,
        // PptxGenJS writes `<c:layout/>`: the application lays out the plot area. OOXML and PptxGenJS give no spacing;
        // LibreOffice (the visual reference) keeps 2% of the chart height between the chart edge, the legend and the
        // axis labels (chart2 lcl_getPageLayoutDistancePercentage), so the bands keep their text size as the chart grows.
        plotAreaGapRatio: 0.02,
        displayBlanksAs: "span" as const,
        radarStyle: "standard" as const,
        chartAreaRoundedCorners: true,
        lineCap: "flat" as const,
        lineDash: "solid" as const,
        lineDataSymbol: "circle" as const,
        lineDataSymbolSize: 6,
        lineDataSymbolLineSizePt: 0.75,
        lineSizePt: 2,
        lineSmooth: false,
        firstSliceAngle: 0,
        doughnutHoleSizePct: 50,
        dataBorderWidthPt: 0.75,
        dataLabelFormatCode: "#,##0",
        scatterDataLabelFormatCode: "General",
        piePercentFormatCode: "0%",
        scatterDataLabelFormat: "custom" as const,
        showLabel: false,
        showLeaderLines: false,
        showLegend: false,
        showPercent: false,
        showSeriesName: false,
        showTitle: false,
        showValue: false,
        showDataTable: false,
        categoryAxisLineVisible: true,
        // PptxGenJS writes `<c:majorTickMark val="${catAxisMajorTickMark || 'out'}"/>` on the category axis of every
        // chart but scatter (gen-charts.ts makeCatAxis).
        categoryMajorTickMark: "outside" as const,
        valueAxisLineVisible: true,
        seriesAxisLineVisible: true,
        valueAxis: Object.freeze({
            hidden: false,
            title: "Value Axis",
            titleColor: "000000",
            // PptxGenJS writes the axis title <a:defRPr> without `sz` unless valAxisTitleFontSize is set; Office then draws
            // its 10pt axis-title default (LibreOffice oox imports the same 10pt).
            titleFontSizePt: 10,
            titleRotate: undefined as number | undefined,
            labelColor: "000000",
            labelFontSizePt: 12,
            labelBold: false,
            labelItalic: false,
            labelRotate: 0,
            labelPosition: "nextTo" as const,
            labelFormatCode: "General",
            lineColor: "888888",
            lineWidthPt: 1,
            lineStyle: "solid" as const,
            lineVisible: true,
            majorTickMark: "outside" as const,
            minorTickMark: "none" as const,
        }),
        secondaryCategoryAxis: false,
        secondaryValueAxis: false,
        v3DPerspective: 30,
        v3DRightAngleAxes: false,
        v3DRotationX: 30,
        v3DRotationY: 30,
        // PptxGenJS writes no plot-area layout for bar3D either. LibreOffice centers the projected 3D box with 12.5%
        // of the chart width on each side (fixture bar3D chart, 576px wide: box from x=70.5 to 501.5).
        bar3DSideMarginRatio: 0.125,
        bar3DLighting: Object.freeze({
            topLighten: 0.18,
            sideDarken: 0.16,
            wallColor: "FFFFFF",
            floorColor: "FFFFFF",
        }),
        colors: Object.freeze({ bar: BAR_CHART_COLORS, pie: PIE_CHART_COLORS }),
    }),
    slide: Object.freeze({
        backgroundColor: "FFFFFF",
        color: "000000",
        hidden: false,
        marginIn: 0.5,
    }),
    // PptxGenJS 4.0.1's slide-number placeholder (slideObjectToXml, step 4): 800000 x 300000 EMU when `w` or `h` is
    // unset, left aligned, no anchor (top), and a run size of `fontSize || 12` once `fontFace`, `fontSize` or `color`
    // is set. With none of them set on the slide or the master, the size is the master's otherStyle 18pt.
    slideNumber: Object.freeze({
        wEmu: 800000,
        hEmu: 300000,
        align: "left" as const,
        valign: "top" as const,
        fontSizePt: 12,
        objectName: "Slide Number",
    }),
    // A background picture (`slide.background = { path | data }`) is stretched over the whole slide (PptxGenJS writes
    // `<a:stretch><a:fillRect/>` in `<p:bg>`); it is drawn as the slide's first object under this name.
    backgroundImage: Object.freeze({
        objectName: "Background",
    }),
});

/** HTML component extension defaults (not part of the PptxGenJS compatibility surface). */
export const COMPONENT_DEFAULTS = Object.freeze({ overflow: "hidden" });

/** A face's head.unitsPerEm and OS/2 usWinAscent and usWinDescent, in font units, and whether PowerPoint kerns it. */
export interface FontWinMetrics {
    readonly unitsPerEm: number;
    readonly winAscent: number;
    readonly winDescent: number;
    /**
     * Whether PowerPoint pair-kerns the face: from its `kern` table alone when it has one (version 0 with a horizontal
     * format 0 subtable), else from GPOS. `false`: PowerPoint does not kern it at any size, as with a font whose only
     * pair kerning is an Apple-format `kern` table (version 1.0) plus GPOS. Omitted: kerned from `text.kernMinSizePt`,
     * as for an unknown face.
     */
    readonly pairKerning?: boolean;
}
/** Font metrics keyed by lower-case face name. */
export type FontMetricsTable = Readonly<Record<string, FontWinMetrics>>;
/** A face's metrics by face name, or undefined when they are not known. */
export interface FontMetricsLookup {
    (fontFace: string): FontWinMetrics | undefined;
    /** The advances of a face in a weight and style, for `advanceGridPt`; missing, or undefined for a face, lays it out with the natural advances. */
    readonly glyphAdvances?: GlyphAdvanceLookup;
}
/**
 * A font's head.unitsPerEm and each character's hmtx advance width in those units, keyed by Unicode code point, and its
 * `kern` table's pair kerning in those units, keyed by the left then the right character's code point.
 */
export interface GlyphAdvances {
    readonly unitsPerEm: number;
    readonly advances: ReadonlyMap<number, number>;
    readonly kerning?: ReadonlyMap<number, ReadonlyMap<number, number>>;
}
/** A face's advances in a weight and style, or undefined when they are not known. */
export type GlyphAdvanceLookup = (fontFace: string, bold: boolean, italic: boolean) => GlyphAdvances | undefined;

/**
 * OS/2 usWinAscent and usWinDescent of common Office fonts, in units of `unitsPerEm`, keyed by lower-case face name:
 * how a single-spaced line splits between ascent and descent with the PowerPoint target (`fontLineBaseline`). Bold and
 * italic faces carry the same values. Arial, Times New Roman, Courier New and Calibri: read from the metric-compatible
 * Liberation Sans, Serif and Mono 2.1 and Carlito 1.1, and the same in the fonts PowerPoint embeds in its PDF export.
 * Cambria: Caladea's 1050/250 per 1000 differs, so these are the values of the Cambria in PowerPoint's PDF export.
 * Checked against that export of synthetic decks: the first line of an 18pt paragraph broken by `softBreakBefore` (a
 * line break PowerPoint sets in the theme font, Calibri) has its baseline 16.92pt below the top in Times New Roman (16.96
 * predicted), 16.15 in Courier New (16.12) and 17.09 in Cambria (16.99). A face not listed keeps the font-independent
 * baseline, 1em below the line top (`text.singleLineEm` - `text.lineDescentEm`). The caller's `fontMetrics` option and
 * the face's installed font (`resolveFontMetrics`, on Node by default) come before these.
 * `pairKerning`: Arial and Calibri carry a version 0 `kern` table, which PowerPoint kerns from 12pt (measured against its
 * PDF export of synthetic decks: our kerned lines match its line widths within 0.4% at 11, 12 and 18pt); Liberation Sans
 * has one too. The other faces' `kern` tables were not checked in the Microsoft fonts, so they keep the default (kerned).
 */
export const FONT_WIN_METRICS: FontMetricsTable = Object.freeze({
    arial: Object.freeze({ unitsPerEm: 2048, winAscent: 1854, winDescent: 434, pairKerning: true }),
    "times new roman": Object.freeze({ unitsPerEm: 2048, winAscent: 1825, winDescent: 443 }),
    "courier new": Object.freeze({ unitsPerEm: 2048, winAscent: 1705, winDescent: 615 }),
    calibri: Object.freeze({ unitsPerEm: 2048, winAscent: 1950, winDescent: 550, pairKerning: true }),
    cambria: Object.freeze({ unitsPerEm: 2048, winAscent: 1946, winDescent: 455 }),
});
