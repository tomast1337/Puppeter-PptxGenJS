import { BarChart, LineChart, PieChart, RadarChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, RadarComponent, TitleComponent } from "echarts/components";
import { init, use, type EChartsCoreOption } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { formatChartNumber } from "../chart/format";
import type { ChartExtensionInput } from "../chart/types";
import type { NormalizedChart, NormalizedObjectStyle } from "../model/types";
import { pointsToPixels } from "../utils";
import { applyObjectStyle } from "./style";
import { renderBar3DSvg } from "./chart3d";

use([
    BarChart,
    LineChart,
    PieChart,
    RadarChart,
    ScatterChart,
    GridComponent,
    LegendComponent,
    RadarComponent,
    TitleComponent,
    SVGRenderer,
]);

function legendPlacement(position: NormalizedChart["legendPosition"]): Record<string, unknown> {
    switch (position) {
        case "b": return { left: "center", bottom: 0, orient: "horizontal" };
        case "l": return { left: 0, top: "middle", orient: "vertical" };
        case "t": return { left: "center", top: 0, orient: "horizontal" };
        case "tr": return { right: 0, top: 0, orient: "vertical" };
        case "r": return { right: 0, top: "middle", orient: "vertical" };
    }
}

function lineSymbol(symbol: NormalizedChart["lineSymbol"]): string {
    if (symbol === "none") return "none";
    if (symbol === "dot" || symbol === "dash") return "circle";
    return symbol;
}

function lineType(style: "solid" | "dash" | "dot"): "solid" | "dashed" | "dotted" {
    if (style === "dash") return "dashed";
    if (style === "dot") return "dotted";
    return "solid";
}

function lineCap(cap: "flat" | "round" | "square"): "butt" | "round" | "square" {
    return cap === "flat" ? "butt" : cap;
}

function tickOption(mark: NormalizedChart["valueAxes"][number]["majorTickMark"], color: string, width: number) {
    return {
        show: mark !== "none",
        inside: mark === "inside",
        length: mark === "cross" ? 10 : 5,
        lineStyle: { color, width: pointsToPixels(width) },
    };
}

function percentValues(chart: NormalizedChart, seriesIndex: number): number[] {
    const values = chart.series[seriesIndex]?.values ?? [];
    return values.map((value, valueIndex) => {
        const total = chart.series.reduce((sum, series) => sum + Math.abs(series.values[valueIndex] ?? 0), 0);
        return total === 0 ? 0 : value / total * 100;
    });
}

function cartesianSeries(chart: NormalizedChart): Record<string, unknown>[] {
    const stacked = chart.grouping === "stacked" || chart.grouping === "percentStacked";
    const visibleSeries = stacked ? 1 : Math.max(1, chart.series.filter(series => series.type === "bar").length);
    const barWidth = `${100 / (visibleSeries + chart.barGapWidthPercent / 100)}%`;
    return chart.series.map((series, index) => {
        const seriesType = series.type === "bar" ? "bar" : "line";
        const lineLike = series.type === "line" || series.type === "area";
        const color = chart.colors[series.colorIndex % chart.colors.length];
        const values = chart.grouping === "percentStacked" ? percentValues(chart, index) : series.values;
        return {
        name: series.name,
        type: seriesType,
        data: series.varyColors
            ? values.map((value, valueIndex) => ({
                value,
                itemStyle: { color: chart.colors[valueIndex % chart.colors.length] },
            }))
            : values,
        stack: stacked ? "pptx-stack" : undefined,
        barWidth: seriesType === "bar" ? barWidth : undefined,
        barGap: seriesType === "bar" ? "0%" : undefined,
        smooth: lineLike ? chart.lineSmooth : undefined,
        symbol: lineLike ? lineSymbol(chart.lineSymbol) : undefined,
        symbolSize: lineLike ? chart.lineSymbolSize : undefined,
        lineStyle: lineLike
            ? { width: pointsToPixels(chart.lineSize), color }
            : undefined,
        areaStyle: series.type === "area" ? {} : undefined,
        itemStyle: { opacity: chart.colorOpacity, color },
        yAxisIndex: series.valueAxisIndex,
        };
    });
}

function scatterSeries(chart: NormalizedChart): Record<string, unknown>[] {
    const xValues = chart.series[0]?.values ?? [];
    const ySeries = chart.series.slice(1);
    const maxBubble = Math.max(1, ...ySeries.flatMap(series => series.sizes ?? []));
    return ySeries.map(series => ({
        name: series.name,
        type: "scatter",
        data: series.values.map((value, index) => chart.type === "bubble"
            ? [xValues[index], value, series.sizes?.[index] ?? 0]
            : [xValues[index], value]),
        symbolSize: chart.type === "bubble"
            ? (value: unknown[]) => 8 + Math.sqrt(Number(value[2] ?? 0) / maxBubble) * 32
            : chart.lineSymbolSize,
        itemStyle: { opacity: chart.colorOpacity },
    }));
}

function valueAxisGutter(chart: NormalizedChart): number | string {
    if (chart.valueAxes.length > 1) return "12%";
    const axis = chart.valueAxes[0];
    if (!axis?.showTitle) return "6%";
    const labels = [axis.minimum, axis.maximum].map(value => formatChartNumber(value, axis.labelFormatCode));
    const labelWidth = Math.max(...labels.map(label => label.length), 1) * pointsToPixels(axis.labelFontSize) * 0.6;
    return Math.ceil(Math.max(80, labelWidth + pointsToPixels(axis.titleFontSize) + 30));
}

function chartOption(chart: NormalizedChart): EChartsCoreOption {
    const title = chart.showTitle ? {
        show: true,
        text: chart.title,
        left: "center",
        textStyle: {
            color: chart.titleColor,
            fontFamily: chart.titleFontFace,
            fontSize: pointsToPixels(chart.titleFontSize),
            fontWeight: chart.titleBold ? "bold" : "normal",
        },
    } : { show: false };
    const legend = {
        show: chart.showLegend,
        ...legendPlacement(chart.legendPosition),
        textStyle: {
            color: chart.legendColor,
            fontFamily: chart.legendFontFace,
            fontSize: pointsToPixels(chart.legendFontSize),
        },
    };
    const common: EChartsCoreOption = {
        animation: false,
        color: chart.colors,
        textStyle: {
            fontFamily: chart.fontFace,
            fontSize: pointsToPixels(chart.fontSize),
        },
        title,
        legend,
    };
    const axisStyle = {
        axisLabel: {
            color: "#000000",
            fontFamily: chart.fontFace,
            fontSize: pointsToPixels(chart.fontSize),
        },
        axisLine: {
            show: chart.axisLineVisible,
            lineStyle: { color: chart.gridLineColor, width: pointsToPixels(chart.gridLineWidth) },
        },
        splitLine: {
            lineStyle: { color: chart.gridLineColor, width: pointsToPixels(chart.gridLineWidth) },
        },
    };
    const grid = {
        left: valueAxisGutter(chart),
        right: chart.valueAxes.length > 1 ? "14%" : "2%",
        top: chart.showTitle ? "14%" : "4%",
        bottom: chart.showLegend && chart.legendPosition === "b"
            ? chart.valueAxes.length > 1 ? "21%" : "17%"
            : "10%",
        outerBoundsMode: "none",
    } as const;

    if (chart.type === "pie" || chart.type === "doughnut") {
        const series = chart.series[0]!;
        return {
            ...common,
            series: [{
                name: series.name,
                type: "pie",
                radius: chart.type === "doughnut" ? [`${chart.doughnutHoleSize}%`, "70%"] : "70%",
                startAngle: 90 - chart.firstSliceAngle,
                itemStyle: { opacity: chart.colorOpacity },
                data: series.values.map((value, index) => ({
                    value,
                    name: series.labels[index] ?? String(index + 1),
                })),
            }],
        };
    }

    if (chart.type === "radar") {
        const categoryCount = Math.max(...chart.series.map(series => Math.max(series.labels.length, series.values.length)));
        const indicators = Array.from({ length: categoryCount }, (_, index) => ({
            name: chart.series[0]?.labels[index] ?? String(index + 1),
            max: Math.max(1, ...chart.series.map(series => Math.abs(series.values[index] ?? 0))) * 1.1,
        }));
        return {
            ...common,
            radar: { indicator: indicators },
            series: [{
                type: "radar",
                symbol: chart.radarStyle === "standard" ? "none" : lineSymbol(chart.lineSymbol),
                symbolSize: chart.lineSymbolSize,
                areaStyle: chart.radarStyle === "filled" ? {} : undefined,
                data: chart.series.map(series => ({ name: series.name, value: series.values })),
            }],
        };
    }

    if (chart.type === "scatter" || chart.type === "bubble") {
        return {
            ...common,
            grid,
            xAxis: { type: "value", ...axisStyle },
            yAxis: { type: "value", ...axisStyle },
            series: scatterSeries(chart),
        };
    }

    const categories = chart.series[0]?.labels ?? [];
    const categoryAxis = { type: "category", data: categories, ...axisStyle } as const;
    const valueAxes = chart.valueAxes.map((axis, index) => ({
        type: axis.logScaleBase === undefined ? "value" as const : "log" as const,
        logBase: axis.logScaleBase,
        min: chart.grouping === "percentStacked" ? 0 : axis.minimum,
        max: chart.grouping === "percentStacked" ? 100 : axis.maximum,
        interval: axis.logScaleBase === undefined ? axis.majorUnit : undefined,
        position: index === 1 ? "right" as const : "left" as const,
        show: !axis.hidden,
        name: axis.showTitle ? axis.title : undefined,
        nameLocation: "middle" as const,
        nameGap: 40,
        nameRotate: axis.titleRotate,
        nameTextStyle: {
            color: axis.titleColor,
            fontFamily: axis.titleFontFace,
            fontSize: pointsToPixels(axis.titleFontSize),
        },
        splitNumber: Math.min(10, Math.max(1, Number.isInteger(axis.maximum - axis.minimum)
            ? axis.maximum - axis.minimum
            : 5)),
        axisLabel: {
            show: axis.labelPosition !== "none",
            inside: axis.labelPosition === "high",
            rotate: axis.labelRotate,
            color: axis.labelColor,
            fontFamily: axis.labelFontFace,
            fontSize: pointsToPixels(axis.labelFontSize),
            fontWeight: axis.labelBold ? "bold" : "normal",
            fontStyle: axis.labelItalic ? "italic" : "normal",
            formatter: (value: number) => formatChartNumber(value, axis.labelFormatCode),
        },
        axisLine: {
            show: axis.lineVisible,
            lineStyle: {
                color: axis.lineColor,
                width: pointsToPixels(axis.lineWidth),
                type: lineType(axis.lineStyle),
            },
        },
        axisTick: tickOption(axis.majorTickMark, axis.lineColor, axis.lineWidth),
        minorTick: {
            ...tickOption(axis.minorTickMark, axis.lineColor, axis.lineWidth),
            splitNumber: 5,
        },
        splitLine: index === 0 ? {
            show: axis.gridLineStyle !== "none",
            lineStyle: {
                color: axis.gridLineColor,
                width: pointsToPixels(axis.gridLineWidth),
                type: axis.gridLineStyle === "none" ? "solid" : lineType(axis.gridLineStyle),
                cap: lineCap(axis.gridLineCap),
            },
        } : { show: false },
    }));
    const valueAxis = valueAxes[0]!;
    return {
        ...common,
        grid,
        xAxis: chart.type === "bar" && chart.barDirection === "bar" ? valueAxis : categoryAxis,
        yAxis: chart.type === "bar" && chart.barDirection === "bar"
            ? categoryAxis
            : valueAxes.length === 1 ? valueAxis : valueAxes,
        series: cartesianSeries(chart),
    };
}

export function renderEChartsSvg(width: number, height: number, option: EChartsCoreOption): string {
    // zrender checks the process-global `document` when measuring text. The
    // visual oracle installs jsdom globally for PptxGenJS, but jsdom exposes a
    // canvas whose getContext is intentionally unimplemented. Hide only that
    // configurable jsdom global during synchronous SSR so zrender uses its
    // deterministic server-side width table instead of probing canvas.
    const globalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const isJsdom = globalDocument?.configurable
        && String((globalThis as { document?: Document }).document?.defaultView?.navigator.userAgent).includes("jsdom");
    if (isJsdom) Reflect.deleteProperty(globalThis, "document");
    let instance: ReturnType<typeof init> | undefined;
    try {
        instance = init(null, null, { renderer: "svg", ssr: true, width, height });
        instance.setOption({ ...option, animation: false });
        return instance.renderToSVGString();
    } finally {
        instance?.dispose();
        if (isJsdom && globalDocument) Object.defineProperty(globalThis, "document", globalDocument);
    }
}

function parseSvg(document: Document, source: string): SVGSVGElement {
    const template = document.createElement("template");
    template.innerHTML = source.trim();
    const svg = template.content.firstElementChild;
    if (!(svg instanceof document.defaultView!.SVGSVGElement) || svg.tagName.toLowerCase() !== "svg") {
        throw new TypeError("Chart renderer did not return an SVG root element");
    }
    for (const element of svg.querySelectorAll("*")) {
        for (const attribute of Array.from(element.attributes)) {
            if (/^(?:href|src|xlink:href)$/i.test(attribute.name) && /^(?:https?:|file:|\/\/)/i.test(attribute.value)) {
                throw new TypeError("Chart SVG must not reference external resources");
            }
            if (/url\(\s*["']?(?:https?:|file:|\/\/)/i.test(attribute.value)) {
                throw new TypeError("Chart SVG must not reference external resources");
            }
        }
    }
    return svg;
}

function namespaceSvgIds(svg: SVGSVGElement, namespace: string): void {
    const ids = new Map<string, string>();
    svg.querySelectorAll<SVGElement>("[id]").forEach(element => {
        const oldId = element.id;
        const newId = `${namespace}-${oldId}`;
        ids.set(oldId, newId);
        element.id = newId;
    });
    svg.querySelectorAll<SVGElement>("*").forEach(element => {
        for (const attribute of Array.from(element.attributes)) {
            let value = attribute.value;
            for (const [oldId, newId] of ids) {
                value = value.replaceAll(`url(#${oldId})`, `url(#${newId})`);
                if (value === `#${oldId}`) value = `#${newId}`;
            }
            if (value !== attribute.value) element.setAttribute(attribute.name, value);
        }
    });
}

function chartContainer(
    document: Document,
    svgSource: string,
    style: NormalizedObjectStyle,
    altText: string,
): HTMLDivElement {
    const container = document.createElement("div");
    container.className = "slide-element slide-chart";
    applyObjectStyle(container, style);
    container.style.overflow = "hidden";
    container.setAttribute("role", "img");
    if (altText) container.setAttribute("aria-label", altText);
    const svg = parseSvg(document, svgSource);
    namespaceSvgIds(svg, style.objectName.replace(/[^a-zA-Z0-9_-]/g, "-") || "chart");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    container.appendChild(svg);
    return container;
}

export function renderChart(
    document: Document,
    chart: NormalizedChart,
    style: NormalizedObjectStyle,
): HTMLDivElement {
    const width = style.geometry.width ?? 0;
    const height = style.geometry.height ?? 0;
    if (width <= 0 || height <= 0) throw new RangeError("Chart width and height must be greater than zero");
    const source = chart.type === "bar3D"
        ? renderBar3DSvg(width, height, chart)
        : renderEChartsSvg(width, height, chartOption(chart));
    return chartContainer(document, source, style, chart.altText);
}

export function renderChartExtension(
    document: Document,
    input: ChartExtensionInput,
    style: NormalizedObjectStyle,
    altText: string,
): HTMLDivElement {
    const width = style.geometry.width ?? 0;
    const height = style.geometry.height ?? 0;
    if (width <= 0 || height <= 0) throw new RangeError("Chart width and height must be greater than zero");
    const source = input.renderer === "svg"
        ? input.svg
        : renderEChartsSvg(width, height, input.option as EChartsCoreOption);
    return chartContainer(document, source, style, altText);
}
