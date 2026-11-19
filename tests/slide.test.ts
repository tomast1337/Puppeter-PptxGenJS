import { describe, expect, test } from "bun:test";
import pptxgen from "pptxgenjs";
import type PptxGenJS from "pptxgenjs";
import type { NormalizedSlide, NormalizedSlideObject } from "../packages/model/src/index";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { inchesToPixels, pointsToPixels } from "@pdflapas/model";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const pt = pointsToPixels;

function slideNumberOf(slide: NormalizedSlide | undefined): Extract<NormalizedSlideObject, { kind: "text" }> {
    const object = slide?.objects.at(-1);
    if (object?.kind !== "text" || object.style.objectName !== "Slide Number") throw new Error(`no slide number last on ${JSON.stringify(slide)}`);
    return object;
}

describe("slide.slideNumber", () => {
    test("reads null until set, as in PptxGenJS, then the props it was given", () => {
        const slide = new PuppeteerGen().addSlide();
        expect(slide.slideNumber).toBe(new pptxgen().addSlide().slideNumber);
        expect(slide.slideNumber).toBeNull();
        const props = { x: 1, y: 2 };
        slide.slideNumber = props;
        expect(slide.slideNumber).toBe(props);
    });

    test("is the slide's position as text, painted last, in PptxGenJS's 800000 x 300000 EMU box by default", () => {
        const pres = new PuppeteerGen();
        pres.addSlide();
        const slide = pres.addSlide();
        slide.slideNumber = { x: 1, y: 2 };
        slide.addText("added after the number", { x: 0, y: 0 });
        const number = slideNumberOf(pres.getModel().slides[1]);
        expect(number.text.paragraphs.map(p => p.runs.map(r => r.text).join(""))).toEqual(["2"]);
        expect(number.style.geometry).toMatchObject({ x: 96, y: 192, width: (800000 / 914400) * 96, height: (300000 / 914400) * 96 });
        // No font, size or color anywhere: the master's 18pt body text, left and top.
        expect(number.text).toMatchObject({ verticalAlign: "top", margin: [0.05, 0.1, 0.05, 0.1].map(inchesToPixels) });
        expect(number.text.paragraphs[0]).toMatchObject({ align: "left" });
        expect(number.text.paragraphs[0]?.runs[0]).toMatchObject({ fontFace: "Calibri", fontSize: pt(18), color: "#000000", bold: false });
        expect(pres.getModel().slides[0]?.objects).toEqual([]);
    });

    test("inherits size, color, font, anchor and insets from the slideNumber set last, keeping its own alignment and bold", () => {
        const pres = new PuppeteerGen();
        const plain = pres.addSlide();
        const sized = pres.addSlide();
        const master = pres.addSlide();
        plain.slideNumber = { x: 1, y: 1, align: "center" };
        sized.slideNumber = { x: 1, y: 1, fontSize: 40 };
        master.slideNumber = { x: 1, y: 1, fontFace: "Arial", fontSize: 20, color: "FF0000", bold: true, valign: "bottom", margin: [1, 2, 3, 4] };
        const [plainNumber, sizedNumber, masterNumber] = pres.getModel().slides.map(slideNumberOf);
        const inherited = { verticalAlign: "bottom", margin: [pt(1), pt(2), pt(3), pt(4)] };
        expect(plainNumber?.text).toMatchObject(inherited);
        expect(plainNumber?.text.paragraphs[0]).toMatchObject({ align: "center" });
        expect(plainNumber?.text.paragraphs[0]?.runs[0]).toMatchObject({ fontFace: "Arial", fontSize: pt(20), color: "#FF0000", bold: false });
        // A size of its own writes the run size, so the master's no longer applies; color and font still do.
        expect(sizedNumber?.text.paragraphs[0]?.runs[0]).toMatchObject({ fontFace: "Arial", fontSize: pt(40), color: "#FF0000" });
        expect(masterNumber?.text).toMatchObject(inherited);
        expect(masterNumber?.text.paragraphs[0]?.runs[0]).toMatchObject({ bold: true, fontSize: pt(20) });
    });

    test("a font or color without a size gives PptxGenJS's 12pt, and a number margin applies to every side", () => {
        const pres = new PuppeteerGen();
        const slide = pres.addSlide();
        slide.slideNumber = { x: 0, y: 0, color: "00FF00", margin: 5, align: "justify" };
        const number = slideNumberOf(pres.getModel().slides[0]);
        expect(number.text.margin).toEqual([pt(5), pt(5), pt(5), pt(5)]);
        expect(number.text.paragraphs[0]).toMatchObject({ align: "left" });
        expect(number.text.paragraphs[0]?.runs[0]).toMatchObject({ fontSize: pt(12), color: "#00FF00" });
    });
});

describe("slide.hidden", () => {
    test("leaves the slide out of the HTML; the others keep their number and slide links jump to it", async () => {
        const pres = new PuppeteerGen();
        pres.addSlide().addText([
            { text: "to the hidden slide ", options: { hyperlink: { slide: 2 } } },
            { text: "to the third", options: { hyperlink: { slide: 3 } } },
        ]);
        const hidden = pres.addSlide();
        hidden.addText("not printed", {});
        hidden.addImage({ path: "missing.png" });
        hidden.hidden = true;
        pres.addSlide().slideNumber = { x: 0, y: 0 };
        expect(pres.getModel().slides.map(slide => slide.hidden)).toEqual([false, true, false]);
        // The hidden slide's picture is never resolved, so a missing one does not fail the export.
        const { html } = await pres.toHtml();
        expect(html).not.toContain("not printed");
        expect([...html.matchAll(/class="slide-container" id="(slide-\d+)"/g)].map(match => match[1])).toEqual(["slide-1", "slide-3"]);
        expect(html).toContain('href="#slide-3"');
        expect(html).toContain(">3</span>");
        expect(html).not.toContain("data-hidden");
        hidden.hidden = false;
        expect(pres.getModel().slides[1]?.hidden).toBe(false);
    });
});

describe("slide.background picture", () => {
    test("is a stretched image over the whole slide, under every object, from data or path", () => {
        const pres = new PuppeteerGen();
        const slide = pres.addSlide();
        slide.addText("on top", { x: 1, y: 1 });
        slide.background = { data: PNG, color: "FF0000" };
        const [background, text] = pres.getModel().slides[0]?.objects ?? [];
        expect(background).toMatchObject({ kind: "image", style: { objectName: "Background", geometry: { x: 0, y: 0, width: 960, height: 540 } }, image: { source: PNG, sourceKind: "data", sizing: { type: "stretch" } } });
        expect(text?.kind).toBe("text");
        slide.background = { path: "picture.png" };
        expect(pres.getModel().slides[0]?.objects[0]).toMatchObject({ image: { source: "picture.png", sourceKind: "path" } });
    });

    test("covers the presentation's final page size", () => {
        const pres = new PuppeteerGen();
        pres.addSlide().background = { data: PNG };
        pres.layout = "LAYOUT_4x3";
        expect(pres.getModel().slides[0]?.objects[0]?.style.geometry).toMatchObject({ width: 960, height: 720 });
    });

    test("follows PptxGenJS: a later color keeps the picture, src is ignored, and an object bkgd counts once background is set", () => {
        const pres = new PuppeteerGen();
        const kept = pres.addSlide();
        kept.background = { data: PNG };
        kept.background = { color: "00FF00" };
        const ignored = pres.addSlide();
        ignored.background = { src: "picture.png" };
        const deprecated = pres.addSlide();
        (deprecated as { bkgd: unknown }).bkgd = { src: "old.png" };
        const before = pres.getModel().slides[2];
        deprecated.background = { color: "0000FF" };
        const [keptModel, ignoredModel, deprecatedModel] = pres.getModel().slides;
        // The picture alone is written: its transparent parts show white, not the color.
        expect(keptModel).toMatchObject({ background: "#FFFFFF", objects: [{ kind: "image", image: { source: PNG } }] });
        expect(ignoredModel?.objects).toEqual([]);
        expect(before).toMatchObject({ background: "#FFFFFF", objects: [] });
        expect(deprecatedModel).toMatchObject({ background: "#FFFFFF", objects: [{ kind: "image", image: { source: "old.png" } }] });
    });

    test("rejects picture data that is not a base64 image data URI when it is set", () => {
        const slide = new PuppeteerGen().addSlide();
        expect(() => {
            slide.background = { data: "image/png;base64" };
        }).toThrow("Image data must be base64-encoded image data");
    });
});

describe("addSlide()", () => {
    test("ignores props other than masterName and sectionTitle, as PptxGenJS does", () => {
        // `as`: AddSlideProps has no background; JavaScript callers can still pass one.
        const props = { background: { color: "FF0000" }, bkgd: "00FF00" } as PptxGenJS.AddSlideProps;
        expect(new pptxgen().addSlide(props).background).toBeUndefined();
        const pres = new PuppeteerGen();
        pres.addSlide(props);
        expect(pres.getModel().slides[0]).toMatchObject({ background: "#FFFFFF", objects: [] });
    });
});
