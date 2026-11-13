import { describe, expect, spyOn, test } from "bun:test";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeGeometry, normalizeTransform } from "../packages/pptxgenjs/src/normalize/geometry";
import { resolveImageSource } from "../packages/pptxgenjs/src/node";
import { arrowHeadPath, arrowShaftStart, normalizeColor, normalizeFill, normalizeLine, normalizeShadow, shaftDashes, startDashAt } from "../packages/pptxgenjs/src/normalize/style";
import { PAGE_SIZES } from "../packages/pptxgenjs/src/pageLayouts";

describe("shared object normalization", () => {
    test("normalizes inches and percentages against page dimensions", () => {
        expect(normalizeGeometry({ x: "10%", y: "20%", w: 2, h: 1 }, {}, PAGE_SIZES.SCREEN_16X9.landscape)).toEqual({ x: 96, y: 108, width: 192, height: 96 });
    });

    test("uses family defaults only when values are absent", () => {
        expect(normalizeGeometry({ x: 0, y: 0 }, { x: 1, y: 1, w: 1, h: 1 }, PAGE_SIZES.SCREEN_16X9.landscape)).toEqual({ x: 0, y: 0, width: 96, height: 96 });
    });

    test("normalizes rotation, flips, and clamped transparency", () => {
        expect(normalizeTransform({ rotate: 30, flipH: true, transparency: 25 })).toEqual({ rotation: 30, flipH: true, flipV: false, opacity: 0.75 });
        expect(normalizeTransform({ transparency: 200 }).opacity).toBe(0);
    });

    test("resolves theme colors, fills, and lines", () => {
        expect(normalizeColor("accent1")).toBe("#4472C4");
        expect(normalizeFill({ type: "none", color: "FF0000" }).visible).toBe(false);
        expect(normalizeLine({ color: "accent2", width: 2, dashType: "dash" })).toMatchObject({
            visible: true,
            color: "#ED7D31",
            style: "dashed",
        });
    });

    test("uses the ECMA-376 prstDash ratios LibreOffice imports", () => {
        // 0.75pt = 1px, so the dash array is the pattern in line widths.
        const dashArray = (dashType: NonNullable<Parameters<typeof normalizeLine>[0]>["dashType"]) => normalizeLine({ width: 0.75, dashType }).dashArray;
        expect(dashArray("dash")).toBe("4 3");
        expect(dashArray("lgDashDotDot")).toBe("8 3 1 3 1 3");
        expect(dashArray("sysDash")).toBe("3 1");
        expect(dashArray("sysDot")).toBe("1 1");
        expect(dashArray("solid")).toBeUndefined();
    });

    test("restarts the dash pattern where LibreOffice starts the shaft behind a begin arrowhead", () => {
        // 2.25pt = 3px line; a medium oval is 9px across and docks on its centre, so the shaft starts at
        // 4.5px less the 9/15px overlap = 3.9px (measured: LibreOffice dashes start 4px later than SVG's).
        expect(arrowShaftStart("oval", 3)).toBeCloseTo(3.9, 9);
        expect(arrowShaftStart("triangle", 3)).toBeCloseTo(8.4, 9);
        expect(arrowShaftStart("none", 3)).toBe(0);
        // Thin lines size heads from a 0.7mm line.
        expect(arrowShaftStart("triangle", 1)).toBeCloseTo(((3 * 0.7 * 96) / 25.4) * (14 / 15), 9);
        const line = normalizeLine({ width: 2.25, dashType: "dash", beginArrowType: "oval", endArrowType: "triangle" });
        const parts = line.dashArray!.split(" ").map(Number);
        expect(parts).toHaveLength(4);
        [0, 3.9, 12, 5.1].forEach((value, index) => expect(parts[index]).toBeCloseTo(value, 9));
        // The end arrowhead does not move the phase.
        expect(normalizeLine({ width: 2.25, dashType: "dash", endArrowType: "triangle" }).dashArray).toBe("12 9");
    });

    test("resolves line heads to LibreOffice's medium outlines, pointing out of the line", () => {
        const points = (path: string | undefined) => [...(path ?? "").matchAll(/[ML] (\S+) (\S+)/g)].map(([, x, y]) => [Number(x), Number(y)]);
        // 3px line: 9px heads; the tip sits on the line end and the base 9px back along the line.
        expect(points(arrowHeadPath("triangle", 3))).toEqual([
            [0, 0],
            [-9, 4.5],
            [-9, -4.5],
        ]);
        expect(points(arrowHeadPath("stealth", 3))).toEqual([
            [0, 0],
            [-9, 4.5],
            [-5.4, 0],
            [-9, -4.5],
        ]);
        // The diamond and oval are centred on the line end.
        expect(points(arrowHeadPath("diamond", 3))).toEqual([
            [4.5, 0],
            [0, 4.5],
            [-4.5, 0],
            [0, -4.5],
        ]);
        expect(arrowHeadPath("oval", 3)).toBe("M 4.5 0 A 4.5 4.5 0 1 0 -4.5 0 A 4.5 4.5 0 1 0 4.5 0 Z");
        // The open arrow is 3.5 widths; its arms and stem are one line width (3px) thick and its tip points out (issue #41).
        const arrow = points(arrowHeadPath("arrow", 3));
        expect(arrow[0]).toEqual([0, 0]);
        expect(Math.max(...arrow.map(([x]) => x!))).toBe(0);
        expect(Math.min(...arrow.map(([x]) => x!))).toBeCloseTo(-10.5, 9);
        expect(arrow[4]![1]! - arrow[5]![1]!).toBeCloseTo(3, 9);
        // Thin lines size heads from a 0.7mm line.
        expect(points(arrowHeadPath("triangle", 1))[1]![0]).toBeCloseTo((-3 * 0.7 * 96) / 25.4, 9);
        expect(arrowHeadPath("none", 3)).toBeUndefined();
        expect(() => arrowHeadPath("hook", 3)).toThrow("Unknown line arrow type 'hook'");
        const line = normalizeLine({ width: 2.25, beginArrowType: "oval", endArrowType: "triangle" });
        expect(line.beginHeadPath).toBe(String(arrowHeadPath("oval", 3)));
        expect(line.endHeadPath).toBe(String(arrowHeadPath("triangle", 3)));
        expect(normalizeLine({ width: 2.25 }).endHeadPath).toBeUndefined();
    });

    test("strokes a straight line only between its heads, as LibreOffice does", () => {
        // 3px line, 100px long: the shaft runs from 3.9px (oval) to 100 - 8.4px (triangle).
        const solid = normalizeLine({ width: 2.25, beginArrowType: "oval", endArrowType: "triangle" }, 100).dashArray!.split(" ").map(Number);
        [0, 3.9, 87.7, 100].forEach((value, index) => expect(solid[index]).toBeCloseTo(value, 9));
        expect(solid).toHaveLength(4);
        // Dashes start at the shaft and the last one is cut where the shaft ends.
        expect(shaftDashes([12, 9], 3.9, 30, 50)).toEqual([0, 3.9, 12, 9, expect.closeTo(5.1, 9), 50]);
        expect(shaftDashes([12, 9], 0, 30, 30)).toEqual([0, 0, 12, 9, 9, 30]);
        // A line shorter than its heads draws no shaft.
        expect(shaftDashes([12, 9], 8, 5, 10)).toEqual([0, 18]);
        // Without heads, or without a straight length, nothing is trimmed.
        expect(normalizeLine({ width: 2.25 }, 100).dashArray).toBeUndefined();
        expect(normalizeLine({ width: 2.25, endArrowType: "triangle" }).dashArray).toBeUndefined();
    });

    test("rotates a dash pattern without breaking dash/gap parity", () => {
        expect(startDashAt([4, 3], 0)).toEqual([4, 3]);
        expect(startDashAt([4, 3], 7)).toEqual([4, 3]);
        expect(startDashAt([4, 3], 1)).toEqual([0, 1, 4, 2]);
        expect(startDashAt([4, 3], 5)).toEqual([2, 3, 2, 0]);
        expect(startDashAt([4, 3, 1, 3], 2)).toEqual([0, 2, 4, 3, 1, 1]);
    });

    test("converts PowerPoint shadows to CSS geometry", () => {
        const shadow = normalizeShadow({ type: "outer", color: "000000", opacity: 0.5, angle: 90, offset: 6, blur: 3 });
        expect(shadow.visible).toBe(true);
        expect(shadow.offsetX).toBeCloseTo(0, 8);
        expect(shadow.offsetY).toBeCloseTo(8, 8);
        expect(shadow.blur).toBe(4);
        expect(shadow.color).toBe("rgba(0, 0, 0, 0.5)");
    });
});

describe("image source normalization", () => {
    test("preserves data URIs and embeds remote images", async () => {
        expect(await resolveImageSource("data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
        const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(new Uint8Array([1, 2, 3]), {
                status: 200,
                headers: { "content-type": "image/png" },
            }),
        );
        try {
            expect(await resolveImageSource("https://example.com/image.png")).toBe("data:image/png;base64,AQID");
        } finally {
            fetchMock.mockRestore();
        }
    });

    test("embeds local files as data URLs", async () => {
        const path = join(tmpdir(), `puppeteer-gen-${crypto.randomUUID()}.png`);
        await writeFile(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        try {
            expect(await resolveImageSource(path)).toBe("data:image/png;base64,iVBORw==");
        } finally {
            await unlink(path);
        }
    });

    test("reports the resolved path for missing files", async () => {
        const path = join(tmpdir(), `missing-${crypto.randomUUID()}.png`);
        expect(resolveImageSource(path)).rejects.toThrow(`Image file not found: ${path}`);
    });
});
