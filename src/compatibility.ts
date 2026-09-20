import { CORE_SVG_SHAPES } from "./normalize/shape";
import { SUPPORTED_CHART_OPTIONS } from "./normalize/chart";

export type CompatibilityStatus = "unsupported" | "partial" | "implemented" | "verified";

export interface CompatibilityEntry {
    readonly status: CompatibilityStatus;
    readonly options: Readonly<Record<string, CompatibilityStatus>>;
}

export const SHAPE_GEOMETRY_COMPATIBILITY = Object.freeze(Object.fromEntries(
    CORE_SVG_SHAPES.map(name => [name, "implemented"]),
)) as Readonly<Record<string, "implemented" | "unsupported">>;

export const CHART_OPTION_NAMES = Object.freeze([
    "align", "altText", "axisPos", "bar3DShape", "barDir", "barGapDepthPct", "barGapWidthPct",
    "barGrouping", "barOverlapPct", "bold", "border", "breakLine", "bullet", "cap", "catAxes",
    "catAxisBaseTimeUnit", "catAxisCrossesAt", "catAxisHidden", "catAxisLabelColor",
    "catAxisLabelFontBold", "catAxisLabelFontFace", "catAxisLabelFontItalic", "catAxisLabelFontSize",
    "catAxisLabelFrequency", "catAxisLabelPos", "catAxisLabelRotate", "catAxisLineColor",
    "catAxisLineShow", "catAxisLineSize", "catAxisLineStyle", "catAxisMajorTickMark",
    "catAxisMajorTimeUnit", "catAxisMajorUnit", "catAxisMaxVal", "catAxisMinVal",
    "catAxisMinorTickMark", "catAxisMinorTimeUnit", "catAxisMinorUnit", "catAxisMultiLevelLabels",
    "catAxisOrientation", "catAxisTitle", "catAxisTitleColor", "catAxisTitleFontFace",
    "catAxisTitleFontSize", "catAxisTitleRotate", "catGridLine", "catLabelFormatCode", "chartArea",
    "chartColors", "chartColorsOpacity", "color", "dataBorder", "dataLabelBkgrdColors",
    "dataLabelColor", "dataLabelFontBold", "dataLabelFontFace", "dataLabelFontItalic",
    "dataLabelFontSize", "dataLabelFormatCode", "dataLabelFormatScatter", "dataLabelPosition",
    "dataNoEffects", "dataTableFontSize", "dataTableFormatCode", "displayBlanksAs", "fill",
    "firstSliceAng", "fontFace", "fontSize", "h", "highlight", "holeSize", "invertedColors",
    "italic", "lang", "layout", "legendColor", "legendFontFace", "legendFontSize", "legendPos",
    "lineCap", "lineDash", "lineDataSymbol", "lineDataSymbolLineColor", "lineDataSymbolLineSize",
    "lineDataSymbolSize", "lineSize", "lineSmooth", "objectName", "plotArea", "radarStyle",
    "secondaryCatAxis", "secondaryValAxis", "serAxisBaseTimeUnit", "serAxisHidden",
    "serAxisLabelColor", "serAxisLabelFontBold", "serAxisLabelFontFace", "serAxisLabelFontItalic",
    "serAxisLabelFontSize", "serAxisLabelFrequency", "serAxisLabelPos", "serAxisLineColor",
    "serAxisLineShow", "serAxisMajorTimeUnit", "serAxisMajorUnit", "serAxisMinorTimeUnit",
    "serAxisMinorUnit", "serAxisOrientation", "serAxisTitle", "serAxisTitleColor",
    "serAxisTitleFontFace", "serAxisTitleFontSize", "serAxisTitleRotate", "serGridLine",
    "serLabelFormatCode", "shadow", "showCatAxisTitle", "showDataTable", "showDataTableHorzBorder",
    "showDataTableKeys", "showDataTableOutline", "showDataTableVertBorder", "showLabel",
    "showLeaderLines", "showLegend", "showPercent", "showSerAxisTitle", "showSerName", "showTitle",
    "showValAxisTitle", "showValue", "size", "softBreakBefore", "style", "tabStops",
    "textDirection", "title", "titleAlign", "titleBold", "titleColor", "titleFontFace",
    "titleFontSize", "titlePos", "titleRotate", "transparency", "underline", "v3DPerspective",
    "v3DRAngAx", "v3DRotX", "v3DRotY", "valAxes", "valAxisCrossesAt", "valAxisDisplayUnit",
    "valAxisDisplayUnitLabel", "valAxisHidden", "valAxisLabelColor", "valAxisLabelFontBold",
    "valAxisLabelFontFace", "valAxisLabelFontItalic", "valAxisLabelFontSize",
    "valAxisLabelFormatCode", "valAxisLabelPos", "valAxisLabelRotate", "valAxisLineColor",
    "valAxisLineShow", "valAxisLineSize", "valAxisLineStyle", "valAxisLogScaleBase",
    "valAxisMajorTickMark", "valAxisMajorUnit", "valAxisMaxVal", "valAxisMinVal",
    "valAxisMinorTickMark", "valAxisOrientation", "valAxisTitle", "valAxisTitleColor",
    "valAxisTitleFontFace", "valAxisTitleFontSize", "valAxisTitleRotate", "valGridLine",
    "valLabelFormatCode", "valign", "w", "x", "y",
] as const);

const IMPLEMENTED_CHART_OPTIONS = new Set<string>(SUPPORTED_CHART_OPTIONS);
const CHART_OPTION_COMPATIBILITY = Object.freeze(Object.fromEntries(
    CHART_OPTION_NAMES.map(name => [name, IMPLEMENTED_CHART_OPTIONS.has(name) ? "implemented" : "unsupported"]),
)) as Readonly<Record<typeof CHART_OPTION_NAMES[number], CompatibilityStatus>>;

export const CHART_TYPE_COMPATIBILITY = Object.freeze({
    area: "implemented",
    bar: "implemented",
    bar3D: "implemented",
    bubble: "implemented",
    bubble3D: "unsupported",
    doughnut: "implemented",
    line: "implemented",
    pie: "implemented",
    radar: "implemented",
    scatter: "implemented",
    mixed: "unsupported",
} satisfies Readonly<Record<string, CompatibilityStatus>>);

export const COMPATIBILITY = Object.freeze({
    chart: Object.freeze<CompatibilityEntry>({
        status: "partial",
        options: CHART_OPTION_COMPATIBILITY,
    }),
    text: Object.freeze<CompatibilityEntry>({
        status: "partial",
        options: Object.freeze({
            x: "verified", y: "verified", w: "verified", h: "verified", objectName: "implemented",
            plainText: "verified", numericText: "implemented", richText: "implemented",
            align: "verified", valign: "verified", bold: "verified", italic: "implemented",
            breakLine: "implemented", softBreakBefore: "implemented", hardLineBreaks: "implemented",
            emptyParagraphs: "implemented", bullet: "implemented", bulletCharacterCode: "implemented",
            bulletIndent: "implemented", bulletNumberType: "unsupported", bulletDeprecatedStyle: "implemented",
            bulletNumberStartAt: "implemented",
            color: "verified", fontFace: "implemented", fontSize: "verified", highlight: "implemented",
            lang: "implemented", tabStops: "partial", textDirection: "unsupported", transparency: "implemented",
            underline: "implemented", baseline: "implemented", charSpacing: "implemented", fit: "partial",
            fill: "implemented", flipH: "implemented", flipV: "implemented", glow: "implemented",
            hyperlink: "implemented", indentLevel: "implemented", isTextBox: "unsupported", line: "partial",
            lineSpacing: "implemented", lineSpacingMultiple: "implemented", margin: "verified",
            outline: "implemented", paraSpaceAfter: "implemented", paraSpaceBefore: "implemented",
            placeholder: "unsupported", rectRadius: "partial", rotate: "implemented",
            rtlMode: "implemented", shadow: "implemented", shape: "partial", strike: "implemented",
            subscript: "implemented", superscript: "implemented", vert: "implemented", wrap: "implemented",
            autoFit: "partial", shrinkText: "partial", inset: "unsupported", lineDash: "partial",
            lineHead: "unsupported", lineSize: "partial", lineTail: "unsupported",
            data: "unsupported", path: "unsupported",
        }),
    }),
    image: Object.freeze<CompatibilityEntry>({
        status: "partial",
        options: Object.freeze({
            x: "verified", y: "verified", w: "verified", h: "verified",
            path: "implemented", data: "verified", remotePath: "implemented", fileUrl: "implemented",
            objectName: "implemented", altText: "implemented", flipH: "verified", flipV: "verified",
            hyperlink: "implemented", placeholder: "unsupported", rotate: "verified", rounding: "verified",
            shadow: "verified", transparency: "verified", sizing: "verified", sizingContain: "verified",
            sizingCover: "verified", sizingCrop: "verified", sizingOffsets: "verified",
            png: "implemented", jpeg: "implemented", gifFirstFrame: "implemented",
            svg: "verified", webp: "implemented", malformedSourceErrors: "implemented",
        }),
    }),
    shape: Object.freeze<CompatibilityEntry>({
        status: "partial",
        options: Object.freeze({
            x: "verified", y: "verified", w: "verified", h: "verified", objectName: "implemented",
            align: "unsupported", angleRange: "implemented", arcThicknessRatio: "implemented",
            fill: "verified", fillTransparency: "implemented", flipH: "implemented", flipV: "implemented",
            hyperlink: "implemented", line: "implemented", lineTransparency: "implemented",
            lineDash: "implemented", lineBeginArrow: "implemented", lineEndArrow: "implemented",
            points: "implemented", rectRadius: "implemented", rotate: "implemented", shadow: "partial",
            rectangle: "implemented", roundedRectangle: "implemented", ellipse: "implemented", lineShape: "implemented",
            presetGeometry: "implemented", customGeometry: "implemented", arrows: "implemented",
            text: "partial", deprecatedLineSize: "implemented", deprecatedLineDash: "implemented",
            deprecatedLineHead: "implemented", deprecatedLineTail: "implemented", deprecatedShapeName: "implemented",
            lineSize: "implemented", lineHead: "implemented", lineTail: "implemented", shapeName: "implemented",
        }),
    }),
    table: Object.freeze<CompatibilityEntry>({
        status: "partial",
        options: Object.freeze({
            x: "verified", y: "verified", w: "verified", h: "verified", objectName: "implemented",
            plainText: "verified", richText: "verified", align: "verified", valign: "verified",
            bold: "verified", italic: "verified", breakLine: "verified", bullet: "verified",
            color: "verified", fontFace: "verified", fontSize: "verified", highlight: "implemented",
            lang: "implemented", softBreakBefore: "implemented", tabStops: "partial",
            textDirection: "verified", transparency: "verified", underline: "verified",
            fill: "verified", margin: "verified", border: "verified", colspan: "verified",
            rowspan: "verified", colW: "verified", rowH: "verified", inheritance: "verified",
            autoPage: "verified", autoPageCharWeight: "implemented", autoPageLineWeight: "implemented",
            autoPageRepeatHeader: "verified", autoPageHeaderRows: "verified",
            autoPageSlideStartY: "verified", newSlideStartY: "implemented",
            verbose: "unsupported", tableToSlides: "verified",
            addImage: "implemented", addShape: "verified", addTable: "implemented", addText: "verified",
            slideMargin: "verified", addHeaderToEach: "implemented", masterSlideName: "unsupported",
        }),
    }),
} as const);
