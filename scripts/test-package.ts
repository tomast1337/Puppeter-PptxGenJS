import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PACKAGES = ["model", "puppeteer", "pptxgenjs", "wasm", "react", "puppeteer-pptxgenjs"];

const projectRoot = resolve(import.meta.dir, "..");
const temporaryRoot = await mkdtemp(join(tmpdir(), "pdfdeck-consumer-"));
const rootMetadata = (await Bun.file(resolve(projectRoot, "package.json")).json()) as { devDependencies: Record<string, string> };

/** Import specifiers of the four public entries, so the same consumer checks run against @pdfdeck/* and the legacy shim. */
interface EntryNames {
    main: string;
    html: string;
    wasm: string;
    react: string;
}

async function run(command: string[], cwd: string): Promise<void> {
    const child = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" });
    const exitCode = await child.exited;
    if (exitCode !== 0) throw new Error(`${command.join(" ")} failed with exit code ${exitCode}`);
}

async function output(command: string[], cwd: string): Promise<string> {
    const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "inherit" });
    const text = await new Response(child.stdout).text();
    if ((await child.exited) !== 0) throw new Error(`${command.join(" ")} failed`);
    return text;
}

const tarballs: Record<string, string> = {};

async function checkConsumer(consumerDirectory: string, dependencies: string[], names: EntryNames): Promise<void> {
    await mkdir(consumerDirectory);
    await Bun.write(
        join(consumerDirectory, "package.json"),
        JSON.stringify(
            {
                name: "puppeteer-gen-package-consumer",
                private: true,
                type: "module",
                dependencies: Object.fromEntries(dependencies.map(name => [name, `file:${tarballs[name]}`])),
                // The @pdfdeck/* versions are not on npm yet: resolve them all from the packed tarballs.
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
import PuppeteerGen, { PAGE_SIZES } from "${names.main}";

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
    if (!wasmBrowserBundle.success) throw new AggregateError(wasmBrowserBundle.logs, "The packed wasm entry failed to bundle for the browser");
    const wasmInputs = Object.keys((wasmBrowserBundle as unknown as { metafile: { inputs: Record<string, unknown> } }).metafile.inputs);
    if (!wasmInputs.some(path => path.endsWith("@pdfdeck/wasm/dist/browser.js")) || wasmInputs.some(path => /(^|\/)node_modules\/(puppeteer(-core)?|@puppeteer\/[^/]+|jsdom)\/|^node:/.test(path))) {
        throw new Error(`The packed wasm entry's browser condition is not browser-safe: ${wasmInputs.join(", ")}`);
    }
    const wasmConfig = await Bun.file(join(consumerDirectory, "tsconfig.json")).json();
    wasmConfig.files.push("wasm-consumer.ts");
    await Bun.write(join(consumerDirectory, "tsconfig.json"), JSON.stringify(wasmConfig, null, 2));
    await run([resolve(projectRoot, "node_modules/.bin/tsc"), "-p", "tsconfig.json"], consumerDirectory);
    await run([process.execPath, "run", wasmConsumerPath], consumerDirectory);
    await run(["node", "--experimental-strip-types", wasmConsumerPath], consumerDirectory);
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
}

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
        const workspaceDependencies = Object.entries({ ...(packed.dependencies as object), ...(packed.peerDependencies as object) }).filter(([dependency]) => dependency.startsWith("@pdfdeck/"));
        if (JSON.stringify(packed).includes("workspace:") || workspaceDependencies.some(([, version]) => version !== manifest.version)) {
            throw new Error(`${manifest.name} was packed with unresolved workspace dependencies: ${JSON.stringify(workspaceDependencies)}`);
        }
        const files = (await output(["tar", "-tzf", tarball], temporaryRoot)).split("\n");
        if (!files.some(file => file.startsWith("package/dist/") && file.endsWith(".d.ts"))) throw new Error(`${manifest.name} was packed without its dist`);
        // Consumers never build Rust: the tarball must carry the prebuilt binary (bun run build:wasm, or CI's "WASM build" job).
        if (manifest.name === "@pdfdeck/wasm" && !files.includes("package/dist/pdf_wasm_bg.wasm")) throw new Error("@pdfdeck/wasm was packed without dist/pdf_wasm_bg.wasm (run bun run build:wasm first)");
        if (manifest.name === "@pdfdeck/pptxgenjs" && !files.includes("package/dist/pptxgenjs.d.ts")) throw new Error("@pdfdeck/pptxgenjs was packed without the vendored pptxgenjs types");
        console.log(`packed ${manifest.name}@${manifest.version} (${workspaceDependencies.map(entry => entry.join("@")).join(", ") || "no workspace dependencies"})`);
    }

    await checkConsumer(join(temporaryRoot, "pdfdeck-consumer"), ["@pdfdeck/pptxgenjs", "@pdfdeck/wasm", "@pdfdeck/react"], {
        main: "@pdfdeck/pptxgenjs",
        html: "@pdfdeck/pptxgenjs/html",
        wasm: "@pdfdeck/wasm",
        react: "@pdfdeck/react",
    });
    // The deprecation shim runs the consumer sources unchanged from the single-package release: a drop-in proof.
    await checkConsumer(join(temporaryRoot, "legacy-consumer"), ["puppeteer-pptxgenjs"], {
        main: "puppeteer-pptxgenjs",
        html: "puppeteer-pptxgenjs/html",
        wasm: "puppeteer-pptxgenjs/wasm",
        react: "puppeteer-pptxgenjs/react",
    });
} finally {
    await rm(temporaryRoot, { recursive: true, force: true });
}
