import { describe, expect, test } from "bun:test";
import type PptxGenJS from "pptxgenjs";
import { UnsupportedChartError } from "../src/chart/errors";
import { formatChartNumber } from "../src/chart/format";
import { normalizeChart } from "../src/normalize/chart";
import { PuppeteerGen } from "../src/PuppeterrGen";

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
        expect(chart.colors).toEqual(["#4472C4", "#ED7D31"]);
        expect(chart.grouping).toBe("stacked");
        expect(chart.legendPosition).toBe("b");
        expect(chart.series.map(series => series.name)).toEqual(["First", "Second"]);
        expect(chart.valueAxisMinimum).toBe(0);
        expect(chart.valueAxisMaximum).toBe(10);
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
        const element = presentation.page.querySelector<HTMLElement>(".slide-chart");
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

        expect(presentation.page.querySelectorAll(".slide-chart")).toHaveLength(7);
        expect(presentation.page.querySelectorAll(".slide-chart svg")).toHaveLength(7);
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
            const svg = presentation.page.querySelector(`svg[data-bar3d-shape="${shape}"]`);
            expect(svg).not.toBeNull();
            expect(svg?.querySelectorAll(".bar3d-mark")).toHaveLength(6);
            expect(svg?.textContent).toContain("First");
        }
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
        const svg = presentation.page.querySelector(".slide-chart svg");
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
        const svg = presentation.page.querySelector(".slide-chart svg");
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
        const svg = presentation.page.querySelector(".slide-chart svg");
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

        expect(presentation.page.querySelectorAll(".slide-chart svg")).toHaveLength(2);
        expect(presentation.page.querySelector("#Raw-SVG-face")).not.toBeNull();
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
