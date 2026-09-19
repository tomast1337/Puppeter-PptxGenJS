import { describe, expect, test } from "bun:test";
import { normalizeCustomPath, normalizeShape } from "../src/normalize/shape";
import { PAGE_SIZES } from "../src/pageLayouts";
import { PuppeteerGen } from "../src/PuppeterrGen";
import { GENERATED_PRESET_NAMES } from "../src/normalize/generatedPreset";

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

    test("uses radial angles for noncircular DrawingML arcs", () => {
        // A 45-degree ray meets a 2:1 ellipse at x = y, not at
        // (rx * cos(45), ry * sin(45)). The second arc starts on that ray.
        const path = normalizeCustomPath([
            { x: 2, y: 0 },
            { x: 0, y: 0, curve: { type: "arc", wR: 2, hR: 1, stAng: 0, swAng: 45 } },
            { x: 0, y: 0, curve: { type: "arc", wR: 2, hR: 1, stAng: 45, swAng: 45 } },
        ], PAGE);
        const arcs = [...path.matchAll(/A ([\d. -]+)/g)].map(match => match[1]!.trim().split(/\s+/).map(Number));
        const [x, y] = arcs[0]!.slice(-2) as [number, number];
        expect(x).toBeCloseTo(y, 5);
        expect((x / 192) ** 2 + (y / 96) ** 2).toBeCloseTo(1, 6);
        expect(arcs[1]!.slice(-2)[0]).toBeCloseTo(0, 5);
        expect(arcs[1]!.slice(-2)[1]).toBeCloseTo(96, 5);
    });

    test("requires custom points and rejects unknown presets", () => {
        expect(() => normalizeShape("custGeom", {}, 100, 100, PAGE)).toThrow("requires at least one point");
        expect(() => normalizeShape("definitelyUnknown" as never, {}, 100, 100, PAGE)).toThrow("Unsupported shape geometry: definitelyUnknown");
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

    test("normalizes directional, compound, and callout arrows", () => {
        const right = normalizeShape("rightArrow", {}, 100, 80, PAGE).geometry as { data: string };
        const left = normalizeShape("leftArrow", {}, 100, 80, PAGE).geometry as { data: string };
        expect(right.data).toContain("L 100 40");
        expect(left.data).toContain("M 100 20");
        expect((normalizeShape("quadArrow", {}, 100, 80, PAGE).geometry as { data: string }).data).toContain("L 100 40");
        expect((normalizeShape("stripedRightArrow", {}, 100, 80, PAGE).geometry as { data: string }).data.match(/ Z/g)).toHaveLength(3);
        expect((normalizeShape("rightArrowCallout", {}, 100, 80, PAGE).geometry as { data: string }).data).toContain("L 100 40");
    });

    test("normalizes bent, curved, and swoosh arrow paths", () => {
        expect((normalizeShape("leftUpArrow", {}, 120, 90, PAGE).geometry as { data: string }).data).toContain("L 97.5 0");
        expect((normalizeShape("bentUpArrow", {}, 120, 90, PAGE).geometry as { data: string }).data).toContain("L 97.5 0");
        expect((normalizeShape("bentArrow", {}, 120, 90, PAGE).geometry as { data: string }).data).toContain("A ");
        expect((normalizeShape("uturnArrow", {}, 120, 90, PAGE).geometry as { data: string }).data.match(/A /g)).toHaveLength(4);
        expect((normalizeShape("curvedRightArrow", {}, 120, 90, PAGE).geometry as { data: string }).data.match(/A /g)).toHaveLength(4);
        const curvedUp = normalizeShape("curvedUpArrow", {}, 120, 90, PAGE).geometry as {
            data: string;
            transform?: string;
            faces?: ReadonlyArray<{ data: string; fillModifier?: string }>;
            outlineData?: string;
        };
        expect(curvedUp.data.match(/A /g)).toHaveLength(4);
        expect(curvedUp.faces).toHaveLength(2);
        expect(curvedUp.faces?.[1]?.fillModifier).toBe("darkenLess");
        expect(curvedUp.outlineData).toContain("A ");
        expect(curvedUp.transform).toBe("matrix(0 1 1 0 0 0)");
        expect((normalizeShape("swooshArrow", {}, 120, 90, PAGE).geometry as { data: string }).data.match(/Q /g)).toHaveLength(2);
    });

    test("joins curved-arrow ellipses to both arrowhead shoulders and the fold", () => {
        for (const [width, height] of [[134.4, 201.6], [240, 72], [120, 120], [72, 240]]) {
            const geometry = normalizeShape("curvedRightArrow", {}, width!, height!, PAGE).geometry;
            if (geometry.kind !== "path") throw new Error("Expected arrow path");
            const main = geometry.faces![0]!.data;
            const dark = geometry.faces![1]!.data;
            const endpoints = (data: string) => [...data.matchAll(/A ([\d. -]+)/g)]
                .map(match => match[1]!.trim().split(/\s+/).map(Number).slice(-2) as [number, number]);
            const [shoulder, back] = endpoints(main) as [[number, number], [number, number]];
            const [fold, top] = endpoints(dark) as [[number, number], [number, number]];
            const thickness = Math.min(width!, height!) / 4;
            const radius = height! / 2 - thickness * 3 / 4;
            expect(shoulder[0]).toBeCloseTo(width! - thickness, 5);
            expect(back[0]).toBeCloseTo(0, 5);
            expect(back[1]).toBeCloseTo(radius + thickness, 5);
            // The fold must lie on both translated ellipses.
            for (const centerY of [radius, radius + thickness]) {
                expect(((fold[0] - width!) / width!) ** 2 + ((fold[1] - centerY) / radius) ** 2).toBeCloseTo(1, 5);
            }
            expect(top[0]).toBeCloseTo(width!, 5);
            expect(top[1]).toBeCloseTo(0, 5);
        }
    });

    test("normalizes circular presets and their adjustment options", () => {
        for (const shape of ["arc", "pie", "pieWedge", "chord", "blockArc", "donut"] as const) {
            const geometry = normalizeShape(shape, {}, 160, 100, PAGE).geometry;
            expect(geometry.kind).toBe("path");
            if (geometry.kind === "path") expect(geometry.data).toContain("A ");
        }
        const arc = normalizeShape("arc", { angleRange: [30, 250] }, 160, 100, PAGE).geometry;
        expect(arc.kind === "path" && arc.faces).toHaveLength(1);
        expect(arc.kind === "path" && arc.outlineData).not.toContain("L 80 50");
        const thin = normalizeShape("blockArc", { angleRange: [25, 300], arcThicknessRatio: 0.2 }, 160, 100, PAGE).geometry;
        const thick = normalizeShape("blockArc", { angleRange: [25, 300], arcThicknessRatio: 0.8 }, 160, 100, PAGE).geometry;
        expect(thin.kind === "path" && thin.data).not.toBe(thick.kind === "path" && thick.data);
        expect((normalizeShape("donut", {}, 160, 100, PAGE).geometry as { data: string }).data.match(/M /g)).toHaveLength(2);
    });

    test("normalizes braces and brackets with open visible outlines", () => {
        const names = ["leftBrace", "rightBrace", "bracePair", "leftBracket", "rightBracket", "bracketPair"] as const;
        for (const name of names) {
            const geometry = normalizeShape(name, {}, 120, 180, PAGE).geometry;
            expect(geometry.kind).toBe("path");
            if (geometry.kind !== "path") continue;
            expect(geometry.faces).toHaveLength(1);
            expect(geometry.data.endsWith(" Z")).toBe(true);
            expect(geometry.outlineData?.endsWith(" Z")).toBe(false);
            expect(geometry.outlineData).toContain("A ");
        }
        const bracePair = normalizeShape("bracePair", {}, 160, 100, PAGE).geometry;
        const bracketPair = normalizeShape("bracketPair", {}, 160, 100, PAGE).geometry;
        expect(bracePair.kind === "path" && bracePair.outlineData?.match(/M /g)).toHaveLength(2);
        expect(bracketPair.kind === "path" && bracketPair.outlineData?.match(/M /g)).toHaveLength(2);
    });

    test("normalizes ribbons and scrolls with shaded fold faces", () => {
        const names = [
            "ribbon", "ribbon2", "ellipseRibbon", "ellipseRibbon2", "leftRightRibbon",
            "horizontalScroll", "verticalScroll",
        ] as const;
        for (const name of names) {
            const geometry = normalizeShape(name, {}, 180, 100, PAGE).geometry;
            expect(geometry.kind).toBe("path");
            if (geometry.kind !== "path") continue;
            expect(geometry.faces).toHaveLength(2);
            expect(geometry.faces?.[1]?.fillModifier).toBe("darkenLess");
            expect(geometry.outlineData).toContain("M ");
        }
        const down = normalizeShape("ribbon", {}, 180, 100, PAGE).geometry;
        const up = normalizeShape("ribbon2", {}, 180, 100, PAGE).geometry;
        expect(down.kind === "path" && down.transform).toBeUndefined();
        expect(up.kind === "path" && up.transform).toBe("matrix(1 0 0 -1 0 100)");
        const horizontal = normalizeShape("horizontalScroll", {}, 180, 100, PAGE).geometry;
        expect(horizontal.kind === "path" && horizontal.transform).toBe("matrix(0 1 1 0 0 0)");
    });

    test("normalizes the complete action-button preset family", () => {
        const names = [
            "actionButtonBackPrevious", "actionButtonBeginning", "actionButtonBlank", "actionButtonDocument",
            "actionButtonEnd", "actionButtonForwardNext", "actionButtonHelp", "actionButtonHome",
            "actionButtonInformation", "actionButtonMovie", "actionButtonReturn", "actionButtonSound",
        ] as const;
        for (const name of names) {
            const geometry = normalizeShape(name, {}, 180, 100, PAGE).geometry;
            expect(geometry.kind).toBe("path");
            if (geometry.kind !== "path") continue;
            expect(geometry.faces?.length).toBeGreaterThanOrEqual(1);
            expect(geometry.outlineData).toContain("M 0 0 L 180 0 L 180 100 L 0 100 Z");
        }
        const information = normalizeShape("actionButtonInformation", {}, 160, 100, PAGE).geometry;
        expect(information.kind === "path" && information.faces?.map(face => face.fillModifier))
            .toEqual([undefined, "darken", "lighten"]);
    });

    test("normalizes mathematical and common symbol presets", () => {
        const names = [
            "plus", "mathPlus", "mathMinus", "mathEqual", "mathNotEqual", "mathMultiply", "mathDivide",
            "heart", "lightningBolt", "moon", "sun", "smileyFace", "noSmoking",
        ] as const;
        for (const name of names) {
            const geometry = normalizeShape(name, {}, 180, 100, PAGE).geometry;
            expect(geometry.kind).toBe("path");
            if (geometry.kind === "path") expect(geometry.data).toContain("M ");
        }
        const smiley = normalizeShape("smileyFace", {}, 160, 100, PAGE).geometry;
        expect(smiley.kind === "path" && smiley.faces).toHaveLength(2);
        expect(smiley.kind === "path" && smiley.outlineData).toContain("Q ");
        expect((normalizeShape("mathDivide", {}, 160, 100, PAGE).geometry as { data: string }).data.match(/M /g)).toHaveLength(3);
    });

    test("normalizes every generated ECMA preset without fallback geometry", () => {
        expect(GENERATED_PRESET_NAMES).toHaveLength(52);
        for (const name of GENERATED_PRESET_NAMES) {
            const geometry = normalizeShape(name, {}, 180, 100, PAGE).geometry;
            expect(geometry.kind).toBe("path");
            if (geometry.kind !== "path") continue;
            expect(geometry.data).toContain("M ");
            if (name === "folderCorner") expect(geometry.faces).toHaveLength(0);
            else expect(geometry.faces?.length).toBeGreaterThan(0);
            expect(geometry.outlineData).toContain("M ");
        }
    });

    test("normalizes standard flowchart symbols and their internal marks", () => {
        const names = [
            "flowChartAlternateProcess", "flowChartCollate", "flowChartConnector", "flowChartDecision",
            "flowChartDelay", "flowChartDisplay", "flowChartExtract", "flowChartInputOutput",
            "flowChartInternalStorage", "flowChartManualInput", "flowChartManualOperation", "flowChartMerge",
            "flowChartOffpageConnector", "flowChartOr", "flowChartPredefinedProcess", "flowChartPreparation",
            "flowChartProcess", "flowChartSort", "flowChartSummingJunction", "flowChartTerminator",
            "flowChartDocument", "flowChartMagneticDisk", "flowChartMagneticDrum", "flowChartMagneticTape",
            "flowChartMultidocument", "flowChartOfflineStorage", "flowChartOnlineStorage",
            "flowChartPunchedCard", "flowChartPunchedTape",
        ] as const;
        for (const name of names) expect(() => normalizeShape(name, {}, 160, 100, PAGE)).not.toThrow();
        const storage = normalizeShape("flowChartInternalStorage", {}, 160, 100, PAGE).geometry;
        expect(storage.kind === "path" && storage.faces).toHaveLength(1);
        expect(storage.kind === "path" && storage.outlineData).toContain("M 20 0 L 20 100");
        const summing = normalizeShape("flowChartSummingJunction", {}, 160, 100, PAGE).geometry;
        expect(summing.kind === "path" && summing.outlineData?.match(/ M /g)).toHaveLength(2);
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

    test("renders curved arrows as separately painted faces with one outline", () => {
        const presentation = new PuppeteerGen(PAGE);
        presentation.addSlide().addShape("curvedUpArrow", {
            x: 1, y: 1, w: 2, h: 2,
            fill: { color: "5B9BD5" }, line: { color: "843C0C", width: 1.15 },
        });

        const geometry = presentation.page.querySelector<SVGGElement>(".shape-geometry");
        const faces = geometry?.querySelectorAll<SVGPathElement>(".shape-face");
        expect(faces).toHaveLength(2);
        expect(faces?.[0]?.getAttribute("fill")).toBe("#5B9BD5");
        expect(faces?.[1]?.getAttribute("fill")).toBe("#487caa");
        expect(geometry?.querySelector(".shape-outline")?.getAttribute("stroke")).toBe("#843C0C");
    });

    test("renders arc fill separately from its curved-only outline", () => {
        const presentation = new PuppeteerGen(PAGE);
        presentation.addSlide().addShape("arc", {
            x: 1, y: 1, w: 2, h: 1.5,
            angleRange: [30, 250], fill: { color: "5B9BD5" }, line: { color: "843C0C", width: 2 },
        });
        const geometry = presentation.page.querySelector<SVGGElement>(".shape-geometry");
        expect(geometry?.querySelectorAll(".shape-face")).toHaveLength(1);
        expect(geometry?.querySelector(".shape-face")?.getAttribute("fill")).toBe("#5B9BD5");
        expect(geometry?.querySelector(".shape-outline")?.getAttribute("fill")).toBe("none");
        expect(geometry?.querySelector(".shape-outline")?.getAttribute("d")).not.toContain("L 96 72");
    });

    test("renders flowchart dividers as strokes over one filled face", () => {
        const presentation = new PuppeteerGen(PAGE);
        presentation.addSlide().addShape("flowChartInternalStorage", {
            x: 1, y: 1, w: 2, h: 1.5,
            fill: { color: "5B9BD5" }, line: { color: "843C0C", width: 1 },
        });
        const geometry = presentation.page.querySelector<SVGGElement>(".shape-geometry");
        expect(geometry?.querySelectorAll(".shape-face")).toHaveLength(1);
        expect(geometry?.querySelector(".shape-outline")?.getAttribute("fill")).toBe("none");
        expect(geometry?.querySelector(".shape-outline")?.getAttribute("d")).toContain("M 24 0 L 24 144");
    });

    test("renders brace fill without stroking its closing seam", () => {
        const presentation = new PuppeteerGen(PAGE);
        presentation.addSlide().addShape("leftBrace", {
            x: 1, y: 1, w: 1.25, h: 2,
            fill: { color: "5B9BD5" }, line: { color: "843C0C", width: 1 },
        });
        const geometry = presentation.page.querySelector<SVGGElement>(".shape-geometry");
        expect(geometry?.querySelectorAll(".shape-face")).toHaveLength(1);
        expect(geometry?.querySelector(".shape-face")?.getAttribute("d")?.endsWith(" Z")).toBe(true);
        expect(geometry?.querySelector(".shape-outline")?.getAttribute("d")?.endsWith(" Z")).toBe(false);
        expect(geometry?.querySelector(".shape-outline")?.getAttribute("fill")).toBe("none");
    });

    test("renders ribbon folds as a darker face under one outline", () => {
        const presentation = new PuppeteerGen(PAGE);
        presentation.addSlide().addShape("ellipseRibbon", {
            x: 1, y: 1, w: 2.5, h: 1.4,
            fill: { color: "5B9BD5" }, line: { color: "843C0C", width: 1 },
        });
        const geometry = presentation.page.querySelector<SVGGElement>(".shape-geometry");
        const faces = geometry?.querySelectorAll<SVGPathElement>(".shape-face");
        expect(faces).toHaveLength(2);
        expect(faces?.[0]?.getAttribute("fill")).toBe("#5B9BD5");
        expect(faces?.[1]?.getAttribute("fill")).toBe("#487caa");
        expect(geometry?.querySelectorAll(".shape-outline")).toHaveLength(1);
    });

    test("renders action-button darken and lighten icon layers", () => {
        const presentation = new PuppeteerGen(PAGE);
        presentation.addSlide().addShape("actionButtonInformation", {
            x: 1, y: 1, w: 2, h: 1.25,
            fill: { color: "5B9BD5" }, line: { color: "843C0C", width: 1 },
        });
        const faces = presentation.page.querySelectorAll<SVGPathElement>(".shape-face");
        expect(faces).toHaveLength(3);
        expect(faces[0]?.getAttribute("fill")).toBe("#5B9BD5");
        expect(faces[1]?.getAttribute("fill")).toBe("#365d7f");
        expect(faces[2]?.getAttribute("fill")).toBe("#bdd7ee");
    });

    test("renders smiley details as shaded eyes and an unfilled mouth", () => {
        const presentation = new PuppeteerGen(PAGE);
        presentation.addSlide().addShape("smileyFace", {
            x: 1, y: 1, w: 1.5, h: 1.5,
            fill: { color: "5B9BD5" }, line: { color: "843C0C", width: 1 },
        });
        const geometry = presentation.page.querySelector<SVGGElement>(".shape-geometry");
        expect(geometry?.querySelectorAll(".shape-face")).toHaveLength(2);
        expect(geometry?.querySelectorAll(".shape-outline")).toHaveLength(1);
        expect(geometry?.querySelector(".shape-outline")?.getAttribute("fill")).toBe("none");
        expect(geometry?.querySelector(".shape-outline")?.getAttribute("d")).toContain("Q ");
    });

    test("never silently substitutes an unknown shape", () => {
        const presentation = new PuppeteerGen(PAGE);
        const slide = presentation.addSlide();
        expect(() => slide.addShape("definitelyUnknown" as never, { x: 1, y: 1, w: 2, h: 1 })).toThrow("Unsupported shape geometry: definitelyUnknown");
        expect(presentation.page.querySelector(".slide-shape")).toBeNull();
    });
});
