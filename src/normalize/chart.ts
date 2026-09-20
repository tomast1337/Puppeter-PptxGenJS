import type PptxGenJS from "pptxgenjs";
import { UnsupportedChartError } from "../chart/errors";
import { PPTX_DEFAULTS } from "../defaults";
import type { NormalizedChart, NormalizedChartSeries, NormalizedChartType } from "../model/types";
import { normalizeColor } from "./style";

const SUPPORTED_TYPES = new Set<NormalizedChartType>([
    "area", "bar", "bar3D", "bubble", "doughnut", "line", "pie", "radar", "scatter",
]);

/** Options rendered by the initial SVG backend. Everything else is rejected explicitly. */
export const SUPPORTED_CHART_OPTIONS = Object.freeze([
    "x", "y", "w", "h", "objectName", "altText",
    "chartColors", "chartColorsOpacity", "fontFace", "fontSize",
    "showLegend", "legendPos", "legendColor", "legendFontFace", "legendFontSize",
    "showTitle", "title", "titleBold", "titleColor", "titleFontFace", "titleFontSize",
    "bar3DShape", "barDir", "barGrouping", "barGapDepthPct", "barGapWidthPct",
    "v3DPerspective", "v3DRAngAx", "v3DRotX", "v3DRotY",
    "holeSize", "firstSliceAng", "radarStyle",
    "lineSmooth", "lineDataSymbol", "lineDataSymbolSize", "lineSize",
] as const);

const SUPPORTED_CHART_OPTION_SET = new Set<string>(SUPPORTED_CHART_OPTIONS);

function normalizeSeries(type: NormalizedChartType, data: readonly PptxGenJS.OptsChartData[]): NormalizedChartSeries[] {
    if (data.length === 0) throw new TypeError("Chart data must contain at least one series");
    return data.map((series, index) => {
        const rawLabels = series.labels ?? [];
        if (rawLabels.some(Array.isArray)) {
            throw new UnsupportedChartError({
                reason: "chart-option",
                chartTypes: [type],
                unsupportedOptions: ["data.labels[multi-level]"],
            });
        }
        const labels = (rawLabels as string[]).map(label => String(label));
        const values = (series.values ?? []).map((value, valueIndex) => {
            if (typeof value !== "number" || !Number.isFinite(value)) {
                throw new TypeError(`Chart series ${index} value ${valueIndex} must be a finite number`);
            }
            return value;
        });
        const sizes = series.sizes?.map((value, valueIndex) => {
            if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
                throw new TypeError(`Chart series ${index} bubble size ${valueIndex} must be a non-negative finite number`);
            }
            return value;
        });
        return {
            type,
            name: series.name ?? `Series ${index + 1}`,
            labels,
            values,
            sizes,
        };
    });
}

function rejectUnsupportedOptions(type: string, options: PptxGenJS.IChartOpts): void {
    const unsupported = Object.keys(options)
        .filter(key => options[key as keyof PptxGenJS.IChartOpts] !== undefined)
        .filter(key => !SUPPORTED_CHART_OPTION_SET.has(key))
        .sort();
    if (unsupported.length) {
        throw new UnsupportedChartError({
            reason: "chart-option",
            chartTypes: [type],
            unsupportedOptions: unsupported,
        });
    }
}

function automaticValueBounds(
    type: NormalizedChartType,
    series: readonly NormalizedChartSeries[],
    grouping: NormalizedChart["grouping"],
): [number, number] {
    let values = type === "scatter" || type === "bubble"
        ? series.slice(1).flatMap(item => item.values)
        : series.flatMap(item => item.values);
    if (grouping === "stacked" || grouping === "percentStacked") {
        const categoryCount = Math.max(0, ...series.map(item => item.values.length));
        values = Array.from({ length: categoryCount }, (_, index) => {
            const categoryValues = series.map(item => item.values[index] ?? 0);
            const positive = categoryValues.filter(value => value >= 0).reduce((sum, value) => sum + value, 0);
            const negative = categoryValues.filter(value => value < 0).reduce((sum, value) => sum + value, 0);
            if (grouping !== "percentStacked") return [positive, negative];
            const total = categoryValues.reduce((sum, value) => sum + Math.abs(value), 0);
            return total === 0 ? [0, 0] : [positive / total * 100, negative / total * 100];
        }).flat();
    }
    const minimum = Math.min(0, ...values);
    const maximum = Math.max(0, ...values);
    if (minimum === maximum) return minimum === 0 ? [0, 1] : [minimum, maximum];
    const largest = Math.max(Math.abs(minimum), Math.abs(maximum));
    const magnitude = 10 ** Math.floor(Math.log10(largest));
    const normalized = largest / magnitude;
    const step = normalized <= 1 ? magnitude / 10
        : normalized <= 2 ? magnitude / 5
            : normalized <= 5 ? magnitude / 2
                : magnitude;
    const upperMultiple = Math.ceil(maximum / step);
    const lowerMultiple = Math.floor(minimum / step);
    const upper = (upperMultiple * step === maximum ? upperMultiple + 1 : upperMultiple) * step;
    const lower = minimum < 0
        ? (lowerMultiple * step === minimum ? lowerMultiple - 1 : lowerMultiple) * step
        : 0;
    return [lower, upper];
}

export function normalizeChart(
    type: PptxGenJS.CHART_NAME | PptxGenJS.IChartMulti[],
    data: readonly PptxGenJS.OptsChartData[],
    options: PptxGenJS.IChartOpts = {},
): NormalizedChart {
    if (Array.isArray(type)) {
        throw new UnsupportedChartError({
            reason: "chart-combination",
            chartTypes: type.map(chart => chart.type),
        });
    }
    if (!SUPPORTED_TYPES.has(type as NormalizedChartType)) {
        throw new UnsupportedChartError({ reason: "chart-type", chartTypes: [String(type)] });
    }

    rejectUnsupportedOptions(type, options);
    const normalizedType = type as NormalizedChartType;
    const palette = options.chartColors?.length
        ? options.chartColors
        : type === "pie" || type === "doughnut" ? PPTX_DEFAULTS.chart.colors.pie : PPTX_DEFAULTS.chart.colors.bar;
    const grouping = options.barGrouping;
    const bar3DShapes = new Set(["box", "cylinder", "cone", "coneToMax", "pyramid", "pyramidToMax"]);

    const series = normalizeSeries(normalizedType, data);
    if ((type === "pie" || type === "doughnut") && series.length !== 1) {
        throw new UnsupportedChartError({
            reason: "chart-option",
            chartTypes: [type],
            unsupportedOptions: ["data[multiple-series]"],
        });
    }
    if ((type === "scatter" || type === "bubble") && series.length < 2) {
        throw new TypeError(`${type} charts require an X-value series followed by at least one Y-value series`);
    }
    if (type === "bubble" && series.slice(1).some(item => !item.sizes)) {
        throw new TypeError("Bubble Y-value series must include sizes");
    }
    if (!["scatter", "bubble", "pie", "doughnut"].includes(type)) {
        const labels = JSON.stringify(series[0]?.labels ?? []);
        if (series.some(item => JSON.stringify(item.labels) !== labels)) {
            throw new UnsupportedChartError({
                reason: "chart-option",
                chartTypes: [type],
                unsupportedOptions: ["data.labels[per-series]"],
            });
        }
    }
    const normalizedGrouping = grouping === "stacked" || grouping === "percentStacked" || grouping === "standard" || grouping === "clustered"
        ? grouping
        : type === "bar3D" ? PPTX_DEFAULTS.chart.grouping.bar3D : PPTX_DEFAULTS.chart.grouping.bar;
    const [valueAxisMinimum, valueAxisMaximum] = automaticValueBounds(normalizedType, series, normalizedGrouping);

    return {
        type: normalizedType,
        series,
        colors: palette.map(color => normalizeColor(color)),
        colorOpacity: Math.max(0, Math.min(1, (options.chartColorsOpacity ?? 100) / 100)),
        showLegend: options.showLegend ?? PPTX_DEFAULTS.chart.showLegend,
        legendPosition: options.legendPos ?? PPTX_DEFAULTS.chart.legendPosition,
        showTitle: options.showTitle ?? PPTX_DEFAULTS.chart.showTitle,
        title: options.title ?? "Chart Title",
        fontFace: options.fontFace ?? PPTX_DEFAULTS.text.fontFace,
        fontSize: options.fontSize ?? PPTX_DEFAULTS.chart.fontSizePt,
        titleFontFace: options.titleFontFace ?? options.fontFace ?? PPTX_DEFAULTS.theme.headFontFace,
        titleFontSize: options.titleFontSize ?? PPTX_DEFAULTS.chart.titleFontSizePt,
        titleBold: options.titleBold ?? false,
        titleColor: normalizeColor(options.titleColor ?? PPTX_DEFAULTS.text.color),
        legendFontFace: options.legendFontFace ?? options.fontFace ?? PPTX_DEFAULTS.text.fontFace,
        legendFontSize: options.legendFontSize ?? options.fontSize ?? PPTX_DEFAULTS.chart.fontSizePt,
        legendColor: normalizeColor(options.legendColor ?? PPTX_DEFAULTS.text.color),
        barDirection: options.barDir === "bar" ? "bar" : PPTX_DEFAULTS.chart.barDirection,
        grouping: normalizedGrouping,
        barGapWidthPercent: Math.max(0, Math.min(1000, options.barGapWidthPct ?? PPTX_DEFAULTS.chart.barGapWidthPct)),
        barGapDepthPercent: Math.max(0, Math.min(1000, options.barGapDepthPct ?? PPTX_DEFAULTS.chart.barGapDepthPct)),
        bar3DShape: bar3DShapes.has(options.bar3DShape ?? "")
            ? options.bar3DShape as NormalizedChart["bar3DShape"]
            : PPTX_DEFAULTS.chart.bar3DShape,
        perspective3D: Math.max(0, Math.min(240, options.v3DPerspective ?? PPTX_DEFAULTS.chart.v3DPerspective)),
        rightAngleAxes3D: options.v3DRAngAx ?? PPTX_DEFAULTS.chart.v3DRightAngleAxes,
        rotationX3D: Math.max(-90, Math.min(90, options.v3DRotX ?? PPTX_DEFAULTS.chart.v3DRotationX)),
        rotationY3D: ((options.v3DRotY ?? PPTX_DEFAULTS.chart.v3DRotationY) % 360 + 360) % 360,
        gridLineColor: normalizeColor(PPTX_DEFAULTS.chart.gridLine.color),
        gridLineWidth: PPTX_DEFAULTS.chart.gridLine.widthPt,
        axisLineVisible: PPTX_DEFAULTS.chart.categoryAxisLineVisible,
        valueAxisMinimum,
        valueAxisMaximum,
        doughnutHoleSize: Math.max(0, Math.min(90, options.holeSize ?? PPTX_DEFAULTS.chart.doughnutHoleSizePct)),
        firstSliceAngle: ((options.firstSliceAng ?? PPTX_DEFAULTS.chart.firstSliceAngle) % 360 + 360) % 360,
        radarStyle: options.radarStyle ?? PPTX_DEFAULTS.chart.radarStyle,
        lineSmooth: options.lineSmooth ?? PPTX_DEFAULTS.chart.lineSmooth,
        lineSymbol: options.lineDataSymbol ?? PPTX_DEFAULTS.chart.lineDataSymbol,
        lineSymbolSize: options.lineDataSymbolSize ?? PPTX_DEFAULTS.chart.lineDataSymbolSize,
        lineSize: options.lineSize ?? PPTX_DEFAULTS.chart.lineSizePt,
        altText: options.altText ?? "",
    };
}
