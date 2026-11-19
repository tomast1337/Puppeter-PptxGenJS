import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PuppeteerGen, resolveImageSource } from "../packages/pptxgenjs/src/node";
import { IMAGE_SOURCE_LIMITS, UnresolvedImageError } from "../packages/pptxgenjs/src/normalize/image";
import { PuppeteerGen as CorePuppeteerGen } from "../packages/pptxgenjs/src/PuppeteerGen";
import { PAGE_SIZES } from "../packages/pptxgenjs/src/pageLayouts";

const PAGE = PAGE_SIZES.SCREEN_16X9.landscape;
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const PNG_DATA = "data:image/png;base64,iVBORw==";

// A local server: no external network.
let server: ReturnType<typeof Bun.serve>;
let base = "";
let dir = "";

beforeAll(async () => {
    server = Bun.serve({
        port: 0,
        fetch(request) {
            const path = new URL(request.url).pathname;
            const image = { "content-type": "image/png" };
            if (path === "/hang") return new Promise<Response>(() => {});
            if (path === "/large-declared") return new Response(new Uint8Array(64), { headers: image });
            if (path === "/large-streamed") {
                // No content-length: the limit has to hold while reading.
                const body = new ReadableStream<Uint8Array>({
                    pull(controller) {
                        controller.enqueue(new Uint8Array(16));
                    },
                });
                return new Response(body, { headers: image });
            }
            if (path === "/slow-body") {
                const body = new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.enqueue(new Uint8Array(1));
                    },
                });
                return new Response(body, { headers: image });
            }
            return new Response(PNG_BYTES, { headers: image });
        },
    });
    base = `http://localhost:${server.port}`;
    dir = await mkdtemp(join(tmpdir(), "pdflapas-images-"));
    await mkdir(join(dir, "tenant"));
    await writeFile(join(dir, "tenant", "logo.png"), PNG_BYTES);
    await writeFile(join(dir, "other.png"), PNG_BYTES);
    await symlink(join(dir, "other.png"), join(dir, "tenant", "escape.png"));
    await writeFile(join(dir, "tenant", "big.png"), new Uint8Array(64));
});

afterAll(async () => {
    await server.stop(true);
    await rm(dir, { recursive: true, force: true });
});

describe("image source limits (#149)", () => {
    test("defaults keep PptxGenJS sources working", async () => {
        expect(await resolveImageSource(`${base}/ok.png`)).toBe(PNG_DATA);
        expect(await resolveImageSource(join(dir, "other.png"))).toBe(PNG_DATA);
        expect(IMAGE_SOURCE_LIMITS).toEqual({ timeoutMs: 30_000, maxBytes: 50 * 1024 * 1024, concurrency: 8 });
    });

    test("times out a server that does not answer, or stalls the body", async () => {
        await expect(resolveImageSource(`${base}/hang`, { timeoutMs: 100 })).rejects.toThrow(`Image fetch timed out after 100 ms: ${base}/hang`);
        await expect(resolveImageSource(`${base}/slow-body`, { timeoutMs: 100 })).rejects.toThrow("imageSources.timeoutMs");
    });

    test("rejects a body over maxBytes, declared or streamed", async () => {
        await expect(resolveImageSource(`${base}/large-declared`, { maxBytes: 32 })).rejects.toThrow(`Image is larger than 32 bytes (64 bytes): ${base}/large-declared`);
        await expect(resolveImageSource(`${base}/large-streamed`, { maxBytes: 1000 })).rejects.toThrow("Image is larger than 1000 bytes");
    });

    test("rejects a file over maxBytes before reading it", async () => {
        await expect(resolveImageSource(join(dir, "tenant", "big.png"), { maxBytes: 32 })).rejects.toThrow("Image is larger than 32 bytes (64 bytes)");
        expect(await resolveImageSource(join(dir, "tenant", "big.png"), { maxBytes: 64 })).toStartWith("data:image/png;base64,");
    });

    test("allowRemote: false rejects URLs, not data URIs or files", async () => {
        await expect(resolveImageSource(`${base}/ok.png`, { allowRemote: false })).rejects.toThrow("imageSources.allowRemote is false");
        expect(await resolveImageSource(PNG_DATA, { allowRemote: false })).toBe(PNG_DATA);
        expect(await resolveImageSource(join(dir, "other.png"), { allowRemote: false })).toBe(PNG_DATA);
    });

    test("baseDir resolves relative paths in it and confines every path, symlinks followed", async () => {
        const baseDir = join(dir, "tenant");
        expect(await resolveImageSource("logo.png", { baseDir })).toBe(PNG_DATA);
        expect(await resolveImageSource(join(baseDir, "logo.png"), { baseDir })).toBe(PNG_DATA);
        await expect(resolveImageSource("../other.png", { baseDir })).rejects.toThrow("Image path is outside imageSources.baseDir");
        await expect(resolveImageSource(join(dir, "other.png"), { baseDir })).rejects.toThrow("outside imageSources.baseDir");
        await expect(resolveImageSource("escape.png", { baseDir })).rejects.toThrow("escape.png resolves to");
        await expect(resolveImageSource("logo.png", { baseDir: join(dir, "missing") })).rejects.toThrow("Image file not found");
    });

    test("the constructor checks imageSources and applies it to the default resolver", async () => {
        expect(() => new PuppeteerGen(PAGE, { imageSources: { timeoutMs: -1 } })).toThrow("`imageSources.timeoutMs` must be a positive number, got -1");
        expect(() => new PuppeteerGen(PAGE, { imageSources: { maxBytes: 1.5 } })).toThrow("must be a positive integer");
        expect(() => new PuppeteerGen(PAGE, { imageSources: { baseDIR: "x" } as never })).toThrow('unknown key "baseDIR"');
        expect(() => new PuppeteerGen(PAGE, { imageSources: {}, resolveImage: async () => PNG_DATA })).toThrow("cannot be combined");
        expect(() => new CorePuppeteerGen(PAGE, { imageSources: { allowRemote: "no" } as never })).toThrow("must be a boolean");

        const confined = new PuppeteerGen(PAGE, { imageSources: { baseDir: join(dir, "tenant") } });
        confined.addSlide().addImage({ path: "logo.png" });
        expect((await confined.toHtml()).html).toContain(PNG_DATA);
        const escaped = new PuppeteerGen(PAGE, { imageSources: { baseDir: join(dir, "tenant") } });
        escaped.addSlide().addImage({ path: "../other.png" });
        await expect(escaped.toHtml()).rejects.toThrow("outside imageSources.baseDir");
        const core = new CorePuppeteerGen(PAGE, { imageSources: { allowRemote: false } });
        core.addSlide().addImage({ path: `${base}/ok.png` });
        await expect(core.toHtml()).rejects.toThrow("imageSources.allowRemote is false");
    });

    // #284: the HTML and the PDF must not depend on the network or a path, so only a data URI may reach `src`.
    test("toHtml() throws UnresolvedImageError when resolveImage returns anything but an image data URI", async () => {
        const toHtml = (result: unknown, path = "logo.png") => {
            const presentation = new CorePuppeteerGen(PAGE, { resolveImage: async () => result as string }); // `as`: a JavaScript caller can return anything
            presentation.addSlide().addImage({ path });
            return presentation.toHtml();
        };
        for (const result of ["https://cdn.example.com/logo.png", "/srv/images/logo.png", "data:text/plain;base64,YQ==", "data:image/svg+xml,<svg/>", "data:image/png;base64,", 42]) {
            const error = await toHtml(result).catch((caught: unknown) => caught);
            expect(error).toBeInstanceOf(UnresolvedImageError);
            expect(error).toMatchObject({ name: "UnresolvedImageError", source: "logo.png", result });
        }
        await expect(toHtml("https://cdn.example.com/logo.png", "https://example.com/logo.png")).rejects.toThrow(
            'resolveImage returned "https://cdn.example.com/logo.png" for image "https://example.com/logo.png", not a data URI: a resolver must read or fetch the image and return its bytes as "data:image/<type>;base64,<data>"',
        );
        await expect(toHtml("/srv/images/logo.png")).rejects.toThrow('resolveImage returned "/srv/images/logo.png" for image "logo.png"');
        expect((await toHtml(PNG_DATA)).html).toContain(`src="${PNG_DATA}"`);
        expect((await toHtml("DATA:IMAGE/JPEG;BASE64,/9j/")).html).toContain('src="DATA:IMAGE/JPEG;BASE64,/9j/"');
    });

    test("toHtml() resolves at most IMAGE_SOURCE_LIMITS.concurrency images at once", async () => {
        let active = 0;
        let peak = 0;
        const resolveImage = async (_source: string) => {
            peak = Math.max(peak, ++active);
            await Bun.sleep(5);
            active--;
            return PNG_DATA;
        };
        const presentation = new CorePuppeteerGen(PAGE, { resolveImage });
        const slide = presentation.addSlide();
        for (let index = 0; index < 20; index++) slide.addImage({ path: `image-${index}.png` });
        const { html } = await presentation.toHtml();
        expect(peak).toBe(IMAGE_SOURCE_LIMITS.concurrency);
        expect(html.match(/data:image\/png;base64,iVBORw==/g)?.length).toBe(20);
    });
});
