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
console.log("Node.js package consumer generated a PDF");
`;
    const nodeConsumerSourcePath = join(consumerDirectory, "consumer.mjs");
    await Bun.write(nodeConsumerSourcePath, nodeConsumerSource);
    await run(["node", nodeConsumerSourcePath], consumerDirectory);
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
