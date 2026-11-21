import type PptxGenJS from "pptxgenjs";
import { UnsupportedChartError } from "#src/chart/errors";
import { isSupportedChartNumberFormat } from "#src/chart/format";
import { PPTX_DEFAULTS } from "#src/defaults";
import type { NormalizedChart, NormalizedChartSeries, NormalizedChartType } from "@pdflapas/model";
import { checkedSize } from "./size";
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
    if (data.length === 0) {
        throw new TypeError("Chart data must contain at least one series");
    }

    const normalized: NormalizedChartSeries[] = [];

    for (const [index, series] of data.entries()) {
        const rawLabels = series.labels ?? [];

        if (rawLabels.some(Array.isArray)) {
            throw new UnsupportedChartError({
                reason: "chart-option",
                chartTypes: [type],
                unsupportedOptions: ["data.labels[multi-level]"],
            });
        }

        const labels = (rawLabels as string[]).map(label => String(label));
        const values: number[] = [];

        for (const [valueIndex, value] of (series.values ?? []).entries()) {
            if (typeof value !== "number" || !Number.isFinite(value)) {
                throw new TypeError(`Chart series ${index} value ${valueIndex} must be a finite number`);
            }

            values.push(value);
        }

        let sizes: number[] | undefined;

        if (series.sizes) {
            sizes = [];

            for (const [valueIndex, value] of series.sizes.entries()) {
                if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
                    throw new TypeError(`Chart series ${index} bubble size ${valueIndex} must be a non-negative finite number`);
                }

                sizes.push(value);
            }
        }

        normalized.push({
            type,
            name: series.name ?? `Series ${index + 1}`,
            labels,
            values,
            sizes,
            colorIndex: index,
            varyColors: false,
            valueAxisIndex: 0,
        });
    }

    return normalized;
}

function automaticValueBounds(type: NormalizedChartType, series: readonly NormalizedChartSeries[], grouping: NormalizedChart["grouping"]): [number, number] {
    let values = type === "scatter" || type === "bubble" ? series.slice(1).flatMap(item => item.values) : series.flatMap(item => item.values);

    if (grouping === "stacked" || grouping === "percentStacked") {
        const categoryCount = Math.max(0, ...series.map(item => item.values.length));
        const stacked: number[] = [];

        for (let index = 0; index < categoryCount; index++) {
            const categoryValues = series.map(item => item.values[index] ?? 0);
            let positive = 0;
            let negative = 0;

            for (const value of categoryValues) {
                if (value >= 0) {
                    positive += value;
                }

                if (value < 0) {
                    negative += value;
                }
            }

            if (grouping !== "percentStacked") {
                stacked.push(positive, negative);
                continue;
            }

            let total = 0;

            for (const value of categoryValues) {
                total += Math.abs(value);
            }

            if (total === 0) {
                stacked.push(0, 0);
            } else {
                stacked.push((positive / total) * 100, (negative / total) * 100);
            }
        }

        values = stacked;
    }

    const minimum = Math.min(0, ...values);
    const maximum = Math.max(0, ...values);

    if (minimum === maximum) {
        return minimum === 0 ? [0, 1] : [minimum, maximum];
    }

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

    if (!Number.isFinite(normalized) || normalized <= 0) {
        throw new TypeError(`${name} must be a positive finite number`);
    }

    return normalized;
}

function finiteNumber(value: number | undefined, name: string, fallback: number): number {
    const normalized = value ?? fallback;

    if (!Number.isFinite(normalized)) {
        throw new TypeError(`${name} must be a finite number`);
    }

    return normalized;
}

function normalizeValueAxis(axisOptions: PptxGenJS.IChartPropsAxisVal | undefined, automatic: [number, number], path: string, chartTypes: PptxGenJS.CHART_NAME[]): NormalizedChart["valueAxes"][number] {
    const defaults = PPTX_DEFAULTS.chart.valueAxis;
    // Check the axis's bounds, scale, unit, tick marks and label format.
    const minimum = axisOptions?.valAxisMinVal ?? automatic[0];
    const maximum = axisOptions?.valAxisMaxVal ?? automatic[1];

    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum >= maximum) {
        throw new TypeError("Chart value-axis minimum must be less than its maximum");
    }

    const logScaleBase = axisOptions?.valAxisLogScaleBase;

    if (logScaleBase !== undefined && (!Number.isFinite(logScaleBase) || logScaleBase < 2 || logScaleBase > 99)) {
        throw new RangeError("valAxisLogScaleBase must be between 2 and 99");
    }

    if (logScaleBase !== undefined && minimum <= 0) {
        throw new TypeError("A logarithmic value axis requires a positive minimum");
    }

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

    const gridLine = axisOptions?.valGridLine;

    return {
        minimum,
        maximum,
        majorUnit,
        logScaleBase,
        labelFormatCode,
        hidden: axisOptions?.valAxisHidden ?? defaults.hidden,
        showTitle: axisOptions?.showValAxisTitle ?? false,
        title: axisOptions?.valAxisTitle ?? defaults.title,
        titleColor: normalizeColor(axisOptions?.valAxisTitleColor ?? defaults.titleColor),
        titleFontFace: axisOptions?.valAxisTitleFontFace ?? PPTX_DEFAULTS.chart.fontFace,
        titleFontSize: positiveNumber(axisOptions?.valAxisTitleFontSize, "valAxisTitleFontSize", defaults.titleFontSizePt),
        titleRotate: axisOptions?.valAxisTitleRotate === undefined ? defaults.titleRotate : finiteNumber(axisOptions.valAxisTitleRotate, "valAxisTitleRotate", 0),
        labelColor: normalizeColor(axisOptions?.valAxisLabelColor ?? defaults.labelColor),
        labelFontFace: axisOptions?.valAxisLabelFontFace ?? PPTX_DEFAULTS.chart.fontFace,
        labelFontSize: positiveNumber(axisOptions?.valAxisLabelFontSize, "valAxisLabelFontSize", defaults.labelFontSizePt),
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

export function normalizeChart(type: ChartInputType, data: readonly PptxGenJS.OptsChartData[], options: PptxGenJS.IChartOpts = {}): NormalizedChart {
    const mixed = Array.isArray(type);
    const chartTypes = mixed ? type.map(chart => chart.type) : [type];

    // Refuse a chart type, a combination or an option the renderers do not draw.
    if (mixed && (type.length === 0 || type.some(chart => !MIXED_CHART_TYPES.has(chart.type)))) {
        throw new UnsupportedChartError({ reason: "chart-combination", chartTypes });
    }

    if (!mixed && !SUPPORTED_TYPES.has(type as NormalizedChartType)) {
        throw new UnsupportedChartError({ reason: "chart-type", chartTypes: [String(type)] });
    }

    if (mixed) {
        const unsupported: string[] = [];

        for (const [index, chart] of type.entries()) {
            for (const key of Object.keys(chart.options ?? {})) {
                if (chart.options[key as keyof PptxGenJS.IChartOpts] !== undefined && !SUPPORTED_MIXED_SERIES_OPTIONS.has(key)) {
                    unsupported.push(`series[${index}].options.${key}`);
                }
            }
        }

        if (unsupported.length) {
            throw new UnsupportedChartError({ reason: "chart-option", chartTypes, unsupportedOptions: unsupported.sort() });
        }
    }

    const requestedValueAxes = options.valAxes ?? [];
    const unsupportedAxisOptions: string[] = [];

    for (const [index, axis] of requestedValueAxes.entries()) {
        for (const key of Object.keys(axis)) {
            if (axis[key as keyof PptxGenJS.IChartPropsAxisVal] !== undefined && !SUPPORTED_VALUE_AXIS_OPTIONS.has(key)) {
                unsupportedAxisOptions.push(`valAxes[${index}].${key}`);
            }
        }
    }

    for (const [index, axis] of requestedValueAxes.entries()) {
        for (const key of Object.keys(axis.valGridLine ?? {})) {
            if (!SUPPORTED_GRID_LINE_OPTIONS.has(key)) {
                unsupportedAxisOptions.push(`valAxes[${index}].valGridLine.${key}`);
            }
        }
    }

    for (const key of Object.keys(options.valGridLine ?? {})) {
        if (!SUPPORTED_GRID_LINE_OPTIONS.has(key)) {
            unsupportedAxisOptions.push(`valGridLine.${key}`);
        }
    }

    if (unsupportedAxisOptions.length) {
        throw new UnsupportedChartError({ reason: "chart-option", chartTypes, unsupportedOptions: unsupportedAxisOptions.sort() });
    }

    const unsupportedOptions: string[] = [];

    for (const key of Object.keys(options)) {
        if (options[key as keyof PptxGenJS.IChartOpts] !== undefined && !SUPPORTED_CHART_OPTION_SET.has(key)) {
            unsupportedOptions.push(key);
        }
    }

    unsupportedOptions.sort();

    if (unsupportedOptions.length) {
        throw new UnsupportedChartError({
            reason: "chart-option",
            chartTypes: [mixed ? "mixed" : type],
            unsupportedOptions,
        });
    }

    const valueAxisOptions = options.valAxes ?? [];
    const normalizedType: NormalizedChartType = mixed ? "mixed" : (type as NormalizedChartType);
    const palette = options.chartColors?.length ? options.chartColors : normalizedType === "pie" || normalizedType === "doughnut" ? PPTX_DEFAULTS.chart.colors.pie : PPTX_DEFAULTS.chart.colors.bar;
    let series: NormalizedChartSeries[];

    if (!Array.isArray(type)) {
        series = normalizeSeries(normalizedType, data);
    } else {
        series = [];

        for (const chart of type) {
            for (const item of normalizeSeries(chart.type as NormalizedChartType, chart.data)) {
                series.push({
                    ...item,
                    // PptxGenJS restarts colors within each mixed chart-type group.
                    varyColors: chart.type === "bar" && chart.data.length === 1,
                    valueAxisIndex: chart.options?.secondaryValAxis ? (1 as const) : (0 as const),
                });
            }
        }
    }

    // Refuse series the chart type cannot draw.
    if ((normalizedType === "pie" || normalizedType === "doughnut") && series.length !== 1) {
        throw new UnsupportedChartError({ reason: "chart-option", chartTypes, unsupportedOptions: ["data[multiple-series]"] });
    }

    if ((normalizedType === "scatter" || normalizedType === "bubble") && series.length < 2) {
        throw new TypeError(`${normalizedType} charts require an X-value series followed by at least one Y-value series`);
    }

    if (normalizedType === "bubble" && series.slice(1).some(item => !item.sizes)) {
        throw new TypeError("Bubble Y-value series must include sizes");
    }

    if (!["scatter", "bubble", "pie", "doughnut"].includes(normalizedType)) {
        const labels = JSON.stringify(series[0]?.labels ?? []);

        if (series.some(item => JSON.stringify(item.labels) !== labels)) {
            throw new UnsupportedChartError({ reason: "chart-option", chartTypes, unsupportedOptions: ["data.labels[per-series]"] });
        }
    }

    const grouping = options.barGrouping;
    const normalizedGrouping: NormalizedChart["grouping"] = grouping === "stacked" || grouping === "percentStacked" || grouping === "standard" || grouping === "clustered" ? grouping : normalizedType === "bar3D" ? PPTX_DEFAULTS.chart.grouping.bar3D : PPTX_DEFAULTS.chart.grouping.bar;
    const hasSecondaryValueAxis = series.some(item => item.valueAxisIndex === 1);

    if (hasSecondaryValueAxis && valueAxisOptions.length !== 2) {
        throw new UnsupportedChartError({ reason: "chart-option", chartTypes, unsupportedOptions: ["valAxes[primary,secondary]"] });
    }

    if (!hasSecondaryValueAxis && valueAxisOptions.length > 1) {
        throw new UnsupportedChartError({ reason: "chart-combination", chartTypes, unsupportedOptions: ["valAxes[secondary-without-series]"] });
    }

    const axisSeries = (axisIndex: 0 | 1) => series.filter(item => item.valueAxisIndex === axisIndex);
    const automaticPrimary = automaticValueBounds(normalizedType, axisSeries(0), normalizedGrouping);
    const automaticSecondary = hasSecondaryValueAxis ? automaticValueBounds(normalizedType, axisSeries(1), normalizedGrouping) : undefined;
    const primaryAxis = normalizeValueAxis(valueAxisOptions[0] ?? options, automaticPrimary, valueAxisOptions[0] ? "valAxes[0]." : "", chartTypes);
    const valueAxes = [primaryAxis];

    if (automaticSecondary) {
        valueAxes.push(normalizeValueAxis(valueAxisOptions[1], automaticSecondary, "valAxes[1].", chartTypes));
    }

    return {
        type: normalizedType,
        series,
        colors: palette.map(color => normalizeColor(color)),
        colorOpacity: Math.max(0, Math.min(1, (options.chartColorsOpacity ?? 100) / 100)),
        // Text options.
        showLegend: options.showLegend ?? PPTX_DEFAULTS.chart.showLegend,
        legendPosition: options.legendPos ?? PPTX_DEFAULTS.chart.legendPosition,
        showTitle: options.showTitle ?? PPTX_DEFAULTS.chart.showTitle,
        title: options.title ?? "Chart Title",
        // PptxGenJS 4.0.1 reads no chart-level `fontFace` or `fontSize`: every chart text has its own option,
        // `|| 'Arial'` and `|| 12` (the category-axis labels: `catAxisLabelFontSize || 12`).
        fontFace: PPTX_DEFAULTS.chart.fontFace,
        fontSize: PPTX_DEFAULTS.chart.fontSizePt,
        titleFontFace: options.titleFontFace ?? PPTX_DEFAULTS.chart.fontFace,
        titleFontSize: checkedSize(options.titleFontSize ?? PPTX_DEFAULTS.chart.titleFontSizePt, "titleFontSize", PPTX_DEFAULTS.limits.fontSizePt),
        titleBold: options.titleBold ?? false,
        titleColor: normalizeColor(options.titleColor ?? PPTX_DEFAULTS.text.color),
        // PptxGenJS never applies fontFace/fontSize to the legend.
        legendFontFace: options.legendFontFace ?? PPTX_DEFAULTS.theme.bodyFontFace,
        legendFontSize: checkedSize(options.legendFontSize ?? PPTX_DEFAULTS.chart.legendFontSizePt, "legendFontSize", PPTX_DEFAULTS.limits.fontSizePt),
        legendColor: normalizeColor(options.legendColor ?? PPTX_DEFAULTS.text.color),
        // Bar options.
        barDirection: options.barDir === "bar" ? ("bar" as const) : PPTX_DEFAULTS.chart.barDirection,
        barGapWidthPercent: Math.max(0, Math.min(1000, options.barGapWidthPct ?? PPTX_DEFAULTS.chart.barGapWidthPct)),
        barGapDepthPercent: Math.max(0, Math.min(1000, options.barGapDepthPct ?? PPTX_DEFAULTS.chart.barGapDepthPct)),
        bar3DShape: BAR_3D_SHAPES.has(options.bar3DShape ?? "") ? (options.bar3DShape as NormalizedChart["bar3DShape"]) : PPTX_DEFAULTS.chart.bar3DShape,
        perspective3D: Math.max(0, Math.min(240, options.v3DPerspective ?? PPTX_DEFAULTS.chart.v3DPerspective)),
        rightAngleAxes3D: options.v3DRAngAx ?? PPTX_DEFAULTS.chart.v3DRightAngleAxes,
        rotationX3D: Math.max(-90, Math.min(90, options.v3DRotX ?? PPTX_DEFAULTS.chart.v3DRotationX)),
        rotationY3D: (((options.v3DRotY ?? PPTX_DEFAULTS.chart.v3DRotationY) % 360) + 360) % 360,
        // Doughnut, pie, radar and line options.
        doughnutHoleSize: Math.max(0, Math.min(90, options.holeSize ?? PPTX_DEFAULTS.chart.doughnutHoleSizePct)),
        firstSliceAngle: (((options.firstSliceAng ?? PPTX_DEFAULTS.chart.firstSliceAngle) % 360) + 360) % 360,
        radarStyle: options.radarStyle ?? PPTX_DEFAULTS.chart.radarStyle,
        lineSmooth: options.lineSmooth ?? PPTX_DEFAULTS.chart.lineSmooth,
        lineSymbol: options.lineDataSymbol ?? PPTX_DEFAULTS.chart.lineDataSymbol,
        lineSymbolSize: checkedSize(options.lineDataSymbolSize ?? PPTX_DEFAULTS.chart.lineDataSymbolSize, "lineDataSymbolSize", PPTX_DEFAULTS.limits.chartMarkerSizePt),
        lineSize: checkedSize(options.lineSize ?? PPTX_DEFAULTS.chart.lineSizePt, "lineSize", PPTX_DEFAULTS.limits.lineWidthPt),
        altText: options.altText ?? "",
        grouping: normalizedGrouping,
        gridLineColor: normalizeColor(PPTX_DEFAULTS.chart.gridLine.color),
        gridLineWidth: PPTX_DEFAULTS.chart.gridLine.widthPt,
        axisLineVisible: PPTX_DEFAULTS.chart.categoryAxisLineVisible,
        categoryMajorTickMark: PPTX_DEFAULTS.chart.categoryMajorTickMark,
        valueAxisMinimum: primaryAxis.minimum,
        valueAxisMaximum: primaryAxis.maximum,
        valueAxes,
    };
}
