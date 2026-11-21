import { describe, expect, spyOn, test } from "bun:test";
import { UnsupportedFeatureError } from "../packages/pptxgenjs/src/html";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function errorFrom(action: () => unknown): unknown {
    try {
        action();
    } catch (error) {
        return error;
    }

    throw new Error("expected the call to throw");
}

describe("PptxGenJS methods without a PDF rendering", () => {
    test("addMedia throws an UnsupportedFeatureError naming the method and the addImage workaround", () => {
        const slide = new PuppeteerGen().addSlide();
        const error = errorFrom(() => slide.addMedia({ type: "video", path: "movie.mp4", x: 1, y: 1, w: 4, h: 3 }));

        expect(error).toBeInstanceOf(UnsupportedFeatureError);
        expect(error).toMatchObject({ name: "UnsupportedFeatureError", code: "UNSUPPORTED_FEATURE", feature: "addMedia" });
        expect((error as Error).message).toBe("addMedia() is not supported by PuppeteerGen yet. A PDF cannot play audio or video; add a poster frame with addImage() and link the media through its `hyperlink` option.");
    });

    test("defineSlideMaster throws an UnsupportedFeatureError naming the method and a per-slide workaround", () => {
        const pres = new PuppeteerGen();
        const error = errorFrom(() => pres.defineSlideMaster({ title: "MASTER", background: { color: "FFFFFF" } }));

        expect(error).toBeInstanceOf(UnsupportedFeatureError);
        expect(error).toMatchObject({ feature: "defineSlideMaster" });
        expect((error as Error).message).toStartWith("defineSlideMaster() is not supported by PuppeteerGen yet. Set `slide.background`");
    });

    // Layout placeholders and masters need defineSlideMaster(); the options naming them throw instead of drawing a plain object.
    test("placeholder and masterSlideName throw an UnsupportedFeatureError naming the option and leave the deck unchanged", () => {
        const pres = new PuppeteerGen();
        const slide = pres.addSlide();
        const text = errorFrom(() => slide.addText("Title", { x: 1, y: 1, w: 4, h: 1, placeholder: "title" }));

        expect(text).toBeInstanceOf(UnsupportedFeatureError);
        expect(text).toMatchObject({ feature: "addText({ placeholder })" });
        expect((text as Error).message).toBe("addText({ placeholder }) is not supported by PuppeteerGen yet. Placeholders come from slide layouts, which need defineSlideMaster(), and PdfLapas has no slide masters. Remove `placeholder` and give the object its own x, y, w, h and style.");
        expect(errorFrom(() => slide.addImage({ data: PNG, x: 1, y: 1, w: 1, h: 1, placeholder: "body" }))).toMatchObject({ feature: "addImage({ placeholder })" });
        const table = errorFrom(() => pres.tableToSlides("<table><tr><td>A</td></tr></table>", { masterSlideName: "MASTER" }));

        expect(table).toMatchObject({ feature: "tableToSlides({ masterSlideName })" });
        expect((table as Error).message).toStartWith("tableToSlides({ masterSlideName }) is not supported by PuppeteerGen yet. Slide masters need defineSlideMaster()");
        expect(pres.getModel().slides).toHaveLength(1);
        expect(pres.getModel().slides[0]?.objects).toEqual([]);
    });

    test("addSlide masterName throws like masterSlideName; PptxGenJS's built-in DEFAULT and empty names are accepted", () => {
        const pres = new PuppeteerGen();
        const named = errorFrom(() => pres.addSlide({ masterName: "MASTER" }));

        expect(named).toBeInstanceOf(UnsupportedFeatureError);
        expect(named).toMatchObject({ feature: "addSlide({ masterName })" });
        expect((named as Error).message).toStartWith("addSlide({ masterName }) is not supported by PuppeteerGen yet. Slide masters need defineSlideMaster()");
        // PptxGenJS 4.0.1 still takes a master name as the first argument (deprecated since 3.2.0).
        expect(errorFrom(() => pres.addSlide("MASTER"))).toMatchObject({ feature: "addSlide({ masterName })" });
        expect(pres.getModel().slides).toHaveLength(0);
        pres.addSlide({ masterName: "DEFAULT" });
        pres.addSlide("DEFAULT");
        pres.addSlide({ masterName: "" });
        expect(pres.getModel().slides).toHaveLength(3);
    });

    // genTableToSlides: the built-in layout's 0.5in margins replace slideMargin.
    test("tableToSlides masterSlideName DEFAULT takes the built-in layout's margins over slideMargin", () => {
        const html = '<table style="width:600px"><tr><td>A</td></tr></table>';
        const tableX = (options: { slideMargin: number; masterSlideName?: string }) => {
            const pres = new PuppeteerGen();

            pres.tableToSlides(html, options);

            return pres.getModel().slides[0]?.objects[0]?.style.geometry.x ?? Number.NaN;
        };

        expect(tableX({ slideMargin: 1, masterSlideName: "DEFAULT" })).toBe(tableX({ slideMargin: 0.5 }));
        expect(tableX({ slideMargin: 1 })).not.toBe(tableX({ slideMargin: 0.5 }));
    });

    // PptxGenJS stores notes for the notes page only; a slide export never draws them.
    test("addNotes is accepted, chainable and draws nothing on the slide", () => {
        const pres = new PuppeteerGen();
        const slide = pres.addSlide();

        expect(slide.addNotes("Speaker notes").addImage({ data: PNG, x: 1, y: 1, w: 1, h: 1 })).toBe(slide);
        expect(pres.getModel().slides[0]?.objects.map(object => object.kind)).toEqual(["image"]);
    });

    // PptxGenJS records sections for PowerPoint's slide list and warns, without throwing, on a missing title.
    test("addSection is accepted, draws nothing and keeps PptxGenJS's warnings", () => {
        const warn = spyOn(console, "warn").mockImplementation(() => {});
        const pres = new PuppeteerGen();

        pres.addSection({ title: "Intro" });
        expect(warn).not.toHaveBeenCalled();
        pres.addSection({} as { title: string });
        expect(warn).toHaveBeenCalledWith("addSection requires a title");
        warn.mockRestore();
        pres.addSlide();
        expect(pres.getModel().slides).toHaveLength(1);
        expect(pres.getModel().slides[0]?.objects).toEqual([]);
    });
});
