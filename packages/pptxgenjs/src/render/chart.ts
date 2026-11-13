import { BarChart, LineChart, PieChart, RadarChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, RadarComponent, TitleComponent } from "echarts/components";
import { type EChartsCoreOption, init, use } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { formatChartNumber } from "../chart/format";
import type { ChartExtensionInput } from "../chart/types";
import type { NormalizedChart, NormalizedObjectStyle } from "@pdfdeck/model";
import { pointsToPixels } from "../units";
import { renderBar3DSvg } from "./chart3d";
import { type InlineStyle, styleAttribute } from "./css";
import { attributeName, descendants, firstElementChild, getAttribute, parseMarkup, SVG_NAMESPACE, serializeOuter, setAttribute } from "./fragment";
import { element } from "./markup";
import { applyObjectStyle } from "./style";

use([BarChart, LineChart, PieChart, RadarChart, ScatterChart, GridComponent, LegendComponent, RadarComponent, TitleComponent, SVGRenderer]);

function legendPlacement(position: NormalizedChart["legendPosition"]): Record<string, unknown> {
    switch (position) {
        case "b":
            return { left: "center", bottom: 0, orient: "horizontal" };
        case "l":
            return { left: 0, top: "middle", orient: "vertical" };
        case "t":
            return { left: "center", top: 0, orient: "horizontal" };
        case "tr":
            return { right: 0, top: 0, orient: "vertical" };
        case "r":
            return { right: 0, top: "middle", orient: "vertical" };
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
        return total === 0 ? 0 : (value / total) * 100;
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
            lineStyle: lineLike ? { width: pointsToPixels(chart.lineSize), color } : undefined,
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
        data: series.values.map((value, index) => (chart.type === "bubble" ? [xValues[index], value, series.sizes?.[index] ?? 0] : [xValues[index], value])),
        symbolSize: chart.type === "bubble" ? (value: unknown[]) => 8 + Math.sqrt(Number(value[2] ?? 0) / maxBubble) * 32 : chart.lineSymbolSize,
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

function chartTitle(chart: NormalizedChart): Record<string, unknown> {
    if (!chart.showTitle) return { show: false };
    return {
        show: true,
        text: chart.title,
        left: "center",
        textStyle: {
            color: chart.titleColor,
            fontFamily: chart.titleFontFace,
            fontSize: pointsToPixels(chart.titleFontSize),
            fontWeight: chart.titleBold ? "bold" : "normal",
        },
    };
}

function chartGrid(chart: NormalizedChart) {
    const bottom = chart.showLegend && chart.legendPosition === "b" ? (chart.valueAxes.length > 1 ? "21%" : "17%") : "10%";
    return {
        left: valueAxisGutter(chart),
        right: chart.valueAxes.length > 1 ? "14%" : "2%",
        top: chart.showTitle ? "14%" : "4%",
        bottom,
        outerBoundsMode: "none",
    } as const;
}

function chartOption(chart: NormalizedChart): EChartsCoreOption {
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
        title: chartTitle(chart),
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
    const grid = chartGrid(chart);

    if (chart.type === "pie" || chart.type === "doughnut") {
        const [series] = chart.series;
        if (!series) throw new TypeError(`A ${chart.type} chart model needs one data series; got none`);
        return {
            ...common,
            series: [
                {
                    name: series.name,
                    type: "pie",
                    radius: chart.type === "doughnut" ? [`${chart.doughnutHoleSize}%`, "70%"] : "70%",
                    startAngle: 90 - chart.firstSliceAngle,
                    itemStyle: { opacity: chart.colorOpacity },
                    data: series.values.map((value, index) => ({
                        value,
                        name: series.labels[index] ?? String(index + 1),
                    })),
                },
            ],
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
            series: [
                {
                    type: "radar",
                    symbol: chart.radarStyle === "standard" ? "none" : lineSymbol(chart.lineSymbol),
                    symbolSize: chart.lineSymbolSize,
                    areaStyle: chart.radarStyle === "filled" ? {} : undefined,
                    data: chart.series.map(series => ({ name: series.name, value: series.values })),
                },
            ],
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
        type: axis.logScaleBase === undefined ? ("value" as const) : ("log" as const),
        logBase: axis.logScaleBase,
        min: chart.grouping === "percentStacked" ? 0 : axis.minimum,
        max: chart.grouping === "percentStacked" ? 100 : axis.maximum,
        interval: axis.logScaleBase === undefined ? axis.majorUnit : undefined,
        position: index === 1 ? ("right" as const) : ("left" as const),
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
        splitNumber: Math.min(10, Math.max(1, Number.isInteger(axis.maximum - axis.minimum) ? axis.maximum - axis.minimum : 5)),
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
        splitLine:
            index === 0
                ? {
                      show: axis.gridLineStyle !== "none",
                      lineStyle: {
                          color: axis.gridLineColor,
                          width: pointsToPixels(axis.gridLineWidth),
                          type: axis.gridLineStyle === "none" ? "solid" : lineType(axis.gridLineStyle),
                          cap: lineCap(axis.gridLineCap),
                      },
                  }
                : { show: false },
    }));
    const [valueAxis] = valueAxes;
    if (!valueAxis) throw new TypeError(`A ${chart.type} chart model needs at least one value axis; got none`);
    return {
        ...common,
        grid,
        xAxis: chart.type === "bar" && chart.barDirection === "bar" ? valueAxis : categoryAxis,
        yAxis: chart.type === "bar" && chart.barDirection === "bar" ? categoryAxis : valueAxes.length === 1 ? valueAxis : valueAxes,
        series: cartesianSeries(chart),
    };
}

/** zrender's SVGPainter.renderToString; zrender is an echarts dependency, not ours, so it is typed here. */
interface SvgPainter {
    renderToString(options: { cssAnimation: boolean; cssEmphasis: boolean }): string;
}

/** zrender prefixes SVG ids with its instance number (zr<N>-), taken from a process-wide counter. */
const ZRENDER_ID_PREFIX = /^zr\d+-/;

export function renderEChartsSvg(width: number, height: number, option: EChartsCoreOption): string {
    // zrender checks the process-global `document` when measuring text. The
    // visual oracle installs jsdom globally for PptxGenJS, but jsdom exposes a
    // canvas whose getContext is intentionally unimplemented. Hide only that
    // configurable jsdom global during synchronous SSR so zrender uses its
    // deterministic server-side width table instead of probing canvas.
    const globalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const isJsdom = globalDocument?.configurable && String((globalThis as { document?: Document }).document?.defaultView?.navigator.userAgent).includes("jsdom");
    if (isJsdom) Reflect.deleteProperty(globalThis, "document");
    let instance: ReturnType<typeof init> | undefined;
    try {
        instance = init(null, null, { renderer: "svg", ssr: true, width, height });
        instance.setOption({ ...option, animation: false });
        // Not renderToSVGString(): it cannot turn off the emphasis :hover CSS, whose class names
        // (zr<N>-cls-<M>) come from process-wide counters and made toHtml() differ between runs (#66).
        // A printed chart has no hover. `as`: ssr with renderer "svg" always creates zrender's SVGPainter.
        const painter = instance.getZr().painter as unknown as SvgPainter;
        return painter.renderToString({ cssAnimation: false, cssEmphasis: false });
    } finally {
        instance?.dispose();
        if (isJsdom && globalDocument) Object.defineProperty(globalThis, "document", globalDocument);
    }
}

const RESOURCE_ATTRIBUTE = /^(?:href|src|xlink:href)$/i;
const EXTERNAL_URL = /^(?:https?:|file:|\/\/)/i;
const EXTERNAL_CSS_URL = /url\(\s*["']?(?:https?:|file:|\/\/)/i;

/**
 * The chart's SVG root as markup: parsed as `template.innerHTML` parses it, checked for external references,
 * its ids prefixed with `idScope` and its size set to the object box. Only the root's descendants are
 * checked and renamed (it was `svg.querySelectorAll()`), so the bytes match the DOM-built HTML.
 */
function chartSvg(source: string, idScope: string): string {
    const svg = firstElementChild(parseMarkup(source.trim()));
    if (svg?.namespaceURI !== SVG_NAMESPACE || svg.tagName !== "svg") {
        throw new TypeError("Chart renderer did not return an SVG root element");
    }
    const elements = Array.from(descendants(svg));
    for (const element of elements) {
        for (const attribute of element.attrs) {
            if ((RESOURCE_ATTRIBUTE.test(attributeName(attribute)) && EXTERNAL_URL.test(attribute.value)) || EXTERNAL_CSS_URL.test(attribute.value)) {
                throw new TypeError("Chart SVG must not reference external resources");
            }
        }
    }
    const ids = new Map<string, string>();
    for (const element of elements) {
        const oldId = getAttribute(element, "id");
        if (oldId === undefined) continue;
        const newId = `${idScope}-${oldId.replace(ZRENDER_ID_PREFIX, "")}`;
        ids.set(oldId, newId);
        setAttribute(element, "id", newId);
    }
    for (const element of elements) {
        for (const attribute of element.attrs) {
            for (const [oldId, newId] of ids) {
                attribute.value = attribute.value.replaceAll(`url(#${oldId})`, `url(#${newId})`);
                if (attribute.value === `#${oldId}`) attribute.value = `#${newId}`;
            }
        }
    }
    setAttribute(svg, "width", "100%");
    setAttribute(svg, "height", "100%");
    return serializeOuter(svg);
}

/** `idScope` is unique per object in the document (slide and object index), so chart ids stay apart and deterministic. */
function chartContainer(svgSource: string, style: NormalizedObjectStyle, altText: string, idScope: string): string {
    const css: InlineStyle = new Map();
    const objectAttributes = applyObjectStyle(css, style);
    css.set("overflow", "hidden");
    return element("div", [["class", "slide-element slide-chart"], ...objectAttributes, styleAttribute(css), ["role", "img"], ["aria-label", altText || undefined]], chartSvg(svgSource, idScope));
}

/** The chart box; addChart() calls it too, so a zero-sized chart fails there rather than at toHtml(). */
export function chartSize(style: NormalizedObjectStyle): { width: number; height: number } {
    const width = style.geometry.width ?? 0;
    const height = style.geometry.height ?? 0;
    if (width <= 0 || height <= 0) throw new RangeError("Chart width and height must be greater than zero");
    return { width, height };
}

export function renderChart(chart: NormalizedChart, style: NormalizedObjectStyle, idScope: string): string {
    const { width, height } = chartSize(style);
    const source = chart.type === "bar3D" ? renderBar3DSvg(width, height, chart) : renderEChartsSvg(width, height, chartOption(chart));
    return chartContainer(source, style, chart.altText, idScope);
}

/** Resolves caller renderer input to SVG source so the slide model stores only data. */
export function renderChartExtensionSvg(input: ChartExtensionInput, style: NormalizedObjectStyle): string {
    const { width, height } = chartSize(style);
    return input.renderer === "svg" ? input.svg : renderEChartsSvg(width, height, input.option as EChartsCoreOption);
}

export function renderChartExtension(svg: string, style: NormalizedObjectStyle, altText: string, idScope: string): string {
    return chartContainer(svg, style, altText, idScope);
}
