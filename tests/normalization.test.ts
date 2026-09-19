import { describe, expect, spyOn, test } from "bun:test";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { normalizeGeometry, normalizeTransform } from "../src/normalize/geometry";
import { resolveImageSource } from "../src/normalize/image";
import { normalizeFill, normalizeLine, normalizeShadow, normalizeColor } from "../src/normalize/style";
import { PAGE_SIZES } from "../src/pageLayouts";

describe("shared object normalization", () => {
    test("normalizes inches and percentages against page dimensions", () => {
        expect(normalizeGeometry(
            { x: "10%", y: "20%", w: 2, h: 1 },
            {},
            PAGE_SIZES.SCREEN_16X9.landscape,
        )).toEqual({ x: 96, y: 108, width: 192, height: 96 });
    });

    test("uses family defaults only when values are absent", () => {
        expect(normalizeGeometry(
            { x: 0, y: 0 },
            { x: 1, y: 1, w: 1, h: 1 },
            PAGE_SIZES.SCREEN_16X9.landscape,
        )).toEqual({ x: 0, y: 0, width: 96, height: 96 });
    });

    test("normalizes rotation, flips, and clamped transparency", () => {
        expect(normalizeTransform({ rotate: 30, flipH: true, transparency: 25 }))
            .toEqual({ rotation: 30, flipH: true, flipV: false, opacity: 0.75 });
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
        const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "content-type": "image/png" },
        }));
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
