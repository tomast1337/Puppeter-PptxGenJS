import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const temporaryRoot = await mkdtemp(join(tmpdir(), "puppeteer-gen-consumer-"));
const consumerDirectory = join(temporaryRoot, "consumer");
const packageMetadata = await Bun.file(resolve(projectRoot, "package.json")).json() as { name: string; version: string };
const tarballName = `${packageMetadata.name.replace(/^@/, "").replace("/", "-")}-${packageMetadata.version}.tgz`;
const tarball = join(temporaryRoot, tarballName);

async function run(command: string[], cwd: string): Promise<void> {
    const child = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" });
    const exitCode = await child.exited;
    if (exitCode !== 0) throw new Error(`${command.join(" ")} failed with exit code ${exitCode}`);
}

try {
    await run([
        process.execPath, "pm", "pack",
        "--destination", temporaryRoot,
    ], projectRoot);

    await mkdir(consumerDirectory);
    await Bun.write(join(consumerDirectory, "package.json"), JSON.stringify({
        name: "puppeteer-gen-package-consumer",
        private: true,
        type: "module",
        dependencies: { "puppeter-pptxgenjs": `file:${tarball}` },
    }, null, 2));
    await run([process.execPath, "install", "--ignore-scripts"], consumerDirectory);

    try {
        await access(join(consumerDirectory, "node_modules/pptxgenjs"));
        throw new Error("The packed replacement unexpectedly installed pptxgenjs");
    } catch (error) {
        if (error instanceof Error && error.message.includes("unexpectedly installed")) throw error;
    }

    const consumerSource = `
import PuppeteerGen, {
    PAGE_SIZES,
    type PuppeteerSlide,
    type PptxSlide,
    type PptxTextPropsOptions,
} from "puppeter-pptxgenjs";

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
    await Bun.write(join(consumerDirectory, "tsconfig.json"), JSON.stringify({
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
    }, null, 2));
    await run([resolve(projectRoot, "node_modules/.bin/tsc"), "-p", "tsconfig.json"], consumerDirectory);
    await run([process.execPath, "run", consumerSourcePath], consumerDirectory);
} finally {
    await rm(temporaryRoot, { recursive: true, force: true });
}
