import { describe, expect, test } from "bun:test";
import { inches, px } from "@pdflapas/model";
import type { NormalizedSlideObject } from "@pdflapas/model";
import pptxgen from "pptxgenjs";
import { PAGE_SIZES, pageSize } from "../packages/pptxgenjs/src/pageLayouts";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";

const LAYOUT_NAMES = ["LAYOUT_4x3", "LAYOUT_16x9", "LAYOUT_16x10", "LAYOUT_WIDE"];

function firstRunFont(object: NormalizedSlideObject | undefined): string | undefined {
    if (object?.kind === "text") return object.text.paragraphs[0]?.runs[0]?.fontFace;
    if (object?.kind === "table") return object.table.rows[0]?.cells[0]?.text.paragraphs[0]?.runs[0]?.fontFace;
    return undefined;
}

describe("presentation properties read like PptxGenJS 4.0.1", () => {
    test("version, the enum objects and their deprecated aliases match the pinned runtime", () => {
        const reference = new pptxgen() as pptxgen & Record<string, unknown>;
        const pres = new PuppeteerGen() as PuppeteerGen & Record<string, unknown>;
        expect(pres.version).toBe(reference.version);
        for (const name of ["AlignH", "AlignV", "ChartType", "OutputType", "SchemeColor", "ShapeType", "charts", "colors", "shapes"]) {
            expect({ name, value: pres[name] }).toEqual({ name, value: reference[name] });
        }
        // Declared in index.d.ts, absent from the runtime instance.
        expect(reference.PlaceholderType).toBeUndefined();
        expect(pres.PlaceholderType).toBeUndefined();
    });

    test("layout is undefined until assigned and presLayout starts at PptxGenJS's 16:9", () => {
        const reference = new pptxgen();
        const pres = new PuppeteerGen();
        expect(pres.layout).toBe(reference.layout);
        expect(pres.layout).toBeUndefined();
        const { name, width, height } = reference.presLayout;
        expect(pres.presLayout).toEqual({ name, width, height });
    });

    test.each(LAYOUT_NAMES)("layout = %s sets the page size and presLayout PptxGenJS sets", layout => {
        const reference = new pptxgen();
        const pres = new PuppeteerGen();
        reference.layout = layout;
        pres.layout = layout;
        expect(pres.layout).toBe(layout);
        expect(pres.presLayout).toEqual(reference.presLayout);
        expect(pres.getModel().pageSize.width * 914400).toBeCloseTo(reference.presLayout.width, -1);
        expect(pres.getModel().pageSize.height * 914400).toBeCloseTo(reference.presLayout.height, -1);
    });

    test("LAYOUT_16x9 is the default page, so assigning it leaves the HTML unchanged", async () => {
        const assigned = new PuppeteerGen();
        assigned.layout = "LAYOUT_16x9";
        expect(assigned.getModel().pageSize).toEqual(PAGE_SIZES.SCREEN_16X9.landscape);
    });

    test("layout selects a defineLayout() name, with PptxGenJS's presLayout", () => {
        const reference = new pptxgen();
        const pres = new PuppeteerGen();
        for (const target of [reference, pres]) {
            target.defineLayout({ name: "A3", width: 16.5, height: 11.7 });
            target.layout = "LAYOUT_4x3";
            target.layout = "A3";
        }
        const { name, width, height } = reference.presLayout;
        expect(pres.presLayout).toEqual({ name, width, height });
        expect(pres.getModel().pageSize).toEqual(pageSize(16.5, 11.7, "A3"));
    });

    test("an unknown layout throws like PptxGenJS, with the names to use instead", () => {
        expect(() => {
            new pptxgen().layout = "LAYOUT_A4";
        }).toThrow("UNKNOWN-LAYOUT");
        const pres = new PuppeteerGen();
        expect(() => {
            pres.layout = "LAYOUT_A4";
        }).toThrow("UNKNOWN-LAYOUT: 'LAYOUT_A4' is not a layout. Use LAYOUT_4x3, LAYOUT_16x9, LAYOUT_16x10, LAYOUT_WIDE, or call pres.defineLayout({ name: 'LAYOUT_A4', width, height }) first.");
        expect(() => {
            pres.layout = "toString";
        }).toThrow("UNKNOWN-LAYOUT");
        expect(pres.getModel().pageSize).toEqual(PAGE_SIZES.SCREEN_16X9.landscape);
    });

    test("the page size applies to every slide; percentages keep the size of the slide's layout, as PptxGenJS resolves them", () => {
        const pres = new PuppeteerGen();
        pres.addSlide().addText("before", { x: "50%", y: 0, w: 1, h: 1 });
        pres.layout = "LAYOUT_WIDE";
        pres.addSlide().addText("after", { x: "50%", y: 0, w: 1, h: 1 });
        const model = pres.getModel();
        expect(model.pageSize.width).toBe(inches(40 / 3));
        // Slide 1 was added under 16:9 (10 in wide), slide 2 under LAYOUT_WIDE.
        expect(model.slides.map(slide => slide.objects[0]?.style.geometry.x)).toEqual([480, 640].map(px));
    });

    test("defineLayout() rejects a size PptxGenJS would write as NaN", () => {
        const pres = new PuppeteerGen();
        expect(() => pres.defineLayout({ name: "Bad", width: 0, height: 5 })).toThrow("defineLayout() needs { name, width, height } with width and height in inches greater than zero");
        expect(() => pres.defineLayout({ name: "Bad", width: Number.NaN, height: 5 })).toThrow("greater than zero");
        expect(pres.getModel().pageSize).toEqual(PAGE_SIZES.SCREEN_16X9.landscape);
    });

    test("the constructor and setPageSize() take plain inches and check them, as defineLayout() does (#277)", () => {
        const pres = new PuppeteerGen({ width: 10, height: 5.625, name: "Plain" });
        expect(pres.getModel().pageSize).toEqual(pageSize(10, 5.625, "Plain"));
        expect(pres.presLayout.name).toBe("Plain");
        pres.setPageSize({ width: 8.5, height: 11, name: "Letter" });
        expect(pres.getModel().pageSize).toEqual(pageSize(8.5, 11, "Letter"));
        expect(() => pres.setPageSize({ width: -1, height: 5, name: "Bad" })).toThrow("setPageSize() needs { name, width, height } with width and height in inches greater than zero");
        expect(() => new PuppeteerGen({ width: Number.POSITIVE_INFINITY, height: 5, name: "Bad" })).toThrow("new PuppeteerGen(pageSize) needs");
        expect(pres.getModel().pageSize).toEqual(pageSize(8.5, 11, "Letter"));
    });

    test("rtlMode is stored like PptxGenJS and, like PptxGenJS's slides, draws nothing differently", async () => {
        const reference = new pptxgen();
        const pres = new PuppeteerGen();
        expect(pres.rtlMode).toBe(reference.rtlMode);
        pres.addSlide().addText("Hello", { x: 1, y: 1, w: 3, h: 1 });
        const before = await pres.toHtml();
        pres.rtlMode = true;
        expect(pres.rtlMode).toBe(true);
        expect(await pres.toHtml()).toEqual(before);
    });
});

describe("pres.theme", () => {
    test("is undefined until assigned, as in PptxGenJS", () => {
        expect(new PuppeteerGen().theme).toBe(new pptxgen().theme);
    });

    test("bodyFontFace is the default font of text, shape text, table cells and chart legends; an explicit fontFace wins", () => {
        const pres = new PuppeteerGen();
        const slide = pres.addSlide();
        pres.theme = { headFontFace: "Georgia", bodyFontFace: "Arial" };
        slide
            .addText("body", { x: 0, y: 0, w: 2, h: 1 })
            .addText("shape", { x: 0, y: 1, w: 2, h: 1, shape: "rect" })
            .addText([{ text: "run", options: { fontFace: "Courier New" } }, { text: "inherits" }], { x: 0, y: 2, w: 2, h: 1 })
            .addText("explicit", { x: 0, y: 3, w: 2, h: 1, fontFace: "Times New Roman" })
            .addTable([[{ text: "cell" }]], { x: 3, y: 0, w: 2 })
            .addTable([[{ text: "cell" }]], { x: 3, y: 1, w: 2, fontFace: "Verdana" })
            .addChart("bar", [{ name: "S", labels: ["A"], values: [1] }], { x: 5, y: 0, w: 4, h: 3 });
        const objects = pres.getModel().slides[0]?.objects ?? [];
        expect(objects.slice(0, 2).map(firstRunFont)).toEqual(["Arial", "Arial"]);
        const runs = objects[2]?.kind === "text" ? objects[2].text.paragraphs[0]?.runs.map(run => run.fontFace) : [];
        expect(runs).toEqual(["Courier New", "Arial"]);
        expect(objects.slice(3, 6).map(firstRunFont)).toEqual(["Times New Roman", "Arial", "Verdana"]);
        expect(objects[6]?.kind === "chart" ? objects[6].chart.legendFontFace : undefined).toBe("Arial");
    });

    test("an empty or absent bodyFontFace keeps Calibri, as PptxGenJS writes it to theme1.xml", () => {
        const pres = new PuppeteerGen();
        pres.theme = { headFontFace: "Georgia", bodyFontFace: "" };
        pres.addSlide().addText("body", { x: 0, y: 0, w: 2, h: 1 });
        expect(firstRunFont(pres.getModel().slides[0]?.objects[0])).toBe("Calibri");
    });

    test("rejects a font that is not a string", () => {
        const pres = new PuppeteerGen();
        expect(() => {
            pres.theme = { bodyFontFace: 12 as unknown as string };
        }).toThrow('pres.theme.bodyFontFace must be a font name such as "Arial", got 12');
    });

    test("changing bodyFontFace after objects were added throws instead of leaving them in the old font", () => {
        const pres = new PuppeteerGen();
        pres.addSlide().addText("body", { x: 0, y: 0, w: 2, h: 1 });
        pres.theme = { headFontFace: "Georgia" };
        expect(() => {
            pres.theme = { bodyFontFace: "Arial" };
        }).toThrow('pres.theme.bodyFontFace "Arial" was set after slide objects were added');
        expect(pres.theme).toEqual({ headFontFace: "Georgia" });
    });
});
