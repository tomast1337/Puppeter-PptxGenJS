import { describe, expect, test } from "bun:test";
import { normalizeCustomPath, normalizeShape } from "../src/normalize/shape";
import { PAGE_SIZES } from "../src/pageLayouts";
import { PuppeteerGen } from "../src/PuppeterrGen";

const PAGE = PAGE_SIZES.SCREEN_16X9.landscape;

describe("shape normalization", () => {
    test("normalizes core preset geometry and rounded radius", () => {
        expect(normalizeShape("rect", {}, 192, 96, PAGE).geometry).toEqual({ kind: "rect", radius: 0 });
        expect(normalizeShape("roundRect", {}, 192, 96, PAGE).geometry).toEqual({ kind: "rect", radius: 16 });
        expect(normalizeShape("roundRect", { rectRadius: 0.1 }, 192, 96, PAGE).geometry)
            .toEqual({ kind: "rect", radius: 9.600000000000001 });
        expect(normalizeShape("ellipse", {}, 192, 96, PAGE).geometry).toEqual({ kind: "ellipse" });
        expect(normalizeShape("lineInv", {}, 192, 96, PAGE).geometry).toEqual({ kind: "line", inverse: true });
    });

    test("normalizes custom lines and bezier curves in local SVG coordinates", () => {
        const path = normalizeCustomPath([
            { x: 0, y: 0 },
            { x: 1, y: 0.5 },
            { x: 2, y: 1, curve: { type: "quadratic", x1: 1.5, y1: 0 } },
            { x: 3, y: 1, curve: { type: "cubic", x1: 2.25, y1: 1.5, x2: 2.75, y2: 0.5 } },
            { close: true },
        ], PAGE);
        expect(path).toBe("M 0 0 L 96 48 Q 144 0 192 96 C 216 144 264 48 288 96 Z");
    });

    test("converts DrawingML arc commands to SVG endpoint arcs", () => {
        expect(normalizeCustomPath([
            { x: 1, y: 0.5 },
            { x: 0, y: 0, curve: { type: "arc", wR: 1, hR: 0.5, stAng: 0, swAng: 90 } },
        ], PAGE)).toBe("M 96 48 A 96 48 0 0 1 0 96");
    });

    test("requires custom points and rejects unsupported presets", () => {
        expect(() => normalizeShape("custGeom", {}, 100, 100, PAGE)).toThrow("requires at least one point");
        expect(() => normalizeShape("cloud", {}, 100, 100, PAGE)).toThrow("Unsupported shape geometry: cloud");
        expect(() => normalizeShape("rect", { hyperlink: {} }, 100, 100, PAGE)).toThrow("hyperlink requires either url or slide");
    });

    test("normalizes polygon and star preset families", () => {
        expect(normalizeShape("triangle", {}, 100, 80, PAGE).geometry).toEqual({
            kind: "path", data: "M 50 0 L 100 80 L 0 80 Z",
        });
        expect(normalizeShape("diamond", {}, 100, 80, PAGE).geometry).toEqual({
            kind: "path", data: "M 50 0 L 100 40 L 50 80 L 0 40 Z",
        });
        expect((normalizeShape("hexagon", {}, 100, 80, PAGE).geometry as { data: string }).data).toContain("L");
        expect((normalizeShape("star5", {}, 100, 80, PAGE).geometry as { data: string }).data.match(/ L /g)).toHaveLength(9);
    });
});

describe("SVG shape rendering", () => {
    test("renders rectangles, ellipses, and zero-height arrow lines as SVG", () => {
        const presentation = new PuppeteerGen(PAGE);
        const slide = presentation.addSlide();
        slide.addShape("roundRect", {
            x: 1, y: 1, w: 2, h: 1, rectRadius: 0.1,
            fill: { color: "4472C4" }, line: { color: "17365D", width: 2, dashType: "dash" },
        });
        slide.addShape("ellipse", { x: 4, y: 1, w: 2, h: 1, fill: { color: "70AD47" } });
        slide.addShape("line", {
            x: 1, y: 3, w: 4, h: 0,
            line: { color: "ED7D31", width: 2, beginArrowType: "oval", endArrowType: "triangle" },
        });

        const shapes = presentation.page.querySelectorAll<HTMLElement>(".slide-shape");
        expect(shapes[0]?.querySelector("rect")?.getAttribute("rx")).toBe("9.600000000000001");
        expect(shapes[0]?.querySelector(".shape-geometry")?.getAttribute("stroke-dasharray")).toBe(`${4 * 2 * 96 / 72} ${3 * 2 * 96 / 72}`);
        expect(shapes[1]?.querySelector("ellipse")).not.toBeNull();
        expect(shapes[2]?.querySelector("svg")?.getAttribute("height")).toBe("1");
        expect(shapes[2]?.querySelector(".shape-geometry")?.getAttribute("marker-start")).toContain("-begin");
        expect(shapes[2]?.querySelector(".shape-geometry")?.getAttribute("marker-end")).toContain("-end");
    });

    test("renders custom paths and shape hyperlinks", () => {
        const presentation = new PuppeteerGen(PAGE);
        const slide = presentation.addSlide();
        slide.addShape("custGeom" as never, {
            x: 1, y: 1, w: 3, h: 2,
            points: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 1.5, y: 2 }, { close: true }],
            fill: { color: "FFC000" }, hyperlink: { slide: 2, tooltip: "Details" },
        });

        const shape = presentation.page.querySelector<HTMLAnchorElement>("a.slide-shape");
        expect(shape?.getAttribute("href")).toBe("#slide-2");
        expect(shape?.title).toBe("Details");
        expect(shape?.querySelector("path")?.getAttribute("d")).toBe("M 0 0 L 288 0 L 144 192 Z");
    });

    test("never silently substitutes an unsupported shape", () => {
        const presentation = new PuppeteerGen(PAGE);
        const slide = presentation.addSlide();
        expect(() => slide.addShape("cloud", { x: 1, y: 1, w: 2, h: 1 })).toThrow("Unsupported shape geometry: cloud");
        expect(presentation.page.querySelector(".slide-shape")).toBeNull();
    });
});
