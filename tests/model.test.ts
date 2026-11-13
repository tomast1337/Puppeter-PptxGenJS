import { describe, expect, test } from "bun:test";
import type { NormalizedPresentation } from "../packages/model/src/types";
import { createNodeDocument, PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { modelToHtml } from "../packages/pptxgenjs/src/render/document";
import { type ComponentLookup, renderPresentationDocument } from "../packages/pptxgenjs/src/render/slide";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// Every path and URL in the deck resolves to the same PNG, so no test reads files or the network.
const resolveImage = async () => PNG;

function representativeDeck(): PuppeteerGen {
    const pres = new PuppeteerGen(undefined, { resolveImage });
    pres.registerComponent("example/metric", 1, { render: props => `<strong>${String(props.label)}</strong><img src="logo.png">` });

    const text = pres.addSlide();
    text.background = { color: "F1F1F1" };
    text.color = "333333";
    text.addText("Plain", { x: 0.5, y: 0.5, w: 4, h: 1, fontSize: 24, bold: true, fill: { color: "FFCC00" }, line: { color: "000000", width: 1 } });
    text.addText(
        [
            { text: "Bullet ", options: { bullet: true, color: "FF0000" } },
            { text: "link", options: { hyperlink: { slide: 2, tooltip: "Next" }, underline: { style: "dbl" } } },
            { text: "Numbered", options: { bullet: { type: "number" }, breakLine: true, highlight: "FFFF00" } },
        ],
        { x: 0.5, y: 1.6, w: 4, h: 2, valign: "bottom", rotate: 15, shadow: { type: "outer", color: "000000", opacity: 0.4, blur: 3, offset: 2, angle: 45 } },
    );
    text.addText("In a shape", { shape: "roundRect", x: 5, y: 0.5, w: 3, h: 2, fill: { color: "4472C4" }, rectRadius: 0.2, align: "center" });
    text.hidden = true;

    const shapes = pres.addSlide();
    shapes.bkgd = "112233";
    shapes.addShape("rect", { x: 0.5, y: 0.5, w: 2, h: 1, fill: { color: "00FF00", transparency: 40 }, flipH: true });
    shapes.addShape("line", { x: 3, y: 0.5, w: 2, h: 1, line: { color: "FF0000", width: 2, dashType: "dash", beginArrowType: "oval", endArrowType: "triangle" } });
    shapes.addShape("star5", { x: 6, y: 0.5, w: 2, h: 2, hyperlink: { url: "https://example.com" } });
    shapes.addShape("custGeom", { x: 0.5, y: 3, w: 2, h: 2, points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 2 }, { close: true }] });
    shapes.addImage({ data: PNG, x: 3, y: 3, w: 1, h: 1, sizing: { type: "contain", w: 2, h: 1 }, rounding: true, transparency: 25 });
    shapes.addImage({ path: "logo.png", x: 6, y: 3, w: 1, h: 1, hyperlink: { url: "https://example.com" }, altText: "Logo" });
    shapes.addImage({ path: "https://example.com/a.png", x: 8, y: 3, w: 1, h: 1, sizing: { type: "crop", x: 0.1, y: 0.1, w: 0.5, h: 0.5 } });

    const tables = pres.addSlide();
    tables.addTable(
        Array.from({ length: 30 }, (_, row) => [
            { text: `Row ${row}`, options: { bold: row === 0, fill: { color: row === 0 ? "DDDDDD" : "FFFFFF" } } },
            { text: [{ text: "rich " }, { text: "cell", options: { italic: true } }], options: { colspan: 1, border: [{ type: "solid", color: "FF0000", pt: 1 }, { type: "none" }, { type: "dash", pt: 2 }, { type: "none" }] } },
        ]),
        { x: 0.5, y: 0.5, w: 6, colW: [2, 4], autoPage: true, autoPageRepeatHeader: true },
    );

    const charts = pres.addSlide();
    const data = [{ name: "Sales", labels: ["Q1", "Q2", "Q3"], values: [3, 5, 4] }];
    charts.addChart("bar", data, { x: 0.2, y: 0.2, w: 4, h: 2.5, showLegend: true, showTitle: true, title: "Bars" });
    charts.addChart("pie", data, { x: 4.5, y: 0.2, w: 3, h: 2.5 });
    charts.addChart("bar3D", data, { x: 0.2, y: 3, w: 4, h: 2.5 });
    charts.addChartEx({ renderer: "echarts", option: { xAxis: { data: ["A"] }, yAxis: {}, series: [{ type: "bar", data: [4] }] } }, { x: 4.5, y: 3, w: 3, h: 2 });
    charts.addChartEx({ renderer: "svg", svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect id="face" width="10" height="10"/></svg>' }, { x: 8, y: 3, w: 1, h: 1, altText: "Raw" });
    charts.addComponent({ type: "example/metric", version: 1, props: { label: "Revenue" } }, { x: 8, y: 0.2, w: 1.5, h: 1 });
    return pres;
}

describe("normalized slide-object model", () => {
    test("toHtml() is modelToHtml() of getModel(), before and after a JSON round trip", async () => {
        const pres = representativeDeck();
        const model = pres.getModel();
        expect(model.slides.flatMap(slide => slide.objects.map(object => object.kind))).toContain("component");
        expect(new Set(model.slides.flatMap(slide => slide.objects.map(object => object.kind)))).toEqual(new Set(["text", "shape", "image", "table", "chart", "chartExtension", "component"]));
        expect(model.slides.length).toBeGreaterThan(4);

        const json = JSON.stringify(model);
        const parsed = JSON.parse(json) as NormalizedPresentation;
        expect(JSON.stringify(parsed)).toBe(json);

        // `as`: the registry is private; toHtml() passes this same object.
        const components = (pres as unknown as { components: ComponentLookup }).components;
        const options = { components, resolveImage, createDocument: createNodeDocument };
        const html = await pres.toHtml();
        expect(html.html).toContain(`src="${PNG}"`);
        expect(html.html).not.toContain("data-source-");
        expect(await modelToHtml(model, options)).toEqual(html);
        expect(await modelToHtml(parsed, options)).toEqual(html);
        // modelToHtml() leaves its input alone: the path images are still paths.
        expect(JSON.stringify(model)).toBe(json);
    });

    test("records slide properties and returns a detached copy", () => {
        const pres = representativeDeck();
        const [first, second] = pres.getModel().slides;
        expect(first).toMatchObject({ background: "#F1F1F1", color: "#333333", hidden: true });
        expect(second).toMatchObject({ background: "#112233", hidden: false });
        pres.getModel().slides[0]!.objects.length = 0;
        expect(pres.getModel().slides[0]!.objects).toHaveLength(3);
    });

    test("components need their registry to render; errors still throw from addX and leave the model unchanged", () => {
        const pres = representativeDeck();
        expect(() => renderPresentationDocument(pres.getModel(), undefined, createNodeDocument)).toThrow("requires its component registry");

        const slide = pres.addSlide();
        expect(() => slide.addChart("bar", [{ name: "S", labels: ["A"], values: [1] }], { x: 0, y: 0, w: 0, h: 1 })).toThrow("greater than zero");
        expect(() => slide.addChartEx({ renderer: "svg", svg: "<div></div>" }, { x: 0, y: 0, w: 1, h: 1 })).toThrow();
        expect(() => slide.addImage({ x: 0, y: 0, w: 1, h: 1 } as never)).toThrow("requires either 'data' or 'path'");
        expect(() => slide.addComponent({ type: "missing", version: 1, props: {} }, { x: 0, y: 0, w: 1, h: 1 })).toThrow("Unknown component");
        expect(pres.getModel().slides.at(-1)!.objects).toHaveLength(0);
    });
});
