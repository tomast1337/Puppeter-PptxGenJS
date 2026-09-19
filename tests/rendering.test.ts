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
        expect(element?.textContent).toBe("Hello\nPDF");
        expect(element?.style.left).toBe("96px");
        expect(element?.style.top).toBe("108px");
        expect(element?.style.fontSize).toBe("24px");
        expect(element?.style.textDecorationLine).toBe("underline");
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
        expect(element?.style.backgroundColor).toBe("rgba(68, 114, 196, 0.8)");
        expect(element?.style.borderColor).toBe("rgb(17, 34, 51)");
        expect(element?.style.borderWidth).toBe(`${2 * 96 / 72}px`);
    });

    test("creates styled table cells", () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();

        slide.addTable([[{
            text: "Header",
            options: { bold: true, color: "FFFFFF", fill: { color: "4472C4" } },
        }]], { x: 1, y: 1, w: 4, h: 1 });

        const cell = presentation.page.querySelector<HTMLTableCellElement>("td");
        expect(cell?.textContent).toBe("Header");
        expect(cell?.style.fontWeight).toBe("bold");
        expect(cell?.style.backgroundColor).toBe("rgb(68, 114, 196)");
    });
});
