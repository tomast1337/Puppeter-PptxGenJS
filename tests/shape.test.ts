import { describe, expect, test } from "bun:test";
import type PptxGenJS from "pptxgenjs";
import pptxgen from "pptxgenjs";
import { PPTX_DEFAULTS } from "../packages/pptxgenjs/src/defaults";
import { renderedPage } from "./renderedPage";
import { GENERATED_PRESET_NAMES } from "../packages/pptxgenjs/src/normalize/generatedPreset";
import { CORE_SVG_SHAPES, normalizeShape } from "../packages/pptxgenjs/src/normalize/shape";
import { normalizeCustomPath } from "../packages/pptxgenjs/src/normalize/shape/custom";
import { normalizeShapeLine } from "../packages/pptxgenjs/src/normalize/shape/line";
import { arrowHeadPath, normalizeLine } from "../packages/pptxgenjs/src/normalize/style";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { PAGE_SIZES } from "../packages/pptxgenjs/src/pageLayouts";
import { renderShapeSvg } from "../packages/pptxgenjs/src/render/shape";
import { UnsupportedFeatureError } from "../packages/pptxgenjs/src/UnsupportedFeatureError";

const PAGE = PAGE_SIZES.SCREEN_16X9.landscape;

describe("shape normalization", () => {
    test("honors deprecated line aliases without requiring a line object", () => {
        const line = normalizeShapeLine(
            {
                lineSize: 2,
                lineDash: "dash",
                lineHead: "triangle",
                lineTail: "oval",
            },
            normalizeLine,
        );
        expect(line.visible).toBe(true);
        expect(line.color).toBe("#333333");
        expect(line.width).toBe((2 * 96) / 72);
        expect(line.style).toBe("dashed");
        expect(line.beginArrow).toBe("triangle");
        expect(line.endArrow).toBe("oval");
    });

    // PptxGenJS 4.0.1 addTextDefinition reads a string `line` and lineSize/lineDash/lineHead/lineTail only
    // for shape "line"; other text writes <a:ln> from the line object, without `w` when it has no width.
    test("applies addText's deprecated line options only to shape line, as PptxGenJS does", () => {
        const deprecated = { lineSize: 4, lineDash: "dash", lineHead: "triangle", lineTail: "oval" } as const;
        const lineOf = (options: PptxGenJS.TextPropsOptions) => {
            const presentation = new PuppeteerGen();
            presentation.addSlide().addText("Text", { x: 1, y: 1, w: 2, h: 1, ...options });
            const object = presentation.getModel().slides[0]?.objects[0];
            return object?.style.line;
        };
        const ptToPx = (pt: number) => (pt * 96) / 72;

        expect(lineOf({ shape: "line", line: { color: "FF0000" }, ...deprecated })).toMatchObject({ visible: true, color: "#FF0000", width: ptToPx(4), style: "dashed", beginArrow: "triangle", endArrow: "oval" });
        expect(lineOf({ shape: "line", line: "00FF00" as unknown as PptxGenJS.ShapeLineProps })).toMatchObject({ visible: true, color: "#00FF00", width: ptToPx(1) });

        for (const shape of [undefined, "rect", "roundRect"] as const) {
            expect(lineOf({ shape, line: { color: "FF0000", width: 2 }, ...deprecated })).toMatchObject({ visible: true, color: "#FF0000", width: ptToPx(2), style: "solid", beginArrow: "none", endArrow: "none" });
            expect(lineOf({ shape, line: { color: "FF0000" } })).toMatchObject({ visible: true, width: ptToPx(PPTX_DEFAULTS.text.hairlineWidthPt) });
            expect(lineOf({ shape, line: { color: "FF0000", width: 0 } })).toMatchObject({ visible: true, width: ptToPx(PPTX_DEFAULTS.text.hairlineWidthPt) });
            expect(lineOf({ shape, line: "FF0000" as unknown as PptxGenJS.ShapeLineProps, ...deprecated })).toMatchObject({ visible: false });
            expect(lineOf({ shape, ...deprecated })).toMatchObject({ visible: false });
        }
    });

    // ECMA-376 presetShapeDefinitions <rect>: the text body's rectangle, evaluated with the shape's guides.
    test("insets text to the preset's text rectangle", () => {
        const insets = (name: string, options: PptxGenJS.ShapeProps, width: number, height: number) => normalizeShape(name as PptxGenJS.SHAPE_NAME, options, width, height, PAGE).textInsets?.map(value => Number(value.toFixed(3)));
        expect(insets("rect", {}, 100, 80)).toBeUndefined();
        expect(insets("ellipse", {}, 100, 80)).toEqual([11.716, 14.645, 11.716, 14.645]);
        // roundRect: il = x1 * 29289 / 100000, x1 the corner (1/6 of the shorter side, or rectRadius in inches).
        expect(insets("roundRect", {}, 192, 96)).toEqual([4.686, 4.686, 4.686, 4.686]);
        expect(insets("roundRect", { rectRadius: 0.25 }, 192, 96)).toEqual([7.029, 7.029, 7.029, 7.029]);
        expect(insets("diamond", {}, 100, 80)).toEqual([20, 25, 20, 25]);
    });

    test("normalizes core preset geometry and rounded radius", () => {
        expect(normalizeShape("rect", {}, 192, 96, PAGE).geometry).toEqual({ kind: "rect", radius: 0 });
        expect(normalizeShape("roundRect", {}, 192, 96, PAGE).geometry).toEqual({ kind: "rect", radius: 16 });
        expect(normalizeShape("roundRect", { rectRadius: 0.1 }, 192, 96, PAGE).geometry).toEqual({ kind: "rect", radius: 9.600000000000001 });
        // PptxGenJS writes no `adj` for rectRadius 0, so the preset's 1/6 corner stays.
        expect(normalizeShape("roundRect", { rectRadius: 0 }, 192, 96, PAGE).geometry).toEqual({ kind: "rect", radius: 16 });
        expect(normalizeShape("ellipse", {}, 192, 96, PAGE).geometry).toEqual({ kind: "ellipse" });
        expect(normalizeShape("lineInv", {}, 192, 96, PAGE).geometry).toEqual({ kind: "line", inverse: true });
    });

    test("normalizes custom lines and bezier curves in local SVG coordinates", () => {
        const path = normalizeCustomPath([{ x: 0, y: 0 }, { x: 1, y: 0.5 }, { x: 2, y: 1, curve: { type: "quadratic", x1: 1.5, y1: 0 } }, { x: 3, y: 1, curve: { type: "cubic", x1: 2.25, y1: 1.5, x2: 2.75, y2: 0.5 } }, { close: true }], PAGE);
        expect(path).toBe("M 0 0 L 96 48 Q 144 0 192 96 C 216 144 264 48 288 96 Z");
    });

    test("converts DrawingML arc commands to SVG endpoint arcs", () => {
        expect(
            normalizeCustomPath(
                [
                    { x: 1, y: 0.5 },
                    { x: 0, y: 0, curve: { type: "arc", wR: 1, hR: 0.5, stAng: 0, swAng: 90 } },
                ],
                PAGE,
            ),
        ).toBe("M 96 48 A 96 48 0 0 1 0 96");
    });

    test("uses radial angles for noncircular DrawingML arcs", () => {
        // A 45-degree ray meets a 2:1 ellipse at x = y, not at
        // (rx * cos(45), ry * sin(45)). The second arc starts on that ray.
        const path = normalizeCustomPath(
            [
                { x: 2, y: 0 },
                { x: 0, y: 0, curve: { type: "arc", wR: 2, hR: 1, stAng: 0, swAng: 45 } },
                { x: 0, y: 0, curve: { type: "arc", wR: 2, hR: 1, stAng: 45, swAng: 45 } },
            ],
            PAGE,
        );
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
        // The geometry table is keyed by preset name; Object.prototype names must not reach a lookup.
        for (const name of ["constructor", "toString", "__proto__"]) expect(() => normalizeShape(name as never, {}, 100, 100, PAGE)).toThrow(`Unsupported shape geometry: ${name}`);
    });

    // Every name the API accepts (SHAPE_TYPE, SHAPE_GEOMETRY_COMPATIBILITY) draws something: no undefined path data.
    test("draws a non-empty geometry for every supported preset", () => {
        const options: PptxGenJS.ShapeProps = { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { close: true }] };
        expect(CORE_SVG_SHAPES.length).toBe(new Set(CORE_SVG_SHAPES).size);
        // Every name PptxGenJS 4.0.1 can write, hand-drawn or generated, and nothing else.
        expect([...CORE_SVG_SHAPES].sort()).toEqual(Object.values(new pptxgen().ShapeType).sort());
        for (const name of CORE_SVG_SHAPES) {
            const { geometry } = normalizeShape(name as PptxGenJS.SHAPE_NAME, options, 200, 100, PAGE);
            if (geometry.kind === "path") expect(geometry.data, name).toMatch(/^M /);
            else expect(["rect", "ellipse", "line"], name).toContain(geometry.kind);
        }
    });

    test("normalizes polygon and star preset families", () => {
        // Paths start where presetShapeDefinitions.xml starts them.
        expect((normalizeShape("triangle", {}, 100, 80, PAGE).geometry as { data: string }).data).toBe("M 0 80 L 50 0 L 100 80 Z");
        expect((normalizeShape("diamond", {}, 100, 80, PAGE).geometry as { data: string }).data).toBe("M 0 40 L 50 0 L 100 40 L 50 80 Z");
        const hexagon = normalizeShape("hexagon", {}, 100, 80, PAGE);
        // The spec's hexagon derives its corners from the short side and a vertical factor (vf), so they sit a hair off y = 0.
        expect((hexagon.geometry as { data: string }).data).toBe("M 0 40 L 20 0.000019 L 80 0.000019 L 100 40 L 80 79.999981 L 20 79.999981 Z");
        // The hexagon's ECMA-376 text rectangle (il, it, ir, ib), not the box minus its points.
        expect(hexagon.textInsets).toEqual([12, 15, 12, 15]);
        expect((normalizeShape("star5", {}, 100, 80, PAGE).geometry as { data: string }).data.match(/ L /g)).toHaveLength(9);
    });

    test("normalizes directional, compound, and callout arrows", () => {
        const right = normalizeShape("rightArrow", {}, 100, 80, PAGE).geometry as { data: string };
        const left = normalizeShape("leftArrow", {}, 100, 80, PAGE).geometry as { data: string };
        expect(right.data).toContain("L 100 40");
        // The left arrow starts at its tip, the left edge's midpoint (presetShapeDefinitions.xml leftArrow).
        expect(left.data).toMatch(/^M 0 40 /);
        expect((normalizeShape("quadArrow", {}, 100, 80, PAGE).geometry as { data: string }).data).toContain("L 100 40");
        expect((normalizeShape("stripedRightArrow", {}, 100, 80, PAGE).geometry as { data: string }).data.match(/ Z/g)).toHaveLength(3);
        expect((normalizeShape("rightArrowCallout", {}, 100, 80, PAGE).geometry as { data: string }).data).toContain("L 100 40");
    });

    test("normalizes bent, curved, and swoosh arrow paths", () => {
        expect((normalizeShape("leftUpArrow", {}, 120, 90, PAGE).geometry as { data: string }).data).toContain("L 97.5 0");
        expect((normalizeShape("bentUpArrow", {}, 120, 90, PAGE).geometry as { data: string }).data).toContain("L 97.5 0");
        expect((normalizeShape("bentArrow", {}, 120, 90, PAGE).geometry as { data: string }).data).toContain("A ");
        expect((normalizeShape("uturnArrow", {}, 120, 90, PAGE).geometry as { data: string }).data.match(/A /g)).toHaveLength(4);
        // Two faces of two arcs each (presetShapeDefinitions.xml curvedRightArrow); `data` also carries the unfilled outline path.
        expect((normalizeShape("curvedRightArrow", {}, 120, 90, PAGE).geometry as { faces: ReadonlyArray<{ data: string }> }).faces.map(face => face.data.match(/A /g)?.length)).toEqual([2, 2]);
        const curvedUp = normalizeShape("curvedUpArrow", {}, 120, 90, PAGE).geometry as {
            data: string;
            faces?: ReadonlyArray<{ data: string; fillModifier?: string }>;
            outlineData?: string;
        };
        // Drawn from its own guides (the head at the top), not as a transformed curvedRightArrow.
        expect(curvedUp.data).toMatch(/^M 97.5 0 /);
        expect(curvedUp.faces?.map(face => face.data.match(/A /g)?.length)).toEqual([2, 2]);
        expect(curvedUp.faces).toHaveLength(2);
        expect(curvedUp.faces?.[1]?.fillModifier).toBe("darkenLess");
        expect(curvedUp.outlineData).toContain("A ");
        expect((normalizeShape("swooshArrow", {}, 120, 90, PAGE).geometry as { data: string }).data.match(/Q /g)).toHaveLength(2);
    });

    test("joins curved-arrow ellipses to both arrowhead shoulders and the fold", () => {
        for (const [width, height] of [
            [134.4, 201.6],
            [240, 72],
            [120, 120],
            [72, 240],
        ]) {
            const geometry = normalizeShape("curvedRightArrow", {}, width!, height!, PAGE).geometry;
            if (geometry.kind !== "path") throw new Error("Expected arrow path");
            const main = geometry.faces![0]!.data;
            const dark = geometry.faces![1]!.data;
            const endpoints = (data: string) => [...data.matchAll(/A ([\d. -]+)/g)].map(match => match[1]!.trim().split(/\s+/).map(Number).slice(-2) as [number, number]);
            const [shoulder, back] = endpoints(main) as [[number, number], [number, number]];
            const [fold, top] = endpoints(dark) as [[number, number], [number, number]];
            const thickness = Math.min(width!, height!) / 4;
            const radius = height! / 2 - (thickness * 3) / 4;
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
            expect(geometry.faces?.[0]?.data.endsWith(" Z")).toBe(true);
            expect(geometry.outlineData?.endsWith(" Z")).toBe(false);
            expect(geometry.outlineData).toContain("A ");
        }
        const bracePair = normalizeShape("bracePair", {}, 160, 100, PAGE).geometry;
        const bracketPair = normalizeShape("bracketPair", {}, 160, 100, PAGE).geometry;
        expect(bracePair.kind === "path" && bracePair.outlineData?.match(/M /g)).toHaveLength(2);
        expect(bracketPair.kind === "path" && bracketPair.outlineData?.match(/M /g)).toHaveLength(2);
    });

    test("normalizes ribbons and scrolls with shaded fold faces", () => {
        const names = ["ribbon", "ribbon2", "ellipseRibbon", "ellipseRibbon2", "leftRightRibbon", "horizontalScroll", "verticalScroll"] as const;
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
        // ribbon2 and horizontalScroll are drawn from their own ECMA-376 guides, not as a transformed sibling.
        expect(down.kind === "path" && down.transform).toBeUndefined();
        expect(up.kind === "path" && up.transform).toBeUndefined();
        if (up.kind === "path" && down.kind === "path") expect(up.data).not.toBe(down.data);
        const horizontal = normalizeShape("horizontalScroll", {}, 180, 100, PAGE).geometry;
        expect(horizontal.kind === "path" && horizontal.transform).toBeUndefined();
    });

    test("normalizes the complete action-button preset family", () => {
        const names = ["actionButtonBackPrevious", "actionButtonBeginning", "actionButtonBlank", "actionButtonDocument", "actionButtonEnd", "actionButtonForwardNext", "actionButtonHelp", "actionButtonHome", "actionButtonInformation", "actionButtonMovie", "actionButtonReturn", "actionButtonSound"] as const;
        for (const name of names) {
            const geometry = normalizeShape(name, {}, 180, 100, PAGE).geometry;
            expect(geometry.kind).toBe("path");
            if (geometry.kind !== "path") continue;
            expect(geometry.faces?.length).toBeGreaterThanOrEqual(1);
            expect(geometry.outlineData).toContain("M 0 0 L 180 0 L 180 100 L 0 100 Z");
        }
        const information = normalizeShape("actionButtonInformation", {}, 160, 100, PAGE).geometry;
        expect(information.kind === "path" && information.faces?.map(face => face.fillModifier)).toEqual([undefined, "darken", "lighten"]);
    });

    test("normalizes mathematical and common symbol presets", () => {
        const names = ["plus", "mathPlus", "mathMinus", "mathEqual", "mathNotEqual", "mathMultiply", "mathDivide", "heart", "lightningBolt", "moon", "sun", "smileyFace", "noSmoking"] as const;
        for (const name of names) {
            const geometry = normalizeShape(name, {}, 180, 100, PAGE).geometry;
            expect(geometry.kind).toBe("path");
            if (geometry.kind === "path") expect(geometry.data).toContain("M ");
        }
        const smiley = normalizeShape("smileyFace", {}, 160, 100, PAGE).geometry;
        expect(smiley.kind === "path" && smiley.faces).toHaveLength(2);
        expect(smiley.kind === "path" && smiley.outlineData).toContain("Q ");
        if (smiley.kind === "path") {
            const eyeMoves = [...(smiley.faces?.[1]?.data ?? "").matchAll(/M ([\d.]+) /g)].map(match => Number(match[1]));
            const eyeRadius = (160 * 1125) / 21600;
            expect(eyeMoves).toHaveLength(2);
            expect(((eyeMoves[0] ?? 0) + eyeRadius + (eyeMoves[1] ?? 0) + eyeRadius) / 2).toBeCloseTo(80, 6);
        }
        expect((normalizeShape("mathDivide", {}, 160, 100, PAGE).geometry as { data: string }).data.match(/M /g)).toHaveLength(3);
    });

    test("draws leftRightUpArrow and star4 from their ECMA-376 guides (issue #42)", () => {
        // The bar sits on the bottom edge with no stem below it (hand-written geometry mirrored quadArrow).
        expect((normalizeShape("leftRightUpArrow", {}, 100, 80, PAGE).geometry as { data: string }).data).toBe("M 0 60 L 20 40 L 20 50 L 40 50 L 40 20 L 30 20 L 50 0 L 70 20 L 60 20 L 60 50 L 80 50 L 80 40 L 100 60 L 80 80 L 80 70 L 20 70 L 20 80 Z");
        // adj 12500: inner vertices at (wd2, hd2) * 0.25 * cos 45 from the centre, not 0.18 of the radius.
        expect((normalizeShape("star4", {}, 100, 80, PAGE).geometry as { data: string }).data).toBe("M 0 40 L 41.161165 32.928932 L 50 0 L 58.838835 32.928932 L 100 40 L 58.838835 47.071068 L 50 80 L 41.161165 47.071068 Z");
    });

    test("normalizes every generated ECMA preset without fallback geometry", () => {
        expect(GENERATED_PRESET_NAMES).toHaveLength(166);
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
            "flowChartAlternateProcess",
            "flowChartCollate",
            "flowChartConnector",
            "flowChartDecision",
            "flowChartDelay",
            "flowChartDisplay",
            "flowChartExtract",
            "flowChartInputOutput",
            "flowChartInternalStorage",
            "flowChartManualInput",
            "flowChartManualOperation",
            "flowChartMerge",
            "flowChartOffpageConnector",
            "flowChartOr",
            "flowChartPredefinedProcess",
            "flowChartPreparation",
            "flowChartProcess",
            "flowChartSort",
            "flowChartSummingJunction",
            "flowChartTerminator",
            "flowChartDocument",
            "flowChartMagneticDisk",
            "flowChartMagneticDrum",
            "flowChartMagneticTape",
            "flowChartMultidocument",
            "flowChartOfflineStorage",
            "flowChartOnlineStorage",
            "flowChartPunchedCard",
            "flowChartPunchedTape",
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
    test("writes each face's shaded fill, which the renderers draw as it is", () => {
        const presentation = new PuppeteerGen(PAGE);
        presentation.addSlide().addShape("can", { x: 1, y: 1, w: 2, h: 1, fill: { color: "64C832", transparency: 50 } });
        const object = presentation.getModel().slides[0]?.objects[0];
        if (object?.kind !== "shape") throw new Error("expected the can shape");
        const modifiers = [undefined, "lighten", "lightenLess", "darken", "darkenLess"] as const;
        const shape = { ...object.shape, geometry: { kind: "path" as const, data: "", faces: modifiers.map(fillModifier => ({ data: "M 0 0 Z", fillModifier })) } };
        const fills = Array.from(renderShapeSvg(shape, object.style).matchAll(/class="shape-face"[^>]*? fill="([^"]*)"/g), match => match[1]);
        // PPTX_DEFAULTS.shape.faceShading ([MS-OI29500]): blended with 40% or 50/255 white or black, floored.
        expect(fills).toEqual(["rgba(100, 200, 50, 0.5)", "rgba(162, 222, 132, 0.5)", "rgba(130, 210, 90, 0.5)", "rgba(60, 120, 30, 0.5)", "rgba(80, 160, 40, 0.5)"]);
    });

    test("shades the can's lid as Office does: D9E2F3 blended with 40% white", () => {
        const presentation = new PuppeteerGen(PAGE);
        presentation.addSlide().addShape("can", { x: 1, y: 1, w: 2, h: 1, fill: { color: "D9E2F3" } });
        const object = presentation.getModel().slides[0]?.objects[0];
        if (object?.kind !== "shape") throw new Error("expected the can shape");
        // LibreOffice 26.2 paints the lid #E8EDF7 too: 217 + 38 * 0.4 = 232.2, 226 + 29 * 0.4 = 237.6, 243 + 12 * 0.4 = 247.8.
        expect(renderShapeSvg(object.shape, object.style)).toContain('data-fill-modifier="lighten" stroke="none" fill="#e8edf7"');
    });

    test("renders rectangles, ellipses, and zero-height arrow lines as SVG", () => {
        const presentation = new PuppeteerGen(PAGE);
        const slide = presentation.addSlide();
        slide.addShape("roundRect", {
            x: 1,
            y: 1,
            w: 2,
            h: 1,
            rectRadius: 0.1,
            fill: { color: "4472C4" },
            line: { color: "17365D", width: 2, dashType: "dash" },
        });
        slide.addShape("ellipse", { x: 4, y: 1, w: 2, h: 1, fill: { color: "70AD47" } });
        slide.addShape("line", {
            x: 1,
            y: 3,
            w: 4,
            h: 0,
            line: { color: "ED7D31", width: 2, beginArrowType: "oval", endArrowType: "triangle" },
        });
        slide.addShape("line", { x: 1, y: 4, w: 4, h: 0, line: { color: "ED7D31", width: 2.25, dashType: "dash", beginArrowType: "oval" } });

        const shapes = renderedPage(presentation).querySelectorAll<HTMLElement>(".slide-shape");
        expect(shapes[0]?.querySelector("rect")?.getAttribute("rx")).toBe("9.600000000000001");
        expect(shapes[0]?.querySelector(".shape-geometry")?.getAttribute("stroke-dasharray")).toBe(`${(4 * 2 * 96) / 72} ${(3 * 2 * 96) / 72}`);
        expect(shapes[1]?.querySelector("ellipse")).not.toBeNull();
        expect(shapes[2]?.querySelector("svg")?.getAttribute("height")).toBe("1");
        expect(shapes[2]?.querySelector("svg")?.getAttribute("viewBox")).toBe(`0 0 ${4 * 96} 1`);
        // Markers draw the model's head outlines in user space; orient reverses the begin head.
        const marker = (end: "start" | "end") => renderedPage(presentation).getElementById(shapes[2]?.querySelector(".shape-geometry")?.getAttribute(`marker-${end}`)?.slice(5, -1) ?? "");
        expect(marker("end")?.getAttribute("markerUnits")).toBe("userSpaceOnUse");
        expect(marker("end")?.getAttribute("orient")).toBe("auto-start-reverse");
        expect(marker("end")?.querySelector("path")?.getAttribute("d")).toBe(String(arrowHeadPath("triangle", (2 * 96) / 72)));
        expect(marker("start")?.querySelector("path")?.getAttribute("d")).toBe(String(arrowHeadPath("oval", (2 * 96) / 72)));
        // Ids come from the outline, not the object name, which repeats across slides: url(#id) takes the first match.
        const objectName = shapes[2]?.dataset.objectName;
        presentation.addSlide().addShape("line", { x: 1, y: 3, w: 4, h: 0, objectName, line: { color: "ED7D31", width: 2, endArrowType: "diamond" } });
        const repeated = renderedPage(presentation).querySelectorAll<HTMLElement>(".slide-shape")[4];
        expect(repeated?.dataset.objectName).toBe(String(objectName));
        const repeatedEnd = repeated?.querySelector(".shape-geometry")?.getAttribute("marker-end")?.slice(5, -1) ?? "";
        expect(renderedPage(presentation).getElementById(repeatedEnd)?.querySelector("path")?.getAttribute("d")).toBe(String(arrowHeadPath("diamond", (2 * 96) / 72)));
        // The model's gap-first pattern "0 3.9 12 9 ..." is written verbatim; the Puppeteer print step redraws it.
        const dashed = shapes[3]?.querySelector(".shape-geometry");
        expect(dashed?.getAttribute("stroke-dasharray")).toBe(presentation.getModel().slides[0]?.objects[3]?.style.line?.dashArray ?? "");
        expect(dashed?.hasAttribute("stroke-dashoffset")).toBe(false);
    });

    // PptxGenJS 4.0.1 writes <a:innerShdw> closed by </a:outerShdw>, which LibreOffice drops, and no renderer draws an
    // inner shadow on a shape: the call that adds it fails, not the print step. A text box keeps its inner shadow.
    test("an inner shadow on a shape throws where the shape is added", () => {
        const slide = new PuppeteerGen(PAGE).addSlide();
        expect(() => slide.addShape("ellipse", { x: 1, y: 1, w: 1, h: 1, shadow: { type: "inner", color: "000000", blur: 3, offset: 2, angle: 45 } })).toThrow(UnsupportedFeatureError);
        expect(() => slide.addShape("ellipse", { x: 1, y: 1, w: 1, h: 1, shadow: { type: "inner", color: "000000", blur: 3, offset: 2, angle: 45 } })).toThrow('shadow: { type: "inner" } on shape "ellipse" is not supported by PuppeteerGen yet.');
        expect(() => slide.addText("Inset", { x: 1, y: 1, w: 2, h: 1, shape: "roundRect" as PptxGenJS.SHAPE_NAME, shadow: { type: "inner", color: "000000", blur: 3, offset: 2, angle: 45 } })).toThrow('Use shadow type "outer"');
        expect(() => normalizeShape("rect", { shadow: { type: "inner", color: "000000", blur: 3, offset: 2, angle: 45 } }, 96, 96, PAGE)).toThrow(UnsupportedFeatureError);
        slide.addText("Inset", { x: 1, y: 1, w: 2, h: 1, shadow: { type: "inner", color: "000000", blur: 3, offset: 2, angle: 45 } });
    });

    test("writes the line, shadow and size values the drawing only shows resolved as data attributes", () => {
        const presentation = new PuppeteerGen(PAGE);
        const slide = presentation.addSlide();
        slide.addShape("line", { x: 1, y: 3, w: 4, h: 0, line: { color: "ED7D31", width: 2, dashType: "sysDot", beginArrowType: "oval", endArrowType: "triangle" } });
        slide.addShape("rect", { x: 1, y: 1, w: 2, h: 1, fill: { color: "4472C4" }, shadow: { type: "outer", color: "000000", blur: 3, offset: 2, angle: 45 } });
        slide.addText("boxed", { x: 4, y: 1, w: 2, h: 1, line: { color: "000000", width: 1, dashType: "dash" } });

        const page = renderedPage(presentation);
        const [line, rect] = Array.from(page.querySelectorAll<SVGSVGElement>("svg.shape-svg"));
        const normalized = presentation.getModel().slides[0]?.objects[0]?.style.line;
        // SVG states the dash pattern itself, so the svg has no data-line-dash-array.
        expect(line?.querySelector(".shape-geometry")?.getAttribute("stroke-dasharray")).toBe(normalized?.dashArray ?? "");
        expect(line?.hasAttribute("data-line-dash-array")).toBe(false);
        expect(line?.getAttribute("data-line-begin-arrow")).toBe("oval");
        expect(line?.getAttribute("data-line-end-arrow")).toBe("triangle");
        expect(line?.getAttribute("data-shape-height")).toBe("0");
        expect(line?.hasAttribute("data-shape-width")).toBe(false);
        // drop-shadow() says an outer shadow itself; an inner one never reaches the HTML from the API (see below).
        expect(rect?.hasAttribute("data-shadow-inset")).toBe(false);
        expect(rect?.hasAttribute("data-line-dash-array")).toBe(false);
        // A CSS border has no dash pattern, so the box keeps it.
        expect(page.querySelector(".slide-text")?.getAttribute("data-line-dash-array")).toBe(presentation.getModel().slides[0]?.objects[2]?.style.line?.dashArray ?? "");
    });

    test("leaves the print snap to the Puppeteer print step and lays the SVG out as a block", () => {
        const presentation = new PuppeteerGen(PAGE);
        presentation.addSlide().addShape("line", { x: 6.55, y: 1.6, w: 2.6, h: 0, line: { color: "4472C4", width: 2.25 } });
        const page = renderedPage(presentation);
        expect(page.querySelector(".shape-svg")?.getAttribute("style")).toBe("overflow: visible;");
        // The document has a doctype (standards mode): an inline SVG would sit on the line box's baseline.
        expect(page.querySelector("style")?.textContent).toMatch(/\.slide-shape > \.shape-svg \{\s*display: block;/);
    });

    test("renders custom paths and shape hyperlinks", () => {
        const presentation = new PuppeteerGen(PAGE);
        const slide = presentation.addSlide();
        slide.addShape("custGeom" as never, {
            x: 1,
            y: 1,
            w: 3,
            h: 2,
            points: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 1.5, y: 2 }, { close: true }],
            fill: { color: "FFC000" },
            hyperlink: { slide: 2, tooltip: "Details" },
        });

        const shape = renderedPage(presentation).querySelector<HTMLAnchorElement>("a.slide-shape");
        expect(shape?.getAttribute("href")).toBe("#slide-2");
        expect(shape?.title).toBe("Details");
        expect(shape?.querySelector("path")?.getAttribute("d")).toBe("M 0 0 L 288 0 L 144 192 Z");
    });

    test("renders curved arrows as separately painted faces with one outline", () => {
        const presentation = new PuppeteerGen(PAGE);
        presentation.addSlide().addShape("curvedUpArrow", {
            x: 1,
            y: 1,
            w: 2,
            h: 2,
            fill: { color: "5B9BD5" },
            line: { color: "843C0C", width: 1.15 },
        });

        const geometry = renderedPage(presentation).querySelector<SVGGElement>(".shape-geometry");
        const faces = geometry?.querySelectorAll<SVGPathElement>(".shape-face");
        expect(faces).toHaveLength(2);
        expect(faces?.[0]?.getAttribute("fill")).toBe("#5B9BD5");
        expect(faces?.[1]?.getAttribute("fill")).toBe("#497cab");
        expect(geometry?.querySelector(".shape-outline")?.getAttribute("stroke")).toBe("#843C0C");
    });

    test("renders arc fill separately from its curved-only outline", () => {
        const presentation = new PuppeteerGen(PAGE);
        presentation.addSlide().addShape("arc", {
            x: 1,
            y: 1,
            w: 2,
            h: 1.5,
            angleRange: [30, 250],
            fill: { color: "5B9BD5" },
            line: { color: "843C0C", width: 2 },
        });
        const geometry = renderedPage(presentation).querySelector<SVGGElement>(".shape-geometry");
        expect(geometry?.querySelectorAll(".shape-face")).toHaveLength(1);
        expect(geometry?.querySelector(".shape-face")?.getAttribute("fill")).toBe("#5B9BD5");
        expect(geometry?.querySelector(".shape-outline")?.getAttribute("fill")).toBe("none");
        expect(geometry?.querySelector(".shape-outline")?.getAttribute("d")).not.toContain("L 96 72");
    });

    test("renders flowchart dividers as strokes over one filled face", () => {
        const presentation = new PuppeteerGen(PAGE);
        presentation.addSlide().addShape("flowChartInternalStorage", {
            x: 1,
            y: 1,
            w: 2,
            h: 1.5,
            fill: { color: "5B9BD5" },
            line: { color: "843C0C", width: 1 },
        });
        const geometry = renderedPage(presentation).querySelector<SVGGElement>(".shape-geometry");
        expect(geometry?.querySelectorAll(".shape-face")).toHaveLength(1);
        expect(geometry?.querySelector(".shape-outline")?.getAttribute("fill")).toBe("none");
        expect(geometry?.querySelector(".shape-outline")?.getAttribute("d")).toContain("M 24 0 L 24 144");
    });

    test("renders brace fill without stroking its closing seam", () => {
        const presentation = new PuppeteerGen(PAGE);
        presentation.addSlide().addShape("leftBrace", {
            x: 1,
            y: 1,
            w: 1.25,
            h: 2,
            fill: { color: "5B9BD5" },
            line: { color: "843C0C", width: 1 },
        });
        const geometry = renderedPage(presentation).querySelector<SVGGElement>(".shape-geometry");
        expect(geometry?.querySelectorAll(".shape-face")).toHaveLength(1);
        expect(geometry?.querySelector(".shape-face")?.getAttribute("d")?.endsWith(" Z")).toBe(true);
        expect(geometry?.querySelector(".shape-outline")?.getAttribute("d")?.endsWith(" Z")).toBe(false);
        expect(geometry?.querySelector(".shape-outline")?.getAttribute("fill")).toBe("none");
    });

    test("renders ribbon folds as a darker face under one outline", () => {
        const presentation = new PuppeteerGen(PAGE);
        presentation.addSlide().addShape("ellipseRibbon", {
            x: 1,
            y: 1,
            w: 2.5,
            h: 1.4,
            fill: { color: "5B9BD5" },
            line: { color: "843C0C", width: 1 },
        });
        const geometry = renderedPage(presentation).querySelector<SVGGElement>(".shape-geometry");
        const faces = geometry?.querySelectorAll<SVGPathElement>(".shape-face");
        expect(faces).toHaveLength(2);
        expect(faces?.[0]?.getAttribute("fill")).toBe("#5B9BD5");
        expect(faces?.[1]?.getAttribute("fill")).toBe("#497cab");
        expect(geometry?.querySelectorAll(".shape-outline")).toHaveLength(1);
    });

    test("renders action-button darken and lighten icon layers", () => {
        const presentation = new PuppeteerGen(PAGE);
        presentation.addSlide().addShape("actionButtonInformation", {
            x: 1,
            y: 1,
            w: 2,
            h: 1.25,
            fill: { color: "5B9BD5" },
            line: { color: "843C0C", width: 1 },
        });
        const faces = renderedPage(presentation).querySelectorAll<SVGPathElement>(".shape-face");
        expect(faces).toHaveLength(3);
        expect(faces[0]?.getAttribute("fill")).toBe("#5B9BD5");
        expect(faces[1]?.getAttribute("fill")).toBe("#365d7f");
        expect(faces[2]?.getAttribute("fill")).toBe("#9cc3e5");
    });

    test("renders smiley details as shaded eyes and an unfilled mouth", () => {
        const presentation = new PuppeteerGen(PAGE);
        presentation.addSlide().addShape("smileyFace", {
            x: 1,
            y: 1,
            w: 1.5,
            h: 1.5,
            fill: { color: "5B9BD5" },
            line: { color: "843C0C", width: 1 },
        });
        const geometry = renderedPage(presentation).querySelector<SVGGElement>(".shape-geometry");
        expect(geometry?.querySelectorAll(".shape-face")).toHaveLength(2);
        expect(geometry?.querySelectorAll(".shape-outline")).toHaveLength(1);
        expect(geometry?.querySelector(".shape-outline")?.getAttribute("fill")).toBe("none");
        expect(geometry?.querySelector(".shape-outline")?.getAttribute("d")).toContain("Q ");
    });

    test("never silently substitutes an unknown shape", () => {
        const presentation = new PuppeteerGen(PAGE);
        const slide = presentation.addSlide();
        expect(() => slide.addShape("definitelyUnknown" as never, { x: 1, y: 1, w: 2, h: 1 })).toThrow("Unsupported shape geometry: definitelyUnknown");
        expect(renderedPage(presentation).querySelector(".slide-shape")).toBeNull();
    });
});
