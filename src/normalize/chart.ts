import type PptxGenJS from "pptxgenjs";
import { UnsupportedChartError } from "../chart/errors";
import { isSupportedChartNumberFormat } from "../chart/format";
import { PPTX_DEFAULTS } from "../defaults";
import type { NormalizedChart, NormalizedChartSeries, NormalizedChartType } from "../model/types";
import { normalizeColor } from "./style";

const SUPPORTED_TYPES = new Set<NormalizedChartType>(["area", "bar", "bar3D", "bubble", "doughnut", "line", "mixed", "pie", "radar", "scatter"]);

const MIXED_CHART_TYPES = new Set<PptxGenJS.CHART_NAME>(["area", "bar", "line"]);

/** Options rendered by the initial SVG backend. Everything else is rejected explicitly. */
export const SUPPORTED_CHART_OPTIONS = Object.freeze([
    "x",
    "y",
    "w",
    "h",
    "objectName",
    "altText",
    "chartColors",
    "chartColorsOpacity",
    "fontFace",
    "fontSize",
    "showLegend",
    "legendPos",
    "legendColor",
    "legendFontFace",
    "legendFontSize",
    "showTitle",
    "title",
    "titleBold",
    "titleColor",
    "titleFontFace",
    "titleFontSize",
    "bar3DShape",
    "barDir",
    "barGrouping",
    "barGapDepthPct",
    "barGapWidthPct",
    "v3DPerspective",
    "v3DRAngAx",
    "v3DRotX",
    "v3DRotY",
    "showValAxisTitle",
    "valAxes",
    "valAxisHidden",
    "valAxisMaxVal",
    "valAxisMinVal",
    "valAxisTitle",
    "valAxisLabelColor",
    "valAxisLabelFontBold",
    "valAxisLabelFontFace",
    "valAxisLabelFontItalic",
    "valAxisLabelFontSize",
    "valAxisLabelFormatCode",
    "valAxisLabelPos",
    "valAxisLabelRotate",
    "valAxisLineColor",
    "valAxisLineShow",
    "valAxisLineSize",
    "valAxisLineStyle",
    "valAxisLogScaleBase",
    "valAxisMajorTickMark",
    "valAxisMajorUnit",
    "valAxisMinorTickMark",
    "valAxisOrientation",
    "valAxisTitleColor",
    "valAxisTitleFontFace",
    "valAxisTitleFontSize",
    "valAxisTitleRotate",
    "valGridLine",
    "holeSize",
    "firstSliceAng",
    "radarStyle",
    "lineSmooth",
    "lineDataSymbol",
    "lineDataSymbolSize",
    "lineSize",
] as const);

const SUPPORTED_CHART_OPTION_SET = new Set<string>(SUPPORTED_CHART_OPTIONS);
const SUPPORTED_MIXED_SERIES_OPTIONS = new Set(["secondaryValAxis"]);
const SUPPORTED_VALUE_AXIS_OPTIONS = new Set([
    "showValAxisTitle",
    "valAxisHidden",
    "valAxisMaxVal",
    "valAxisMinVal",
    "valAxisTitle",
    "valAxisLabelColor",
    "valAxisLabelFontBold",
    "valAxisLabelFontFace",
    "valAxisLabelFontItalic",
    "valAxisLabelFontSize",
    "valAxisLabelFormatCode",
    "valAxisLabelPos",
    "valAxisLabelRotate",
    "valAxisLineColor",
    "valAxisLineShow",
    "valAxisLineSize",
    "valAxisLineStyle",
    "valAxisLogScaleBase",
    "valAxisMajorTickMark",
    "valAxisMajorUnit",
    "valAxisMinorTickMark",
    "valAxisOrientation",
    "valAxisTitleColor",
    "valAxisTitleFontFace",
    "valAxisTitleFontSize",
    "valAxisTitleRotate",
    "valGridLine",
]);
const SUPPORTED_GRID_LINE_OPTIONS = new Set(["cap", "color", "size", "style"]);
const BAR_3D_SHAPES = new Set(["box", "cylinder", "cone", "coneToMax", "pyramid", "pyramidToMax"]);

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
            colorIndex: index,
            varyColors: false,
            valueAxisIndex: 0,
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

function automaticValueBounds(type: NormalizedChartType, series: readonly NormalizedChartSeries[], grouping: NormalizedChart["grouping"]): [number, number] {
    let values = type === "scatter" || type === "bubble" ? series.slice(1).flatMap(item => item.values) : series.flatMap(item => item.values);
    if (grouping === "stacked" || grouping === "percentStacked") {
        const categoryCount = Math.max(0, ...series.map(item => item.values.length));
        values = Array.from({ length: categoryCount }, (_, index) => {
            const categoryValues = series.map(item => item.values[index] ?? 0);
            const positive = categoryValues.filter(value => value >= 0).reduce((sum, value) => sum + value, 0);
            const negative = categoryValues.filter(value => value < 0).reduce((sum, value) => sum + value, 0);
            if (grouping !== "percentStacked") return [positive, negative];
            const total = categoryValues.reduce((sum, value) => sum + Math.abs(value), 0);
            return total === 0 ? [0, 0] : [(positive / total) * 100, (negative / total) * 100];
        }).flat();
    }
    const minimum = Math.min(0, ...values);
    const maximum = Math.max(0, ...values);
    if (minimum === maximum) return minimum === 0 ? [0, 1] : [minimum, maximum];
    const largest = Math.max(Math.abs(minimum), Math.abs(maximum));
    const magnitude = 10 ** Math.floor(Math.log10(largest));
    const normalized = largest / magnitude;
    const step = normalized <= 1 ? magnitude / 10 : normalized <= 2 ? magnitude / 5 : normalized <= 5 ? magnitude / 2 : magnitude;
    const upperMultiple = Math.ceil(maximum / step);
    const lowerMultiple = Math.floor(minimum / step);
    const upper = (upperMultiple * step === maximum ? upperMultiple + 1 : upperMultiple) * step;
    const lower = minimum < 0 ? (lowerMultiple * step === minimum ? lowerMultiple - 1 : lowerMultiple) * step : 0;
    return [lower, upper];
}

function positiveNumber(value: number | undefined, name: string, fallback: number): number {
    const normalized = value ?? fallback;
    if (!Number.isFinite(normalized) || normalized <= 0) throw new TypeError(`${name} must be a positive finite number`);
    return normalized;
}

function finiteNumber(value: number | undefined, name: string, fallback: number): number {
    const normalized = value ?? fallback;
    if (!Number.isFinite(normalized)) throw new TypeError(`${name} must be a finite number`);
    return normalized;
}

interface ValidatedAxisValues {
    minimum: number;
    maximum: number;
    majorUnit?: number;
    logScaleBase?: number;
    labelFormatCode: string;
}

function validateValueAxis(
    axisOptions: PptxGenJS.IChartPropsAxisVal | undefined,
    automatic: [number, number],
    path: string,
    chartTypes: PptxGenJS.CHART_NAME[],
): ValidatedAxisValues {
    const minimum = axisOptions?.valAxisMinVal ?? automatic[0];
    const maximum = axisOptions?.valAxisMaxVal ?? automatic[1];
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum >= maximum) {
        throw new TypeError("Chart value-axis minimum must be less than its maximum");
    }
    const logScaleBase = axisOptions?.valAxisLogScaleBase;
    if (logScaleBase !== undefined && (!Number.isFinite(logScaleBase) || logScaleBase < 2 || logScaleBase > 99)) {
        throw new RangeError("valAxisLogScaleBase must be between 2 and 99");
    }
    if (logScaleBase !== undefined && minimum <= 0) throw new TypeError("A logarithmic value axis requires a positive minimum");

    const majorUnit = axisOptions?.valAxisMajorUnit;
    if (majorUnit !== undefined && (!Number.isFinite(majorUnit) || majorUnit <= 0)) {
        throw new TypeError("valAxisMajorUnit must be a positive finite number");
    }
    if (axisOptions?.valAxisMajorTickMark === "cross" || axisOptions?.valAxisMinorTickMark === "cross") {
        const option = axisOptions.valAxisMajorTickMark === "cross" ? "valAxisMajorTickMark" : "valAxisMinorTickMark";
        throw new UnsupportedChartError({ reason: "chart-option", chartTypes, unsupportedOptions: [`${path}${option}[cross]`] });
    }
    const labelFormatCode = axisOptions?.valAxisLabelFormatCode ?? PPTX_DEFAULTS.chart.valueAxis.labelFormatCode;
    if (!isSupportedChartNumberFormat(labelFormatCode)) {
        throw new UnsupportedChartError({ reason: "chart-option", chartTypes, unsupportedOptions: ["valAxisLabelFormatCode[format]"] });
    }
    return { minimum, maximum, majorUnit, logScaleBase, labelFormatCode };
}

function normalizeValueAxis(
    axisOptions: PptxGenJS.IChartPropsAxisVal | undefined,
    automatic: [number, number],
    path: string,
    options: PptxGenJS.IChartOpts,
    chartTypes: PptxGenJS.CHART_NAME[],
): NormalizedChart["valueAxes"][number] {
    const defaults = PPTX_DEFAULTS.chart.valueAxis;
    const values = validateValueAxis(axisOptions, automatic, path, chartTypes);
    const gridLine = axisOptions?.valGridLine;
    return {
        ...values,
        hidden: axisOptions?.valAxisHidden ?? defaults.hidden,
        showTitle: axisOptions?.showValAxisTitle ?? false,
        title: axisOptions?.valAxisTitle ?? defaults.title,
        titleColor: normalizeColor(axisOptions?.valAxisTitleColor ?? defaults.titleColor),
        titleFontFace: axisOptions?.valAxisTitleFontFace ?? options.fontFace ?? PPTX_DEFAULTS.text.fontFace,
        titleFontSize: positiveNumber(axisOptions?.valAxisTitleFontSize, "valAxisTitleFontSize", defaults.titleFontSizePt),
        titleRotate:
            axisOptions?.valAxisTitleRotate === undefined ? defaults.titleRotate : finiteNumber(axisOptions.valAxisTitleRotate, "valAxisTitleRotate", 0),
        labelColor: normalizeColor(axisOptions?.valAxisLabelColor ?? defaults.labelColor),
        labelFontFace: axisOptions?.valAxisLabelFontFace ?? options.fontFace ?? PPTX_DEFAULTS.text.fontFace,
        labelFontSize: positiveNumber(axisOptions?.valAxisLabelFontSize, "valAxisLabelFontSize", options.fontSize ?? defaults.labelFontSizePt),
        labelBold: axisOptions?.valAxisLabelFontBold ?? defaults.labelBold,
        labelItalic: axisOptions?.valAxisLabelFontItalic ?? defaults.labelItalic,
        labelRotate: finiteNumber(axisOptions?.valAxisLabelRotate, "valAxisLabelRotate", defaults.labelRotate),
        labelPosition: axisOptions?.valAxisLabelPos ?? defaults.labelPosition,
        lineColor: normalizeColor(axisOptions?.valAxisLineColor ?? defaults.lineColor),
        lineWidth: positiveNumber(axisOptions?.valAxisLineSize, "valAxisLineSize", defaults.lineWidthPt),
        lineStyle: axisOptions?.valAxisLineStyle ?? defaults.lineStyle,
        lineVisible: axisOptions?.valAxisLineShow ?? defaults.lineVisible,
        majorTickMark: axisOptions?.valAxisMajorTickMark ?? defaults.majorTickMark,
        minorTickMark: axisOptions?.valAxisMinorTickMark ?? defaults.minorTickMark,
        gridLineColor: normalizeColor(gridLine?.color ?? PPTX_DEFAULTS.chart.gridLine.color),
        gridLineWidth: positiveNumber(gridLine?.size, "valGridLine.size", PPTX_DEFAULTS.chart.gridLine.widthPt),
        gridLineStyle: gridLine?.style ?? PPTX_DEFAULTS.chart.gridLine.style,
        gridLineCap: gridLine?.cap ?? PPTX_DEFAULTS.chart.gridLine.cap,
    };
}

type ChartInputType = PptxGenJS.CHART_NAME | PptxGenJS.IChartMulti[];

function validateChartRequest(type: ChartInputType, options: PptxGenJS.IChartOpts, chartTypes: PptxGenJS.CHART_NAME[]): void {
    const mixed = Array.isArray(type);
    if (mixed && (type.length === 0 || type.some(chart => !MIXED_CHART_TYPES.has(chart.type)))) {
        throw new UnsupportedChartError({ reason: "chart-combination", chartTypes });
    }
    if (!mixed && !SUPPORTED_TYPES.has(type as NormalizedChartType)) {
        throw new UnsupportedChartError({ reason: "chart-type", chartTypes: [String(type)] });
    }
    if (mixed) {
        const unsupported = type.flatMap((chart, index) =>
            Object.keys(chart.options ?? {})
                .filter(key => chart.options[key as keyof PptxGenJS.IChartOpts] !== undefined)
                .filter(key => !SUPPORTED_MIXED_SERIES_OPTIONS.has(key))
                .map(key => `series[${index}].options.${key}`),
        );
        if (unsupported.length) {
            throw new UnsupportedChartError({ reason: "chart-option", chartTypes, unsupportedOptions: unsupported.sort() });
        }
    }

    const valueAxes = options.valAxes ?? [];
    const unsupported = [
        ...valueAxes.flatMap((axis, index) =>
            Object.keys(axis)
                .filter(key => axis[key as keyof PptxGenJS.IChartPropsAxisVal] !== undefined)
                .filter(key => !SUPPORTED_VALUE_AXIS_OPTIONS.has(key))
                .map(key => `valAxes[${index}].${key}`),
        ),
        ...valueAxes.flatMap((axis, index) =>
            Object.keys(axis.valGridLine ?? {})
                .filter(key => !SUPPORTED_GRID_LINE_OPTIONS.has(key))
                .map(key => `valAxes[${index}].valGridLine.${key}`),
        ),
        ...Object.keys(options.valGridLine ?? {})
            .filter(key => !SUPPORTED_GRID_LINE_OPTIONS.has(key))
            .map(key => `valGridLine.${key}`),
    ];
    if (unsupported.length) throw new UnsupportedChartError({ reason: "chart-option", chartTypes, unsupportedOptions: unsupported.sort() });
    rejectUnsupportedOptions(mixed ? "mixed" : type, options);
}

function normalizeInputSeries(type: ChartInputType, data: readonly PptxGenJS.OptsChartData[], normalizedType: NormalizedChartType): NormalizedChartSeries[] {
    if (!Array.isArray(type)) return normalizeSeries(normalizedType, data);
    return type.flatMap(chart =>
        normalizeSeries(chart.type as NormalizedChartType, chart.data).map(series => ({
            ...series,
            // PptxGenJS restarts colors within each mixed chart-type group.
            varyColors: chart.type === "bar" && chart.data.length === 1,
            valueAxisIndex: chart.options?.secondaryValAxis ? (1 as const) : (0 as const),
        })),
    );
}

function validateChartSeries(type: NormalizedChartType, series: NormalizedChartSeries[], chartTypes: PptxGenJS.CHART_NAME[]): void {
    if ((type === "pie" || type === "doughnut") && series.length !== 1) {
        throw new UnsupportedChartError({ reason: "chart-option", chartTypes, unsupportedOptions: ["data[multiple-series]"] });
    }
    if ((type === "scatter" || type === "bubble") && series.length < 2) {
        throw new TypeError(`${type} charts require an X-value series followed by at least one Y-value series`);
    }
    if (type === "bubble" && series.slice(1).some(item => !item.sizes)) throw new TypeError("Bubble Y-value series must include sizes");
    if (["scatter", "bubble", "pie", "doughnut"].includes(type)) return;

    const labels = JSON.stringify(series[0]?.labels ?? []);
    if (series.some(item => JSON.stringify(item.labels) !== labels)) {
        throw new UnsupportedChartError({ reason: "chart-option", chartTypes, unsupportedOptions: ["data.labels[per-series]"] });
    }
}

function normalizeGrouping(type: NormalizedChartType, grouping: PptxGenJS.IChartOpts["barGrouping"]): NormalizedChart["grouping"] {
    if (grouping === "stacked" || grouping === "percentStacked" || grouping === "standard" || grouping === "clustered") return grouping;
    return type === "bar3D" ? PPTX_DEFAULTS.chart.grouping.bar3D : PPTX_DEFAULTS.chart.grouping.bar;
}

function validateValueAxisCount(series: NormalizedChartSeries[], valueAxes: PptxGenJS.IChartPropsAxisVal[], chartTypes: PptxGenJS.CHART_NAME[]): boolean {
    const hasSecondary = series.some(item => item.valueAxisIndex === 1);
    if (hasSecondary && valueAxes.length !== 2) {
        throw new UnsupportedChartError({ reason: "chart-option", chartTypes, unsupportedOptions: ["valAxes[primary,secondary]"] });
    }
    if (!hasSecondary && valueAxes.length > 1) {
        throw new UnsupportedChartError({ reason: "chart-combination", chartTypes, unsupportedOptions: ["valAxes[secondary-without-series]"] });
    }
    return hasSecondary;
}

function chartTextOptions(options: PptxGenJS.IChartOpts) {
    return {
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
    };
}

function chartBarOptions(options: PptxGenJS.IChartOpts) {
    return {
        barDirection: options.barDir === "bar" ? ("bar" as const) : PPTX_DEFAULTS.chart.barDirection,
        barGapWidthPercent: Math.max(0, Math.min(1000, options.barGapWidthPct ?? PPTX_DEFAULTS.chart.barGapWidthPct)),
        barGapDepthPercent: Math.max(0, Math.min(1000, options.barGapDepthPct ?? PPTX_DEFAULTS.chart.barGapDepthPct)),
        bar3DShape: BAR_3D_SHAPES.has(options.bar3DShape ?? "") ? (options.bar3DShape as NormalizedChart["bar3DShape"]) : PPTX_DEFAULTS.chart.bar3DShape,
        perspective3D: Math.max(0, Math.min(240, options.v3DPerspective ?? PPTX_DEFAULTS.chart.v3DPerspective)),
        rightAngleAxes3D: options.v3DRAngAx ?? PPTX_DEFAULTS.chart.v3DRightAngleAxes,
        rotationX3D: Math.max(-90, Math.min(90, options.v3DRotX ?? PPTX_DEFAULTS.chart.v3DRotationX)),
        rotationY3D: (((options.v3DRotY ?? PPTX_DEFAULTS.chart.v3DRotationY) % 360) + 360) % 360,
    };
}

function chartSpecialOptions(options: PptxGenJS.IChartOpts) {
    return {
        doughnutHoleSize: Math.max(0, Math.min(90, options.holeSize ?? PPTX_DEFAULTS.chart.doughnutHoleSizePct)),
        firstSliceAngle: (((options.firstSliceAng ?? PPTX_DEFAULTS.chart.firstSliceAngle) % 360) + 360) % 360,
        radarStyle: options.radarStyle ?? PPTX_DEFAULTS.chart.radarStyle,
        lineSmooth: options.lineSmooth ?? PPTX_DEFAULTS.chart.lineSmooth,
        lineSymbol: options.lineDataSymbol ?? PPTX_DEFAULTS.chart.lineDataSymbol,
        lineSymbolSize: options.lineDataSymbolSize ?? PPTX_DEFAULTS.chart.lineDataSymbolSize,
        lineSize: options.lineSize ?? PPTX_DEFAULTS.chart.lineSizePt,
        altText: options.altText ?? "",
    };
}

export function normalizeChart(type: ChartInputType, data: readonly PptxGenJS.OptsChartData[], options: PptxGenJS.IChartOpts = {}): NormalizedChart {
    const mixed = Array.isArray(type);
    const chartTypes = mixed ? type.map(chart => chart.type) : [type];
    validateChartRequest(type, options, chartTypes);
    const valueAxisOptions = options.valAxes ?? [];
    const normalizedType: NormalizedChartType = mixed ? "mixed" : (type as NormalizedChartType);
    const palette = options.chartColors?.length
        ? options.chartColors
        : normalizedType === "pie" || normalizedType === "doughnut"
          ? PPTX_DEFAULTS.chart.colors.pie
          : PPTX_DEFAULTS.chart.colors.bar;
    const series = normalizeInputSeries(type, data, normalizedType);
    validateChartSeries(normalizedType, series, chartTypes);
    const normalizedGrouping = normalizeGrouping(normalizedType, options.barGrouping);
    const hasSecondaryValueAxis = validateValueAxisCount(series, valueAxisOptions, chartTypes);
    const axisSeries = (axisIndex: 0 | 1) => series.filter(item => item.valueAxisIndex === axisIndex);
    const automaticPrimary = automaticValueBounds(normalizedType, axisSeries(0), normalizedGrouping);
    const automaticSecondary = hasSecondaryValueAxis ? automaticValueBounds(normalizedType, axisSeries(1), normalizedGrouping) : undefined;
    const primaryAxis = normalizeValueAxis(valueAxisOptions[0] ?? options, automaticPrimary, valueAxisOptions[0] ? "valAxes[0]." : "", options, chartTypes);
    const valueAxes = [primaryAxis];
    if (automaticSecondary) valueAxes.push(normalizeValueAxis(valueAxisOptions[1], automaticSecondary, "valAxes[1].", options, chartTypes));

    return {
        type: normalizedType,
        series,
        colors: palette.map(color => normalizeColor(color)),
        colorOpacity: Math.max(0, Math.min(1, (options.chartColorsOpacity ?? 100) / 100)),
        ...chartTextOptions(options),
        ...chartBarOptions(options),
        ...chartSpecialOptions(options),
        grouping: normalizedGrouping,
        gridLineColor: normalizeColor(PPTX_DEFAULTS.chart.gridLine.color),
        gridLineWidth: PPTX_DEFAULTS.chart.gridLine.widthPt,
        axisLineVisible: PPTX_DEFAULTS.chart.categoryAxisLineVisible,
        valueAxisMinimum: primaryAxis.minimum,
        valueAxisMaximum: primaryAxis.maximum,
        valueAxes,
    };
}
