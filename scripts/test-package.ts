import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const temporaryRoot = await mkdtemp(join(tmpdir(), "puppeteer-gen-consumer-"));
const consumerDirectory = join(temporaryRoot, "consumer");
const packageMetadata = (await Bun.file(resolve(projectRoot, "package.json")).json()) as {
    name: string;
    version: string;
    devDependencies: Record<string, string>;
};
const tarballName = `${packageMetadata.name.replace(/^@/, "").replace("/", "-")}-${packageMetadata.version}.tgz`;
const tarball = join(temporaryRoot, tarballName);

async function run(command: string[], cwd: string): Promise<void> {
    const child = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" });
    const exitCode = await child.exited;
    if (exitCode !== 0) throw new Error(`${command.join(" ")} failed with exit code ${exitCode}`);
}

try {
    await run([process.execPath, "pm", "pack", "--destination", temporaryRoot], projectRoot);

    await mkdir(consumerDirectory);
    await Bun.write(
        join(consumerDirectory, "package.json"),
        JSON.stringify(
            {
                name: "puppeteer-gen-package-consumer",
                private: true,
                type: "module",
                dependencies: { [packageMetadata.name]: `file:${tarball}` },
            },
            null,
            2,
        ),
    );
    await run([process.execPath, "install", "--ignore-scripts"], consumerDirectory);
    // --ignore-scripts skips Puppeteer's browser download, and the consumer resolves the newest
    // puppeteer@^24 (not our lockfile's), so fetch the browser that version renders with.
    await run([process.execPath, "x", "puppeteer", "browsers", "install", "chrome-headless-shell"], consumerDirectory);

    try {
        await access(join(consumerDirectory, "node_modules/pptxgenjs"));
        throw new Error("The packed replacement unexpectedly installed pptxgenjs");
    } catch (error) {
        if (error instanceof Error && error.message.includes("unexpectedly installed")) throw error;
    }

    for (const optional of ["react", "react-dom"]) {
        if (await Bun.file(join(consumerDirectory, "node_modules", optional, "package.json")).exists()) {
            throw new Error(`Core-only installation unexpectedly installed ${optional}`);
        }
    }

    const consumerSource = `
import PuppeteerGen, {
    PAGE_SIZES,
    type PuppeteerSlide,
    type PptxSlide,
    type PptxTextPropsOptions,
} from "${packageMetadata.name}";

const options: PptxTextPropsOptions = {
    x: 1, y: 1, w: 3, h: 1,
    fontSize: 24,
    bold: true,
};
const presentation = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape);
const slide: PuppeteerSlide = presentation.addSlide();
const compatibleSlide: PptxSlide = slide;
slide.addText("Standalone package", options);
slide.addChart("bar", [{ name: "Series", labels: ["A", "B"], values: [2, 4] }], {
    x: 1, y: 2, w: 3, h: 2,
});
compatibleSlide.addText("Compatible slide type", { x: 4, y: 1, w: 3, h: 1 });
if (presentation.page.querySelectorAll(".slide-text").length !== 2) {
    throw new Error("Built package did not render consumer text boxes");
}
if (presentation.page.querySelectorAll(".slide-chart svg").length !== 1) {
    throw new Error("Built package did not render the consumer chart");
}
console.log("standalone package consumer passed");
`;
    const consumerSourcePath = join(consumerDirectory, "consumer.ts");
    await Bun.write(consumerSourcePath, consumerSource);
    await Bun.write(
        join(consumerDirectory, "tsconfig.json"),
        JSON.stringify(
            {
                compilerOptions: {
                    lib: ["ESNext", "DOM"],
                    target: "ESNext",
                    module: "Preserve",
                    moduleResolution: "bundler",
                    strict: true,
                    skipLibCheck: false,
                    types: [],
                    noEmit: true,
                },
                files: ["consumer.ts"],
            },
            null,
            2,
        ),
    );
    await run([resolve(projectRoot, "node_modules/.bin/tsc"), "-p", "tsconfig.json"], consumerDirectory);
    await run([process.execPath, "run", consumerSourcePath], consumerDirectory);

    const nodeConsumerSource = `
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import PuppeteerGen, { PAGE_SIZES } from "${packageMetadata.name}";

if (typeof globalThis.Bun !== "undefined") {
    throw new Error("Node compatibility test unexpectedly ran under Bun");
}
const presentation = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape);
const slide = presentation.addSlide();
slide.addText("Node package consumer", { x: 1, y: 1, w: 3, h: 1 });
const imagePath = join(process.cwd(), "node-consumer.svg");
await writeFile(imagePath, '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="blue"/></svg>');
slide.addImage({ path: imagePath, x: 5, y: 1, w: 1, h: 1 });
slide.addChart("bar", [{ name: "Series", labels: ["A", "B"], values: [2, 4] }], {
    x: 1, y: 2, w: 3, h: 2,
});
if (presentation.page.querySelectorAll(".slide-text").length !== 1) {
    throw new Error("Packed package did not render text under Node.js");
}
if (presentation.page.querySelectorAll(".slide-chart svg").length !== 1) {
    throw new Error("Packed package did not render a chart under Node.js");
}
const pdfPath = join(process.cwd(), "node-consumer.pdf");
await presentation.writeFile({ fileName: pdfPath });
const pdf = await readFile(pdfPath);
if (pdf.subarray(0, 4).toString() !== "%PDF") {
    throw new Error("Packed package did not generate a PDF under Node.js");
}
const html = await presentation.toHtml();
if (!html.html.includes('src="data:image/svg+xml;base64,') || html.html.includes("data-source-path")) {
    throw new Error("Packed package toHtml() did not inline the file image under Node.js");
}
if (Buffer.from(await presentation.toPdf()).subarray(0, 4).toString() !== "%PDF") {
    throw new Error("Packed package toPdf() did not return PDF bytes under Node.js");
}
console.log("Node.js package consumer generated a PDF");
`;
    const nodeConsumerSourcePath = join(consumerDirectory, "consumer.mjs");
    await Bun.write(nodeConsumerSourcePath, nodeConsumerSource);
    await run(["node", nodeConsumerSourcePath], consumerDirectory);

    // The /html entry must stay browser-safe at the package level, and run against a caller-supplied DOM.
    const htmlConsumerSource = `
import PuppeteerGen, { PAGE_SIZES, type HtmlPresentationDocument, type PresentationRenderer } from "${packageMetadata.name}/html";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export async function check(createDocument: () => Document): Promise<void> {
    const received: HtmlPresentationDocument[] = [];
    const renderer: PresentationRenderer = { render: async document => (received.push(document), new Uint8Array([37, 80, 68, 70])) };
    const presentation = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape, { createDocument, renderer });
    presentation.addSlide().addText("HTML entry", { x: 1, y: 1, w: 3, h: 1 }).addImage({ data: PNG, x: 1, y: 2, w: 1, h: 1 });
    const html = await presentation.toHtml();
    if (!html.html.includes("HTML entry") || !html.html.includes("@page") || !html.html.includes(PNG)) throw new Error("html entry toHtml() output is incomplete");
    if ((await presentation.toPdf()).length !== 4 || received[0]?.html !== html.html) throw new Error("html entry did not delegate to the renderer");
    const failures = await Promise.all([
        new PuppeteerGen(undefined, { createDocument }).toPdf().then(() => "", (error: Error) => error.message),
        presentation.writeFile({ fileName: "deck.pdf" }).then(() => "", (error: Error) => error.message),
    ]);
    if (!failures[0]?.includes("requires a renderer") || !failures[1]?.includes("Node entry")) throw new Error(\`html entry errors were not explicit: \${failures.join(" | ")}\`);
}
`;
    await Bun.write(join(consumerDirectory, "html-consumer.ts"), htmlConsumerSource);
    const browserBundle = await Bun.build({ entrypoints: [join(consumerDirectory, "html-consumer.ts")], target: "browser", format: "esm", metafile: true } as Parameters<typeof Bun.build>[0]);
    if (!browserBundle.success) throw new AggregateError(browserBundle.logs, "The packed html entry failed to bundle for the browser");
    const browserInputs = Object.keys((browserBundle as unknown as { metafile: { inputs: Record<string, unknown> } }).metafile.inputs);
    const nodeOnlyInputs = browserInputs.filter(path => /(^|\/)node_modules\/(puppeteer(-core)?|@puppeteer\/[^/]+|jsdom)\/|^node:/.test(path));
    if (nodeOnlyInputs.length) throw new Error(`The packed html entry pulled Node-only modules into a browser bundle: ${nodeOnlyInputs.join(", ")}`);
    const htmlRunnerSource = `
import { JSDOM } from "jsdom";
import { check } from "./html-consumer.ts";
await check(() => new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>").window.document);
console.log("html entry package consumer passed");
`;
    const htmlRunnerPath = join(consumerDirectory, "html-runner.mts");
    await Bun.write(htmlRunnerPath, htmlRunnerSource);
    const htmlConfig = await Bun.file(join(consumerDirectory, "tsconfig.json")).json();
    htmlConfig.files.push("html-consumer.ts");
    await Bun.write(join(consumerDirectory, "tsconfig.json"), JSON.stringify(htmlConfig, null, 2));
    await run([resolve(projectRoot, "node_modules/.bin/tsc"), "-p", "tsconfig.json"], consumerDirectory);
    await run([process.execPath, "run", htmlRunnerPath], consumerDirectory);
    await run(["node", "--experimental-strip-types", htmlRunnerPath], consumerDirectory);
    // Install React only after the core consumer has been typechecked and run without it.
    await run([process.execPath, "add", "--dev", "--ignore-scripts", ...["react", "react-dom", "@types/react", "@types/react-dom"].map(name => `${name}@${packageMetadata.devDependencies[name]}`)], consumerDirectory);
    const reactConsumerSource = `
import { createElement, useId } from "react";
import PuppeteerGen from "${packageMetadata.name}";
import { registerReactComponent } from "${packageMetadata.name}/react";

function Card({ label }: { label: string }) {
    const id = useId();
    return createElement("section", { id }, label);
}
const p = new PuppeteerGen();
registerReactComponent(p, "card", 1, Card, {
    parseProps(props) {
        if (typeof props.label !== "string") throw new Error("Invalid label");
        return { label: props.label };
    },
});
const slide = p.addSlide();
slide.addComponent({ type: "card", version: 1, props: { label: "React consumer" } }, { x: 1, y: 1, w: 3, h: 1 });
slide.addComponent({ type: "card", version: 1, props: { label: "Second" } }, { x: 1, y: 2, w: 3, h: 1 });
const cards = p.page.querySelectorAll("section");
if (cards[0]?.textContent !== "React consumer" || cards[0].id === cards[1]?.id) throw new Error("React adapter consumer failed");
console.log("React adapter package consumer passed");
`;
    const reactConsumerPath = join(consumerDirectory, "react-consumer.ts");
    await Bun.write(reactConsumerPath, reactConsumerSource);
    const config = await Bun.file(join(consumerDirectory, "tsconfig.json")).json();
    config.files.push("react-consumer.ts");
    await Bun.write(join(consumerDirectory, "tsconfig.json"), JSON.stringify(config, null, 2));
    await run([resolve(projectRoot, "node_modules/.bin/tsc"), "-p", "tsconfig.json"], consumerDirectory);
    await run([process.execPath, "run", reactConsumerPath], consumerDirectory);
    await run(["node", "--experimental-strip-types", reactConsumerPath], consumerDirectory);
} finally {
    await rm(temporaryRoot, { recursive: true, force: true });
}
