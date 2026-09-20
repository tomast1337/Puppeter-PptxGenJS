import { describe, expect, test } from "bun:test";
import { PuppeteerGen } from "../src/PuppeterrGen";
import { PAGE_SIZES } from "../src/pageLayouts";

describe("PuppeteerGen DOM rendering", () => {
    test("creates fixed-size slides and positions text in inches", () => {
        const presentation = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape);
        const slide = presentation.addSlide();

        slide.addText("Hello\nPDF", {
            x: 1,
            y: "20%",
            w: 4,
            h: 1,
            fontSize: 18,
            color: "363636",
            underline: { style: "sng", color: "FF0000" },
        });

        const element = presentation.page.querySelector<HTMLElement>(".slide-text");
        expect(presentation.page.querySelectorAll(".slide-container")).toHaveLength(1);
        expect(element?.querySelectorAll(".text-paragraph")).toHaveLength(2);
        expect(element?.textContent).toBe("HelloPDF");
        expect(element?.style.left).toBe("96px");
        expect(element?.style.top).toBe("108px");
        const run = element?.querySelector<HTMLElement>(".text-run");
        expect(run?.style.fontSize).toBe("24px");
        expect(run?.style.textDecorationLine).toBe("underline");
    });

    test("keeps each slide object in insertion-order stacking", () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        slide.addText("Earlier overflowing text", { x: 1, y: 1, w: 1, h: 1, wrap: false });
        slide.addText("Later filled text", { x: 2, y: 1, w: 1, h: 1, fill: { color: "FFFFFF" } });

        const elements = presentation.page.querySelectorAll<HTMLElement>(".slide-element");
        const earlier = elements.item(0);
        const later = elements.item(1);
        expect(elements).toHaveLength(2);
        expect(presentation.page.defaultView?.getComputedStyle(earlier).zIndex).toBe("0");
        expect(presentation.page.defaultView?.getComputedStyle(later).zIndex).toBe("0");
        expect(earlier.nextElementSibling).toBe(later);
    });

    test("renders PptxGenJS fill and line objects on shapes", () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();

        slide.addShape("rect", {
            x: 1,
            y: 1,
            w: 2,
            h: 1,
            fill: { color: "4472C4", transparency: 20 },
            line: { color: "112233", width: 2 },
        });

        const element = presentation.page.querySelector<HTMLElement>(".slide-shape");
        const geometry = element?.querySelector<SVGGeometryElement>(".shape-geometry");
        expect(geometry?.getAttribute("fill")).toBe("rgba(68, 114, 196, 0.8)");
        expect(geometry?.getAttribute("stroke")).toBe("#112233");
        expect(geometry?.getAttribute("stroke-width")).toBe(String((2 * 96) / 72));
    });

    test("uses the deprecated shapeName alias as the object name", () => {
        const presentation = new PuppeteerGen();
        presentation.addSlide().addShape("rect", { shapeName: "Legacy shape" });
        expect(presentation.page.querySelector<HTMLElement>(".slide-shape")?.dataset.objectName).toBe("Legacy shape");
    });

    test("creates styled table cells", () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();

        slide.addTable(
            [
                [
                    {
                        text: "Header",
                        options: { bold: true, color: "FFFFFF", fill: { color: "4472C4" } },
                    },
                ],
            ],
            { x: 1, y: 1, w: 4, h: 1 },
        );

        const cell = presentation.page.querySelector<HTMLTableCellElement>("td");
        const run = cell?.querySelector<HTMLElement>(".text-run");
        expect(cell?.textContent).toBe("Header");
        expect(run?.style.fontWeight).toBe("bold");
        expect(run?.style.color).toBe("rgb(255, 255, 255)");
        expect(cell?.style.backgroundColor).toBe("rgb(68, 114, 196)");
    });

    test("applies shared transforms and object names", () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();

        slide.addImage({
            data: "data:image/png;base64,iVBORw0KGgo=",
            x: 1,
            y: 1,
            w: 2,
            h: 2,
            rotate: 30,
            flipH: true,
            transparency: 25,
            objectName: "Hero image",
            altText: "Hero",
        });

        const image = presentation.page.querySelector<HTMLElement>(".slide-image");
        const content = image?.querySelector<HTMLImageElement>(".slide-image-content");
        expect(image?.style.transform).toBe("rotate(30deg) scaleX(-1)");
        expect(image?.style.opacity).toBe("");
        expect(content?.style.opacity).toBe("0.75");
        expect(image?.dataset.objectName).toBe("Hero image");
        expect(content?.alt).toBe("Hero");
    });

    test("updates slide background and inherited text color", () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        slide.background = { color: "accent1" };
        slide.color = "FFFFFF";
        slide.addText("Inherited", { x: 1, y: 1, w: 2, h: 1 });

        const slideElement = presentation.page.querySelector<HTMLElement>(".slide-container");
        expect(slideElement?.style.backgroundColor).toBe("rgb(68, 114, 196)");
        expect(slideElement?.style.getPropertyValue("--slide-text-color")).toBe("#FFFFFF");
    });
});
