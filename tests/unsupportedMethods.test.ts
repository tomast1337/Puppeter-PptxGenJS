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
