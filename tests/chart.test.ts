import { describe, expect, test } from "bun:test";
import { renderedPage } from "./renderedPage";
import type PptxGenJS from "pptxgenjs";
import { UnsupportedChartError } from "../packages/pptxgenjs/src/chart/errors";
import { formatChartNumber } from "../packages/pptxgenjs/src/chart/format";
import { normalizeChart } from "../packages/pptxgenjs/src/normalize/chart";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";

const categoricalData: PptxGenJS.OptsChartData[] = [
    { name: "First", labels: ["A", "B", "C"], values: [2, 5, 3] },
    { name: "Second", labels: ["A", "B", "C"], values: [4, 1, 6] },
];

describe("chart normalization and rendering", () => {
    test("normalizes a basic chart without backend-specific options", () => {
        const chart = normalizeChart("bar", categoricalData, {
            chartColors: ["4472C4", "ED7D31"],
            showLegend: true,
            legendPos: "b",
            barGrouping: "stacked",
        });

        expect(chart.type).toBe("bar");
        expect<string[]>(chart.colors).toEqual(["#4472C4", "#ED7D31"]);
        expect(chart.grouping).toBe("stacked");
        expect(chart.legendPosition).toBe("b");
        expect(chart.series.map(series => series.name)).toEqual(["First", "Second"]);
        expect(chart.valueAxisMinimum).toBe(0);
        expect(chart.valueAxisMaximum).toBe(10);
    });

    test("draws the title, axes and data labels in Arial when no font is set, as PptxGenJS writes them", () => {
        // PptxGenJS 4.0.1: `<a:latin typeface="${titleFontFace || 'Arial'}">`, and `|| 'Arial'` for axis and data labels.
        const chart = normalizeChart("bar", categoricalData, { showTitle: true, title: "T", showValAxisTitle: true, valAxisTitle: "V" });
        expect([chart.fontFace, chart.titleFontFace, chart.valueAxes[0]?.titleFontFace, chart.valueAxes[0]?.labelFontFace]).toEqual(["Arial", "Arial", "Arial", "Arial"]);
        expect(normalizeChart("bar", categoricalData, { titleFontFace: "Georgia" }).titleFontFace).toBe("Georgia");
    });

    test("ignores the chart-level fontFace, which PptxGenJS reads for no chart text", () => {
        // PptxGenJS 4.0.1 writes titleFontFace, valAxisTitleFontFace, valAxisLabelFontFace, catAxisLabelFontFace and
        // dataLabelFontFace `|| 'Arial'`, and legendFontFace only when set; `fontFace` reaches none of them.
        const chart = normalizeChart("bar", categoricalData, { fontFace: "Georgia", showTitle: true, title: "T", showValAxisTitle: true, valAxisTitle: "V" });
        expect([chart.fontFace, chart.titleFontFace, chart.valueAxes[0]?.titleFontFace, chart.valueAxes[0]?.labelFontFace, chart.legendFontFace]).toEqual(["Arial", "Arial", "Arial", "Arial", "Calibri"]);
        const axes = normalizeChart("bar", categoricalData, { fontFace: "Georgia", valAxisTitleFontFace: "Courier New", valAxisLabelFontFace: "Verdana" });
        expect([axes.valueAxes[0]?.titleFontFace, axes.valueAxes[0]?.labelFontFace]).toEqual(["Courier New", "Verdana"]);
    });

    test("ignores the chart-level fontSize, which PptxGenJS reads for no chart text", () => {
        // PptxGenJS 4.0.1 writes catAxisLabelFontSize, valAxisLabelFontSize and dataLabelFontSize `|| 12`, titleFontSize
        // `|| 18`, and valAxisTitleFontSize and legendFontSize only when set, leaving Office's 10pt: chart XML with
        // `fontSize: 31` is byte-identical to chart XML without.
        const chart = normalizeChart("bar", categoricalData, { fontSize: 31, showTitle: true, title: "T", showValAxisTitle: true, valAxisTitle: "V" });
        expect([chart.fontSize, chart.titleFontSize, chart.valueAxes[0]?.titleFontSize, chart.valueAxes[0]?.labelFontSize, chart.legendFontSize]).toEqual([12, 18, 10, 12, 10]);
        const axes = normalizeChart("bar", categoricalData, { fontSize: 31, valAxisLabelFontSize: 9, titleFontSize: 20 });
        expect([axes.valueAxes[0]?.labelFontSize, axes.titleFontSize]).toEqual([9, 20]);
    });

    test("legend ignores chart fontFace/fontSize like PptxGenJS and defaults to 10pt body font", () => {
        // PptxGenJS writes legend <c:txPr> only for legendFontFace/legendFontSize/legendColor.
        const inherited = normalizeChart("bar", categoricalData, { showLegend: true, fontFace: "Arial", fontSize: 20 });
        expect(inherited.legendFontFace).toBe("Calibri");
        expect(inherited.legendFontSize).toBe(10);

        const explicit = normalizeChart("bar", categoricalData, { showLegend: true, legendFontFace: "Georgia", legendFontSize: 14 });
        expect(explicit.legendFontFace).toBe("Georgia");
        expect(explicit.legendFontSize).toBe(14);
    });

    test("renders supported charts as inline SVG and remains chainable", () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        const result = slide.addChart("bar", categoricalData, {
            x: 1,
            y: 1,
            w: 5,
            h: 3,
            showLegend: true,
            objectName: "Sales chart",
            altText: "Quarterly sales",
        });

        expect(result).toBe(slide);
        const element = renderedPage(presentation).querySelector<HTMLElement>(".slide-chart");
        const svg = element?.querySelector("svg");
        expect(element?.dataset.objectName).toBe("Sales chart");
        expect(element?.getAttribute("aria-label")).toBe("Quarterly sales");
        expect(element?.style.left).toBe("96px");
        expect(element?.style.width).toBe("480px");
        expect(svg?.getAttribute("width")).toBe("100%");
        expect(svg?.querySelectorAll("path").length).toBeGreaterThan(0);
        expect(svg?.textContent).toContain("First");
    });

    test("renders every initial 2D chart family", () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        slide.addChart("line", categoricalData, { x: 0, y: 0, w: 3, h: 2 });
        slide.addChart("area", categoricalData, { x: 3, y: 0, w: 3, h: 2 });
        slide.addChart("radar", categoricalData, { x: 6, y: 0, w: 3, h: 2 });
        slide.addChart("pie", [categoricalData[0]!], { x: 0, y: 2, w: 3, h: 2 });
        slide.addChart("doughnut", [categoricalData[0]!], { x: 3, y: 2, w: 3, h: 2 });
        const xyData: PptxGenJS.OptsChartData[] = [
            { name: "X", values: [1, 2, 3] },
            { name: "Y", values: [2, 5, 3], sizes: [2, 8, 4] },
        ];
        slide.addChart("scatter", xyData, { x: 6, y: 2, w: 3, h: 2 });
        slide.addChart("bubble", xyData, { x: 0, y: 4, w: 3, h: 1.5 });

        expect(renderedPage(presentation).querySelectorAll(".slide-chart")).toHaveLength(7);
        expect(renderedPage(presentation).querySelectorAll(".slide-chart svg")).toHaveLength(7);
    });

    test("reports unsupported types and options with structured details", () => {
        try {
            normalizeChart("bar", categoricalData, { showValue: true });
            throw new Error("Expected normalization to fail");
        } catch (error) {
            expect(error).toBeInstanceOf(UnsupportedChartError);
            expect((error as UnsupportedChartError).code).toBe("UNSUPPORTED_CHART");
            expect((error as UnsupportedChartError).reason).toBe("chart-option");
            expect((error as UnsupportedChartError).unsupportedOptions).toEqual(["showValue"]);
        }
    });

    test("normalizes PptxGenJS bar3D defaults and bounded view options", () => {
        const chart = normalizeChart("bar3D", categoricalData, {
            bar3DShape: "cylinder",
            barGapDepthPct: 240,
            v3DPerspective: 90,
            v3DRAngAx: true,
            v3DRotX: -20,
            v3DRotY: 390,
        });

        expect(chart.grouping).toBe("standard");
        expect(chart.bar3DShape).toBe("cylinder");
        expect(chart.barGapDepthPercent).toBe(240);
        expect(chart.perspective3D).toBe(90);
        expect(chart.rightAngleAxes3D).toBe(true);
        expect(chart.rotationX3D).toBe(-20);
        expect(chart.rotationY3D).toBe(30);
        expect(normalizeChart("bar3D", categoricalData, { bar3DShape: "invalid" }).bar3DShape).toBe("box");
        expect(normalizeChart("bar3D", categoricalData, { barGrouping: "stacked" }).valueAxisMaximum).toBe(10);
    });

    test("renders all six bar3D shapes as deterministic inline SVG", () => {
        const shapes = ["box", "cylinder", "cone", "coneToMax", "pyramid", "pyramidToMax"] as const;
        for (const shape of shapes) {
            const presentation = new PuppeteerGen();
            presentation.addSlide().addChart("bar3D", categoricalData, {
                x: 0,
                y: 0,
                w: 5,
                h: 3,
                bar3DShape: shape,
                showLegend: true,
            });
            const svg = renderedPage(presentation).querySelector(`svg[data-bar3d-shape="${shape}"]`);
            expect(svg).not.toBeNull();
            expect(svg?.querySelectorAll(".bar3d-mark")).toHaveLength(6);
            expect(svg?.textContent).toContain("First");
        }
    });

    test("projects bar3D through the view3D camera PptxGenJS writes", () => {
        const walls = (options: PptxGenJS.IChartOpts) => {
            const presentation = new PuppeteerGen();
            presentation.addSlide().addChart("bar3D", categoricalData, { x: 0, y: 0, w: 6, h: 3.3, ...options });
            const page = renderedPage(presentation);
            const corners = (element: Element | undefined) => (element?.getAttribute("points") ?? "").split(" ").map(pair => pair.split(",").map(Number) as [number, number]);
            const side = page.querySelectorAll(".slide-chart .bar3d-wall")[1];
            const xs = Array.from(page.querySelectorAll(".slide-chart .bar3d-wall, .slide-chart .bar3d-floor")).flatMap(polygon => corners(polygon).map(([x]) => x));
            // Side wall: front bottom, back bottom, back top, front top.
            const [frontBottom, backBottom, backTop, frontTop] = corners(side);
            return { sideX: Math.min(...corners(side).map(([x]) => x)), frontEdge: (frontBottom?.[1] ?? 0) - (frontTop?.[1] ?? 0), backEdge: (backBottom?.[1] ?? 0) - (backTop?.[1] ?? 0), left: Math.min(...xs), right: Math.max(...xs) };
        };
        // `<c:view3D><c:rotX val="30"/><c:rotY val="30"/><c:rAngAx val="0"/><c:perspective val="30"/></c:view3D>`: a 15° field
        // of view makes the far edge of the side wall shorter; the box is centered with 12.5% of the width on each side.
        const perspective = walls({});
        expect(perspective.backEdge).toBeLessThan(perspective.frontEdge * 0.97);
        expect(perspective.left).toBeCloseTo(576 * 0.125, 0);
        expect(perspective.right).toBeCloseTo(576 * 0.875, 0);
        // Right-angle axes ignore the perspective: parallel edges keep their length.
        const parallel = walls({ v3DRAngAx: true });
        expect(parallel.backEdge).toBeCloseTo(parallel.frontEdge, 1);
        // Turning the scene the other way shows the other side wall.
        const turned = walls({ v3DRotY: 330 });
        expect(turned.sideX).toBeGreaterThan(576 / 2);
        expect(perspective.sideX).toBeLessThan(576 / 2);
    });

    test("sizes the automatic plot-area margins from the text, not the chart height", () => {
        const plotBounds = (hInches: number, options: PptxGenJS.IChartOpts) => {
            const presentation = new PuppeteerGen();
            presentation.addSlide().addChart("bar", categoricalData, { x: 0, y: 0, w: 5, h: hInches, ...options });
            const rows = Array.from(renderedPage(presentation).querySelectorAll(".slide-chart path"), path => path.getAttribute("d")?.match(/^M[\d.]+ ([\d.]+)L[\d.]+ \1$/)?.[1]).filter(y => y !== undefined);
            const ys = rows.map(Number);
            return { top: Math.min(...ys), bottom: hInches * 96 - Math.max(...ys) };
        };
        // Below: 2% gap, 10pt legend line (1.2em) and 2% gap, 5px ticks, 8px label margin, 12pt label line (1.2em).
        // Above: 2% gap and half of the 12pt value label. Within 1px: zrender snaps lines to half pixels.
        for (const h of [3, 4.5]) {
            const gap = h * 96 * 0.02;
            const withLegend = plotBounds(h, { showLegend: true, legendPos: "b" });
            expect(Math.abs(withLegend.bottom - (2 * gap + 16 + 5 + 8 + 19.2))).toBeLessThanOrEqual(1);
            expect(Math.abs(withLegend.top - (gap + 8))).toBeLessThanOrEqual(1);
            expect(Math.abs(plotBounds(h, {}).bottom - (gap + 5 + 8 + 19.2))).toBeLessThanOrEqual(1);
        }
    });

    test("keys bar entries with a square 0.6 of the legend font size and keeps line entries as a line", () => {
        const legendKeys = (type: "bar" | "line", options: PptxGenJS.IChartOpts = {}) => {
            const presentation = new PuppeteerGen();
            presentation.addSlide().addChart(type, categoricalData, { x: 0, y: 0, w: 5, h: 3, showLegend: true, legendPos: "b", ...options });
            return Array.from(renderedPage(presentation).querySelectorAll('.slide-chart path[ecmeta_ssr_type="legend"][ecmeta_silent]'), path => path.getAttribute("d"));
        };
        // 10pt legend: 13.33px * 0.6 = 8px squares; 20pt: 16px.
        expect(legendKeys("bar")).toEqual(["M0 0L8 0L8 8L0 8Z", "M0 0L8 0L8 8L0 8Z"]);
        expect(legendKeys("bar", { legendFontSize: 20 })).toEqual(["M0 0L16 0L16 16L0 16Z", "M0 0L16 0L16 16L0 16Z"]);
        expect(legendKeys("line").some(d => d?.includes("L8 8"))).toBe(false);

        const presentation = new PuppeteerGen();
        presentation.addSlide().addChart("bar3D", categoricalData, { x: 0, y: 0, w: 5, h: 3, showLegend: true });
        const key = renderedPage(presentation).querySelector(".slide-chart rect");
        expect([key?.getAttribute("width"), key?.getAttribute("height")]).toEqual(["8", "8"]);
    });

    test("draws outside major tick marks on the category axis, as PptxGenJS writes them", () => {
        // PptxGenJS 4.0.1: `<c:majorTickMark val="${catAxisMajorTickMark || 'out'}"/>` on every category axis but scatter's.
        expect(normalizeChart("bar", categoricalData).categoryMajorTickMark).toBe("outside");
        const presentation = new PuppeteerGen();
        presentation.addSlide().addChart("bar", categoricalData, { x: 0, y: 0, w: 5, h: 3, valAxisMajorTickMark: "none" });
        const paths = Array.from(renderedPage(presentation).querySelectorAll(".slide-chart path"), path => path.getAttribute("d") ?? "");
        // A vertical 5px stroke at each of the four category boundaries of three categories.
        const ticks = paths.filter(d => {
            const match = d.match(/^M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)$/);
            return match !== null && match[1] === match[3] && Number(match[4]) - Number(match[2]) === 5;
        });
        expect(ticks).toHaveLength(4);
    });

    test("draws the bar3D legend in the legend font, not the axis-label font", () => {
        const legendText = (options: PptxGenJS.IChartOpts) => {
            const presentation = new PuppeteerGen();
            presentation.addSlide().addChart("bar3D", categoricalData, { x: 0, y: 0, w: 5, h: 3, showLegend: true, ...options });
            const text = renderedPage(presentation).querySelector(".bar3d-legend");
            return [text?.getAttribute("font-family"), text?.getAttribute("font-size"), text?.getAttribute("fill")];
        };
        // PptxGenJS writes no legend <c:txPr> by default: Office's 10pt chart text in the body font.
        expect(legendText({})).toEqual(["Calibri", "13.33", "#000000"]);
        expect(legendText({ legendFontFace: "Georgia", legendFontSize: 14, legendColor: "C00000" })).toEqual(["Georgia", "18.67", "#C00000"]);
    });

    test("normalizes and renders primary-axis bar, line, and area combinations", () => {
        const mixed: PptxGenJS.IChartMulti[] = [
            { type: "bar", data: [categoricalData[0]!], options: {} },
            { type: "line", data: [categoricalData[1]!], options: {} },
            { type: "area", data: [{ name: "Third", labels: ["A", "B", "C"], values: [1, 3, 2] }], options: {} },
        ];
        const chart = normalizeChart(mixed, [], { chartColors: ["4472C4", "ED7D31", "70AD47"] });
        expect(chart.type).toBe("mixed");
        expect(chart.series.map(series => series.type)).toEqual(["bar", "line", "area"]);

        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        expect(
            (slide.addChart as Function)(mixed, {
                x: 1,
                y: 1,
                w: 6,
                h: 3,
                showLegend: true,
                chartColors: ["4472C4", "ED7D31", "70AD47"],
            }),
        ).toBe(slide);
        const svg = renderedPage(presentation).querySelector(".slide-chart svg");
        expect(svg?.textContent).toContain("First");
        expect(svg?.textContent).toContain("Second");
        expect(svg?.textContent).toContain("Third");
    });

    test("normalizes and renders a secondary value axis for mixed charts", () => {
        const mixed: PptxGenJS.IChartMulti[] = [
            { type: "bar", data: [categoricalData[0]!], options: {} },
            {
                type: "line",
                data: [{ name: "Revenue", labels: ["A", "B", "C"], values: [100, 400, 250] }],
                options: { secondaryValAxis: true },
            },
        ];
        const options: PptxGenJS.IChartOpts = {
            valAxes: [
                { valAxisMinVal: 0, valAxisMaxVal: 8, showValAxisTitle: true, valAxisTitle: "Units" },
                { valAxisMinVal: 0, valAxisMaxVal: 500, showValAxisTitle: true, valAxisTitle: "Revenue" },
            ],
        };
        const chart = normalizeChart(mixed, [], options);
        expect(chart.series.map(series => series.valueAxisIndex)).toEqual([0, 1]);
        expect(chart.valueAxes).toMatchObject([
            { minimum: 0, maximum: 8, hidden: false, showTitle: true, title: "Units" },
            { minimum: 0, maximum: 500, hidden: false, showTitle: true, title: "Revenue" },
        ]);

        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        (slide.addChart as Function)(mixed, { ...options, x: 1, y: 1, w: 6, h: 3 });
        const svg = renderedPage(presentation).querySelector(".slide-chart svg");
        expect(svg?.textContent).toContain("Units");
        expect(svg?.textContent).toContain("Revenue");
        expect(svg?.textContent).toContain("500");
    });

    test("normalizes advanced value-axis formatting and renders formatted ticks", () => {
        const options: PptxGenJS.IChartOpts = {
            valAxisMinVal: 0,
            valAxisMaxVal: 8,
            valAxisMajorUnit: 2,
            valAxisLabelColor: "C00000",
            valAxisLabelFontBold: true,
            valAxisLabelFontFace: "Arial",
            valAxisLabelFontItalic: true,
            valAxisLabelFontSize: 14,
            valAxisLabelFormatCode: "$0.0",
            valAxisLabelPos: "high",
            valAxisLabelRotate: 15,
            valAxisLineColor: "00AA00",
            valAxisLineShow: true,
            valAxisLineSize: 2,
            valAxisLineStyle: "dash",
            valAxisMajorTickMark: "inside",
            valAxisMinorTickMark: "outside",
            valAxisOrientation: "minMax",
            showValAxisTitle: true,
            valAxisTitle: "Revenue",
            valAxisTitleColor: "0000FF",
            valAxisTitleFontFace: "Georgia",
            valAxisTitleFontSize: 16,
            valAxisTitleRotate: 90,
            valGridLine: { color: "FF00FF", size: 1.5, style: "dot", cap: "round" },
        };
        const axis = normalizeChart("bar", categoricalData, options).valueAxes[0]!;
        expect(axis).toMatchObject({
            minimum: 0,
            maximum: 8,
            majorUnit: 2,
            labelColor: "#C00000",
            labelBold: true,
            labelItalic: true,
            labelFontFace: "Arial",
            labelFontSize: 14,
            labelFormatCode: "$0.0",
            labelPosition: "high",
            labelRotate: 15,
            lineColor: "#00AA00",
            lineWidth: 2,
            lineStyle: "dash",
            lineVisible: true,
            majorTickMark: "inside",
            minorTickMark: "outside",
            title: "Revenue",
            titleColor: "#0000FF",
            titleFontFace: "Georgia",
            titleFontSize: 16,
            titleRotate: 90,
            gridLineColor: "#FF00FF",
            gridLineWidth: 1.5,
            gridLineStyle: "dot",
            gridLineCap: "round",
        });

        const presentation = new PuppeteerGen();
        presentation.addSlide().addChart("bar", categoricalData, { ...options, x: 1, y: 1, w: 6, h: 3 });
        const svg = renderedPage(presentation).querySelector(".slide-chart svg");
        expect(svg?.textContent).toContain("Revenue");
        expect(svg?.textContent).toContain("$8.0");
        expect(formatChartNumber(1234.5, "$#,##0.00")).toBe("$1,234.50");
        expect(formatChartNumber(0.25, "0%")).toBe("25%");
    });

    test("validates logarithmic axes and explicitly rejects unsupported format and cross ticks", () => {
        const logarithmic = normalizeChart("line", [{ name: "Growth", labels: ["A", "B"], values: [1, 100] }], {
            valAxisMinVal: 1,
            valAxisMaxVal: 100,
            valAxisLogScaleBase: 10,
        });
        expect(logarithmic.valueAxes[0]?.logScaleBase).toBe(10);
        expect(() => normalizeChart("line", categoricalData, { valAxisLogScaleBase: 10 })).toThrow("positive minimum");
        expect(() => normalizeChart("line", categoricalData, { valAxisLogScaleBase: 1 })).toThrow("between 2 and 99");
        expect(() => normalizeChart("line", categoricalData, { valAxisLabelFormatCode: "0;[Red]-0" })).toThrow(UnsupportedChartError);
        expect(() => normalizeChart("line", categoricalData, { valAxisMajorTickMark: "cross" })).toThrow(UnsupportedChartError);
    });

    test("rejects incompatible mixed families and unimplemented per-series axes", () => {
        expect(() =>
            normalizeChart(
                [
                    { type: "bar", data: [categoricalData[0]!], options: {} },
                    { type: "pie", data: [categoricalData[1]!], options: {} },
                ],
                [],
            ),
        ).toThrow(UnsupportedChartError);
        try {
            normalizeChart(
                [
                    { type: "bar", data: [categoricalData[0]!], options: {} },
                    { type: "line", data: [categoricalData[1]!], options: { secondaryCatAxis: true } },
                ],
                [],
            );
            throw new Error("Expected normalization to fail");
        } catch (error) {
            expect(error).toBeInstanceOf(UnsupportedChartError);
            expect((error as UnsupportedChartError).reason).toBe("chart-option");
            expect((error as UnsupportedChartError).unsupportedOptions).toEqual(["series[1].options.secondaryCatAxis"]);
        }
        expect(() =>
            normalizeChart(
                [
                    { type: "bar", data: [categoricalData[0]!], options: {} },
                    { type: "line", data: [categoricalData[1]!], options: { secondaryValAxis: true } },
                ],
                [],
            ),
        ).toThrow("valAxes[primary,secondary]");
    });

    test("supports native ECharts and trusted SVG extension inputs", () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        expect(
            slide.addChartEx(
                {
                    renderer: "echarts",
                    option: { xAxis: { data: ["A"] }, yAxis: {}, series: [{ type: "bar", data: [4] }] },
                },
                { x: 0, y: 0, w: 3, h: 2, objectName: "Native" },
            ),
        ).toBe(slide);
        slide.addChartEx(
            {
                renderer: "svg",
                svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect id="face" width="10" height="10"/></svg>',
            },
            { x: 3, y: 0, w: 1, h: 1, objectName: "Raw SVG" },
        );

        expect(renderedPage(presentation).querySelectorAll(".slide-chart svg")).toHaveLength(2);
        expect(renderedPage(presentation).querySelector("#slide-1-object-1-face")).not.toBeNull();
    });

    test("rejects external resources in extension SVG", () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        expect(() =>
            slide.addChartEx(
                {
                    renderer: "svg",
                    svg: '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/a.png"/></svg>',
                },
                { x: 0, y: 0, w: 1, h: 1 },
            ),
        ).toThrow("must not reference external resources");
    });
});
