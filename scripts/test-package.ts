import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PACKAGES = ["model", "puppeteer", "pptxgenjs", "wasm", "pdfkit", "react"];

const projectRoot = resolve(import.meta.dir, "..");
const temporaryRoot = await mkdtemp(join(tmpdir(), "pdflapas-consumer-"));
const rootMetadata = (await Bun.file(resolve(projectRoot, "package.json")).json()) as { devDependencies: Record<string, string> };

async function run(command: string[], cwd: string): Promise<void> {
    const child = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" });
    const exitCode = await child.exited;

    if (exitCode !== 0) {
        throw new Error(`${command.join(" ")} failed with exit code ${exitCode}`);
    }
}

async function output(command: string[], cwd: string): Promise<string> {
    const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "inherit" });
    const text = await new Response(child.stdout).text();

    if ((await child.exited) !== 0) {
        throw new Error(`${command.join(" ")} failed`);
    }

    return text;
}

const tarballs: Record<string, string> = {};

try {
    await run([process.execPath, "run", "build"], projectRoot);
    for (const directory of PACKAGES) {
        const packageDirectory = resolve(projectRoot, "packages", directory);
        const manifest = (await Bun.file(join(packageDirectory, "package.json")).json()) as { name: string; version: string };

        // Built once above, so skip each package's prepack build.
        await run([process.execPath, "pm", "pack", "--ignore-scripts", "--quiet", "--destination", temporaryRoot], packageDirectory);
        const tarball = join(temporaryRoot, `${manifest.name.replace(/^@/, "").replace("/", "-")}-${manifest.version}.tgz`);

        tarballs[manifest.name] = tarball;
        // workspace:* must become the real version in the published manifest.
        const packed = JSON.parse(await output(["tar", "-xzOf", tarball, "package/package.json"], temporaryRoot)) as Record<string, unknown>;
        const workspaceDependencies = Object.entries({ ...(packed.dependencies as object), ...(packed.peerDependencies as object) }).filter(([dependency]) => dependency.startsWith("@pdflapas/"));

        if (JSON.stringify(packed).includes("workspace:") || workspaceDependencies.some(([, version]) => version !== manifest.version)) {
            throw new Error(`${manifest.name} was packed with unresolved workspace dependencies: ${JSON.stringify(workspaceDependencies)}`);
        }

        const files = (await output(["tar", "-tzf", tarball], temporaryRoot)).split("\n");

        if (!files.some(file => file.startsWith("package/dist/") && file.endsWith(".d.ts"))) {
            throw new Error(`${manifest.name} was packed without its dist`);
        }

        // Consumers never build Rust: the tarball must carry the prebuilt binary (bun run build:wasm, or CI's "WASM build" job).
        if (manifest.name === "@pdflapas/wasm" && !files.includes("package/dist/pdf_wasm_bg.wasm")) {
            throw new Error("@pdflapas/wasm was packed without dist/pdf_wasm_bg.wasm (run bun run build:wasm first)");
        }

        if (manifest.name === "@pdflapas/pptxgenjs" && !files.includes("package/dist/pptxgenjs.d.ts")) {
            throw new Error("@pdflapas/pptxgenjs was packed without the vendored pptxgenjs types");
        }

        console.log(`packed ${manifest.name}@${manifest.version} (${workspaceDependencies.map(entry => entry.join("@")).join(", ") || "no workspace dependencies"})`);
    }

    // A clean consumer installs the packed tarballs and typechecks and runs each public entry under Bun and Node.js.
    const consumerDirectory = join(temporaryRoot, "pdflapas-consumer");
    const dependencies = ["@pdflapas/pptxgenjs", "@pdflapas/wasm", "@pdflapas/pdfkit", "@pdflapas/react"];
    // Import specifiers of the four public entries, so the same consumer checks run against @pdflapas/* and the legacy shim.
    const names = { main: "@pdflapas/pptxgenjs", html: "@pdflapas/pptxgenjs/html", wasm: "@pdflapas/wasm", react: "@pdflapas/react" };

    await mkdir(consumerDirectory);
    await Bun.write(
        join(consumerDirectory, "package.json"),
        JSON.stringify(
            {
                name: "puppeteer-gen-package-consumer",
                private: true,
                type: "module",
                dependencies: Object.fromEntries(dependencies.map(name => [name, `file:${tarballs[name]}`])),
                // The @pdflapas/* versions are not on npm yet: resolve them all from the packed tarballs.
                overrides: Object.fromEntries(Object.entries(tarballs).map(([name, tarball]) => [name, `file:${tarball}`])),
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
        if (error instanceof Error && error.message.includes("unexpectedly installed")) {
            throw error;
        }
    }

    for (const optional of ["react", "react-dom"]) {
        if (await Bun.file(join(consumerDirectory, "node_modules", optional, "package.json")).exists()) {
            throw new Error(`Core-only installation unexpectedly installed ${optional}`);
        }
    }

    const consumerSource = `
import PuppeteerGen, {
    InvalidModelError,
    modelToHtml,
    PAGE_SIZES,
    parseModel,
    PuppeteerGenLibreOffice,
    PuppeteerGenPowerPoint,
    type PuppeteerSlide,
    type PptxSlide,
    type PptxTextPropsOptions,
} from "${names.main}";

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
const { html } = await presentation.toHtml();
if (html.split('class="slide-element slide-text"').length - 1 !== 2) {
    throw new Error("Built package did not render consumer text boxes");
}
if (html.split('class="slide-element slide-chart"').length - 1 !== 1) {
    throw new Error("Built package did not render the consumer chart");
}
if (typeof modelToHtml !== "function") throw new Error("Built package does not export modelToHtml");
const stored = JSON.parse(JSON.stringify(presentation.getModel()));
if ((await modelToHtml(parseModel(stored))).html !== html) throw new Error("Built package: modelToHtml(parseModel(getModel() JSON)) is not toHtml()");
stored.slides[0].background = "red;background:url(x)";
if (!(await modelToHtml(stored).then(() => false, error => error instanceof InvalidModelError))) throw new Error("Built package: modelToHtml accepted a color that adds CSS declarations");
class ConsumerDeck extends PuppeteerGenPowerPoint {}
for (const [Target, unkerned] of [[ConsumerDeck, true], [PuppeteerGenLibreOffice, false]] as const) {
    const deck = new Proxy(new Target(), {});
    if (!(deck instanceof PuppeteerGen)) throw new Error("A target class is not a PuppeteerGen");
    deck.addSlide().addText("Target", { x: 1, y: 1, w: 3, h: 1, fontSize: 10 });
    if ((await deck.toHtml()).html.includes("font-kerning: none") !== unkerned) throw new Error(\`\${Target.name} wrote the wrong font-kerning\`);
}
console.log("standalone package consumer passed");
`;
    const consumerSourcePath = join(consumerDirectory, "consumer.ts");

    await Bun.write(consumerSourcePath, consumerSource);
    // The public API with plain PptxGenJS literals against the built declarations: no internal brand leaks (#277).
    const apiTypes = await Bun.file(resolve(projectRoot, "tests/publicApiTypes.ts")).text();
    const apiTypesEntries: Record<string, string> = { "@pdflapas/pptxgenjs": names.main, "@pdflapas/pptxgenjs/html": names.html, "@pdflapas/wasm": names.wasm };

    await Bun.write(
        join(consumerDirectory, "api-types-consumer.ts"),
        apiTypes.replace(/from "([^"]+)"/g, (statement, specifier: string) => `from "${apiTypesEntries[specifier] ?? specifier}"`),
    );
    // The PDFKit renderer (#316), typechecked with the others (#354): its node condition loads system fonts, and it draws a shadow through its dependencies.
    const pdfkitConsumerSource = `
import PuppeteerGen, { PAGE_SIZES } from "${names.main}";
import { createPdfkitRenderer, loadSystemFonts } from "@pdflapas/pdfkit";

const renderer = await createPdfkitRenderer({ fonts: await loadSystemFonts() });
const presentation = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape, { renderer });
presentation.addSlide().addText("PDFKit package consumer", { x: 1, y: 1, w: 4, h: 1, fontFace: "Calibri" });
presentation.addSlide().addShape("rect", { x: 1, y: 1, w: 2, h: 1, fill: { color: "0088CC" }, shadow: { type: "outer", blur: 4, offset: 3, angle: 45, color: "000000", opacity: 0.5 } });
const pdf = new TextDecoder("latin1").decode(await presentation.toPdf());
if (!pdf.startsWith("%PDF-") || pdf.match(/\\/Type\\s*\\/Page\\b(?!s)/g)?.length !== 2 || !pdf.includes("/SMask")) throw new Error("PDFKit entry did not render a two-page PDF with a shadow");
console.log(\`PDFKit package consumer generated a PDF under \${"Bun" in globalThis ? "Bun" : "Node.js"}\`);
`;
    const pdfkitConsumerPath = join(consumerDirectory, "pdfkit-consumer.ts");

    await Bun.write(pdfkitConsumerPath, pdfkitConsumerSource);
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
                files: ["consumer.ts", "api-types-consumer.ts", "pdfkit-consumer.ts"],
            },
            null,
            2,
        ),
    );
    await run([resolve(projectRoot, "node_modules/.bin/tsc"), "-p", "tsconfig.json"], consumerDirectory);
    await run([process.execPath, "run", consumerSourcePath], consumerDirectory);

    const nodeConsumerSource = `
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import PuppeteerGen, { PAGE_SIZES, PuppeteerGenPowerPoint } from "${names.main}";

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
const rendered = (await presentation.toHtml()).html;
if (rendered.split('class="slide-element slide-text"').length - 1 !== 1) {
    throw new Error("Packed package did not render text under Node.js");
}
if (rendered.split('class="slide-element slide-chart"').length - 1 !== 1) {
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
// The PowerPoint target reads an installed face's metrics through fontconfig: Liberation Sans 18pt puts the
// baseline 28.8 x 1854/2288 px below the line top, a face that is not installed 24 px, each rounded to PowerPoint's
// 1/600 in baseline grid (0.16 px).
let liberationSans = false;
try {
    liberationSans = execFileSync("fc-match", ["-f", "%{family}", "Liberation Sans"], { encoding: "utf8" }).split(",").includes("Liberation Sans");
} catch {}
const powerPoint = new PuppeteerGenPowerPoint();
powerPoint.addSlide().addText("Installed font", { x: 1, y: 1, w: 3, h: 1, fontFace: "Liberation Sans", fontSize: 18 });
const baseline = Number((await powerPoint.toHtml()).html.match(/data-line-baseline="([^"]*)"/)?.[1]);
const grid = 96 / 600; // CSS px per inch over PowerPoint baseline grid steps per inch
const onGrid = (px) => Math.round(px / grid) * grid;
if (Math.abs(baseline - onGrid(liberationSans ? (28.8 * 1854) / 2288 : 24)) > 1e-3) {
    throw new Error(\`Packed package PowerPoint target placed the Liberation Sans baseline at \${baseline} (installed: \${liberationSans}) under Node.js\`);
}
console.log("Node.js package consumer generated a PDF");
`;
    const nodeConsumerSourcePath = join(consumerDirectory, "consumer.mjs");

    await Bun.write(nodeConsumerSourcePath, nodeConsumerSource);
    await run(["node", nodeConsumerSourcePath], consumerDirectory);

    // The /html entry must stay browser-safe at the package level, and run against a caller-supplied DOM.
    const htmlConsumerSource = `
import PuppeteerGen, { PAGE_SIZES, type HtmlPresentationDocument, type PresentationRenderer } from "${names.html}";

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

    if (!browserBundle.success) {
        throw new AggregateError(browserBundle.logs, "The packed html entry failed to bundle for the browser");
    }

    const browserInputs = Object.keys((browserBundle as unknown as { metafile: { inputs: Record<string, unknown> } }).metafile.inputs);
    const nodeOnlyInputs = browserInputs.filter(path => /(^|\/)node_modules\/(puppeteer(-core)?|@puppeteer\/[^/]+|jsdom)\/|^node:/.test(path));

    if (nodeOnlyInputs.length) {
        throw new Error(`The packed html entry pulled Node-only modules into a browser bundle: ${nodeOnlyInputs.join(", ")}`);
    }

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

    // The ./wasm entry: its browser condition must stay browser-safe, and it renders under Node and Bun.
    const wasmConsumerSource = `
import PuppeteerGen, { PAGE_SIZES } from "${names.main}";
import { createWasmRenderer, loadSystemFonts } from "${names.wasm}";

const renderer = await createWasmRenderer({ fonts: await loadSystemFonts() });
const presentation = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape, { renderer });
presentation.addSlide().addText("WASM package consumer", { x: 1, y: 1, w: 4, h: 1, fontFace: "Calibri" });
presentation.addSlide().addShape("roundRect", { x: 1, y: 1, w: 2, h: 1, fill: { color: "0088CC" } });
const pdf = new TextDecoder("latin1").decode(await presentation.toPdf());
if (!pdf.startsWith("%PDF-") || pdf.match(/\\/Type\\s*\\/Page\\b(?!s)/g)?.length !== 2) throw new Error("WASM entry did not render a two-page PDF");
console.log(\`WASM package consumer generated a PDF under \${"Bun" in globalThis ? "Bun" : "Node.js"}\`);
`;
    const wasmConsumerPath = join(consumerDirectory, "wasm-consumer.ts");

    await Bun.write(wasmConsumerPath, wasmConsumerSource);
    const wasmBrowserPath = join(consumerDirectory, "wasm-browser.ts");

    await Bun.write(wasmBrowserPath, `export { createWasmRenderer } from "${names.wasm}";\n`);
    const wasmBrowserBundle = await Bun.build({ entrypoints: [wasmBrowserPath], target: "browser", format: "esm", metafile: true } as Parameters<typeof Bun.build>[0]);

    if (!wasmBrowserBundle.success) {
        throw new AggregateError(wasmBrowserBundle.logs, "The packed wasm entry failed to bundle for the browser");
    }

    const wasmInputs = Object.keys((wasmBrowserBundle as unknown as { metafile: { inputs: Record<string, unknown> } }).metafile.inputs);

    if (!wasmInputs.some(path => path.endsWith("@pdflapas/wasm/dist/browser.js")) || wasmInputs.some(path => /(^|\/)node_modules\/(puppeteer(-core)?|@puppeteer\/[^/]+|jsdom)\/|^node:/.test(path))) {
        throw new Error(`The packed wasm entry's browser condition is not browser-safe: ${wasmInputs.join(", ")}`);
    }

    const wasmConfig = await Bun.file(join(consumerDirectory, "tsconfig.json")).json();

    wasmConfig.files.push("wasm-consumer.ts");
    await Bun.write(join(consumerDirectory, "tsconfig.json"), JSON.stringify(wasmConfig, null, 2));
    await run([resolve(projectRoot, "node_modules/.bin/tsc"), "-p", "tsconfig.json"], consumerDirectory);
    await run([process.execPath, "run", wasmConsumerPath], consumerDirectory);
    await run(["node", "--experimental-strip-types", wasmConsumerPath], consumerDirectory);
    await run([process.execPath, "run", pdfkitConsumerPath], consumerDirectory);
    await run(["node", "--experimental-strip-types", pdfkitConsumerPath], consumerDirectory);
    // Install React only after the core consumer has been typechecked and run without it.
    await run([process.execPath, "add", "--dev", "--ignore-scripts", ...["react", "react-dom", "@types/react", "@types/react-dom"].map(name => `${name}@${rootMetadata.devDependencies[name]}`)], consumerDirectory);
    const reactConsumerSource = `
import { createElement, useId } from "react";
import PuppeteerGen from "${names.main}";
import { registerReactComponent } from "${names.react}";

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
const cards = [...(await p.toHtml()).html.matchAll(/<section id="([^"]+)">([^<]*)<[/]section>/g)];
if (cards[0]?.[2] !== "React consumer" || cards[0][1] === cards[1]?.[1]) throw new Error("React adapter consumer failed");
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

    // The same consumers under Node's own resolution (nodenext), which needs file extensions in every
    // relative import of the shipped declarations (#226), plus a CommonJS file that requires each entry.
    // The main entry's declarations reach @pdflapas/model and @pdflapas/puppeteer, and skipLibCheck is off.
    const requireConsumerSource = `
import Main = require("${names.main}");
import Html = require("${names.html}");
import Wasm = require("${names.wasm}");
import React = require("${names.react}");
export const entries: unknown[] = [Main.default, Html.default, Wasm.createWasmRenderer, React.registerReactComponent];
`;

    await Bun.write(join(consumerDirectory, "require-consumer.cts"), requireConsumerSource);
    await Bun.write(join(consumerDirectory, "tsconfig.nodenext.json"), JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext" }, files: [...config.files, "require-consumer.cts"] }, null, 2));
    await run([resolve(projectRoot, "node_modules/.bin/tsc"), "-p", "tsconfig.nodenext.json"], consumerDirectory);
} finally {
    await rm(temporaryRoot, { recursive: true, force: true });
}
