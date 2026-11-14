import { afterAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { closeBrowser, withBrowser } from "../packages/puppeteer/src/browser";
import { buildCrossRuntimeDeck } from "./crossRuntimeDeck";

// Runs the /html entry in real Chromium; tests/html.test.ts only covers it with an injected jsdom document.
const PNG_DATA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

afterAll(() => closeBrowser());

async function bundleHtmlEntry(): Promise<string> {
    const build = await Bun.build({ entrypoints: [resolve(import.meta.dir, "../packages/pptxgenjs/src/html.ts")], target: "browser", format: "esm" });
    expect(build.success).toBe(true);
    expect(build.outputs).toHaveLength(1);
    return build.outputs[0]!.text();
}

describe("html entry in Chromium", () => {
    test("builds a deck, serializes it to self-contained HTML and delegates toPdf", async () => {
        const code = await bundleHtmlEntry();
        const result = await withBrowser(async browser => {
            const page = await browser.newPage();
            const errors: string[] = [];
            page.on("pageerror", error => errors.push(`pageerror: ${error}`));
            page.on("console", message => {
                if (message.type() === "error" || message.type() === "warn") errors.push(`console.${message.type()}: ${message.text()}`);
            });
            // Fail on any network access: the deck must only use data URIs.
            await page.setRequestInterception(true);
            page.on("request", request => {
                if (request.url().startsWith("data:") || request.url().startsWith("blob:")) return void request.continue();
                errors.push(`request: ${request.url()}`);
                void request.abort();
            });
            try {
                await page.setContent("<!DOCTYPE html><html><head></head><body></body></html>");
                const output = await page.evaluate(
                    async (source: string, png: string) => {
                        const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
                        const { default: PuppeteerGen, modelToHtml, PAGE_SIZES } = await import(url);
                        const page = PAGE_SIZES.SCREEN_16X9.landscape;
                        const received: unknown[] = [];
                        const renderer = {
                            async render(document: unknown) {
                                received.push(document);
                                return new TextEncoder().encode("%PDF-fake");
                            },
                        };
                        const pres = new PuppeteerGen(page, { renderer });
                        pres.addSlide()
                            .addText("Plain text", { x: 0.5, y: 0.5, w: 4, h: 0.5 })
                            .addText([{ text: "Bold ", options: { bold: true, color: "FF0000" } }, { text: "italic", options: { italic: true, breakLine: true } }, { text: "Second line" }], { x: 0.5, y: 1.2, w: 4, h: 1 })
                            .addShape("roundRect", { x: 5, y: 0.5, w: 2, h: 1, fill: { color: "0088CC" }, line: { color: "000000", width: 1 } })
                            .addImage({ data: png, x: 5, y: 2, w: 1, h: 1 });
                        pres.addSlide().addTable(
                            [
                                [{ text: "H1", options: { bold: true } }, { text: "H2" }],
                                ["a", "b"],
                            ],
                            { x: 0.5, y: 0.5, w: 5 },
                        );
                        // Element-returning components exercise the realm-independent element check.
                        pres.registerComponent("test/badge", 1, {
                            render: (props: { label: string }, context: { document: Document }) => {
                                const badge = context.document.createElement("strong");
                                badge.textContent = props.label;
                                return badge;
                            },
                        });
                        pres.addSlide()
                            .addComponent({ type: "test/badge", version: 1, props: { label: "Component badge" } }, { x: 7, y: 0.5, w: 2, h: 0.5 })
                            .addChart("bar", [{ name: "Series", labels: ["A", "B", "C"], values: [1, 3, 2] }], { x: 0.5, y: 0.5, w: 6, h: 4 });
                        const document = await pres.toHtml();
                        const pdf = new TextDecoder().decode(await pres.toPdf());

                        const failure = async (run: () => Promise<unknown>) =>
                            run().then(
                                () => "resolved",
                                (error: Error) => error.message,
                            );
                        const filePath = new PuppeteerGen(page);
                        filePath.addSlide().addImage({ path: "images/logo.png", x: 1, y: 1, w: 1, h: 1 });
                        const noRenderer = new PuppeteerGen(page);
                        noRenderer.addSlide();
                        // The exported model step with its browser defaults gives toHtml()'s bytes.
                        const modelOnly = new PuppeteerGen(page);
                        modelOnly.addSlide().addText("Model only", { x: 1, y: 1, w: 3, h: 1 }).addImage({ data: png, x: 5, y: 1, w: 1, h: 1 });
                        const fromModel = (await modelToHtml(modelOnly.getModel())).html === (await modelOnly.toHtml()).html;

                        // Render the serialized document to check the slides lay out in a real engine.
                        const frame = window.document.createElement("iframe");
                        frame.style.cssText = "width: 1600px; height: 1000px";
                        const loaded = new Promise(done => frame.addEventListener("load", done, { once: true }));
                        frame.srcdoc = document.html;
                        window.document.body.append(frame);
                        await loaded;
                        const rendered = frame.contentDocument!;
                        return {
                            html: document.html,
                            pageSize: document.pageSize,
                            expectedPageSize: page,
                            pdf,
                            sameDocument: JSON.stringify(received[0]) === JSON.stringify(document),
                            fromModel,
                            filePathError: await failure(() => filePath.toHtml()),
                            noRendererError: await failure(() => noRenderer.toPdf()),
                            slideSizes: Array.from(rendered.querySelectorAll(".slide-container"), element => {
                                const box = element.getBoundingClientRect();
                                return [box.width, box.height];
                            }),
                            sources: Array.from(rendered.querySelectorAll("[src], [href], [xlink\\:href]"), element => element.getAttribute("src") ?? element.getAttribute("href") ?? element.getAttribute("xlink:href")),
                            text: rendered.body.textContent,
                            images: Array.from(rendered.images, image => [image.complete, image.naturalWidth]),
                            shapes: rendered.querySelectorAll("svg path, svg rect").length,
                            tableCells: rendered.querySelectorAll("td").length,
                            chartSvgs: rendered.querySelectorAll(".slide-chart svg").length,
                        };
                    },
                    code,
                    PNG_DATA,
                );
                return { ...output, errors };
            } finally {
                await page.close();
            }
        });

        expect(result.errors).toEqual([]);
        expect(result.pageSize).toEqual(result.expectedPageSize);
        expect(result.html).toContain(`size: ${result.pageSize.width}in ${result.pageSize.height}in`);
        expect(result.html).toContain(`src="${PNG_DATA}"`);
        expect(result.sources.filter(source => !source!.startsWith("data:") && !source!.startsWith("#"))).toEqual([]);
        expect(result.slideSizes).toHaveLength(3);
        for (const [width, height] of result.slideSizes) {
            expect(width).toBeGreaterThan(0);
            expect(height).toBeGreaterThan(0);
        }
        for (const text of ["Plain text", "Bold", "italic", "Second line", "H1", "a", "b", "Component badge"]) expect(result.text).toContain(text);
        expect(result.images).toEqual([[true, 1]]);
        expect(result.shapes).toBeGreaterThan(0);
        expect(result.tableCells).toBe(4);
        expect(result.chartSvgs).toBeGreaterThan(0);
        expect(result.pdf).toBe("%PDF-fake");
        expect(result.sameDocument).toBe(true);
        expect(result.fromModel).toBe(true);
        expect(result.filePathError).toStartWith("Cannot resolve image path 'images/logo.png' without filesystem access");
        expect(result.noRendererError).toStartWith("toPdf() requires a renderer");
    }, 60_000);

    test("builds the same toHtml() bytes in Chromium as in jsdom (Node)", async () => {
        const code = await bundleHtmlEntry();
        const browserHtml = await withBrowser(async browser => {
            const page = await browser.newPage();
            try {
                await page.setContent("<!DOCTYPE html><html><head></head><body></body></html>");
                return await page.evaluate(
                    async (source: string, build: string, png: string) => {
                        const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
                        const { default: Gen } = await import(url);
                        const buildDeck = new Function(`return (${build})`)();
                        return (await buildDeck(Gen, png).toHtml()).html as string;
                    },
                    code,
                    buildCrossRuntimeDeck.toString(),
                    PNG_DATA,
                );
            } finally {
                await page.close();
            }
        });
        const nodeHtml = (await buildCrossRuntimeDeck(PuppeteerGen, PNG_DATA).toHtml()).html;
        expect(nodeHtml).toContain('<meta name="pdfdeck-profile" content="1">');
        // Values the CSSOM would rewrite (#69 finding 4) are written verbatim.
        expect(nodeHtml).toContain("left: 14.399999999999999px;");
        expect(nodeHtml).toContain("font-family: &quot;Arial&quot;;");
        expect(nodeHtml).toContain("color: #17365D;");
        expect(browserHtml).toBe(nodeHtml);
    }, 60_000);
});
