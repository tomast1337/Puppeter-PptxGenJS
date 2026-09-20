import { inchesToPixels, pointsToPixels } from "./utils";

export type FourSideMargin = [number, number, number, number];

export const PPTX_DEFAULTS_VERSION = "pptxgenjs@4.0.1";

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
        cssDpi: 96,
        pointsPerInch: 72,
        emuPerInch: 914400,
        emuPerPoint: 12700,
    }),
    presentation: Object.freeze({
        layout: "LAYOUT_16x9",
        layoutName: "DEFAULT",
        layouts: Object.freeze({
            LAYOUT_4x3: Object.freeze({ width: 10, height: 7.5 }),
            LAYOUT_16x9: Object.freeze({ width: 10, height: 5.625 }),
            LAYOUT_16x10: Object.freeze({ width: 10, height: 6.25 }),
            LAYOUT_WIDE: Object.freeze({ width: 13.333333, height: 7.5 }),
        }),
        rtlMode: false,
        metadata: Object.freeze({
            author: "PptxGenJS",
            company: "PptxGenJS",
            revision: "1",
            subject: "PptxGenJS Presentation",
            title: "PptxGenJS Presentation",
        }),
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
    }),
    fill: Object.freeze({ whenProvidedType: "solid" as const, transparency: 0 }),
    border: Object.freeze({ whenProvidedType: "solid" as const, color: "666666", widthPt: 1 }),
    shadow: Object.freeze({
        absentType: "none" as const,
        blurPt: 0,
        angle: 0,
        offsetPt: 0,
        rotateWithShape: false,
        shapeWhenEnabled: Object.freeze({
            type: "outer" as const,
            blurPt: 3,
            offsetPt: 23000 / 12700,
            angle: 90,
            color: "000000",
            opacity: 0.35,
            rotateWithShape: true,
        }),
        textColorWhenEnabled: "000000",
    }),
    text: Object.freeze({
        color: "000000",
        fontFace: "Calibri",
        fontSizePt: 18,
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
        flipH: false,
        flipV: false,
        rotate: 0,
        rtlMode: false,
        x: 0,
        y: 0,
        w: "75%" as const,
        h: 0.3,
        // PowerPoint's Normal text-box inset: top, right, bottom, left.
        marginIn: Object.freeze([0.05, 0.1, 0.05, 0.1] as const),
        glowWhenEnabled: Object.freeze({ sizePt: 8, color: "FFFFFF", opacity: 0.75 }),
    }),
    table: Object.freeze({
        x: 0.5,
        y: 0.5,
        fontSizePt: 12,
        color: "000000",
        // PptxGenJS DEF_CELL_MARGIN_IN: top, right, bottom, left.
        marginIn: Object.freeze([0.05, 0.1, 0.05, 0.1] as const),
        border: Object.freeze({ type: "none" as const, color: "666666", widthPt: 1 }),
        valign: "top" as const,
        autoPage: false,
        autoPageCharWeight: 0,
        autoPageLineWeight: 0,
        autoPageRepeatHeader: false,
        autoPageHeaderRows: 1,
        autoPageSlideStartY: 0.5,
        equalColumnWidths: true,
        equalRowHeightsWhenHeightProvided: true,
        verbose: false,
        tableToSlidesAutoPage: true,
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
        valueAxisLineVisible: true,
        seriesAxisLineVisible: true,
        valueAxis: Object.freeze({
            hidden: false,
            title: "Value Axis",
            titleColor: "000000",
            titleFontSizePt: 12,
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
});

function padding(top: number, right: number, bottom: number, left: number): string {
    const px = (value: number) => `${Number(value.toFixed(6))}px`;
    return `${px(top)} ${px(right)} ${px(bottom)} ${px(left)}`;
}

/**
 * PptxGenJS text margins are points. Its v4.0.1 array implementation emits
 * [left, right, bottom, top], despite the public type documentation saying
 * [top, right, bottom, left]. This intentionally mirrors emitted OOXML.
 */
export function textMarginToCSS(margin?: number | FourSideMargin): string {
    if (margin === undefined) {
        const [top, right, bottom, left] = PPTX_DEFAULTS.text.marginIn;
        return padding(...([top, right, bottom, left].map(inchesToPixels) as FourSideMargin));
    }
    if (typeof margin === "number") {
        const value = pointsToPixels(margin);
        return padding(value, value, value, value);
    }

    const [left, right, bottom, top] = margin.map(pointsToPixels) as FourSideMargin;
    return padding(top, right, bottom, left);
}

/** Table margins use TRBL order; values below 1 are inches, otherwise points. */
export function tableMarginToCSS(margin?: number | FourSideMargin): string {
    const values = margin === undefined ? ([...PPTX_DEFAULTS.table.marginIn] as FourSideMargin) : typeof margin === "number" ? ([margin, margin, margin, margin] as FourSideMargin) : margin;
    const convert = values[0] >= 1 ? pointsToPixels : inchesToPixels;
    const [top, right, bottom, left] = values.map(convert) as FourSideMargin;
    return padding(top, right, bottom, left);
}
