import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = resolve(import.meta.dir, "..");
const outputDirectory = resolve(projectRoot, "dist");
if (outputDirectory === projectRoot) throw new Error("Refusing to clean the project root");

await rm(outputDirectory, { recursive: true, force: true });

const bundle = await Bun.build({
    entrypoints: [resolve(projectRoot, "src/exports.ts")],
    outdir: outputDirectory,
    target: "bun",
    format: "esm",
    packages: "external",
    sourcemap: "external",
    minify: false,
});

if (!bundle.success) {
    bundle.logs.forEach(log => console.error(log));
    throw new Error("JavaScript bundle failed");
}

const declarations = Bun.spawn([
    process.execPath,
    "x",
    "tsc",
    "-p",
    resolve(projectRoot, "tsconfig.build.json"),
], {
    cwd: projectRoot,
    stdout: "inherit",
    stderr: "inherit",
});
if (await declarations.exited !== 0) throw new Error("Type declaration build failed");

const builtEntrypoint = resolve(outputDirectory, "exports.js");
const bundledSource = await readFile(builtEntrypoint, "utf8");
if (/from\s+["']pptxgenjs["']|require\(["']pptxgenjs["']\)/.test(bundledSource)) {
    throw new Error("The runtime bundle must not import pptxgenjs; it is a type-only development oracle");
}
const entrypoint = await import(`${pathToFileURL(builtEntrypoint).href}?build-smoke=${Date.now()}`);
if (typeof entrypoint.default !== "function" || entrypoint.default !== entrypoint.PuppeteerGen) {
    throw new Error("Built entrypoint does not expose PuppeteerGen as its named and default export");
}
if (!entrypoint.PAGE_SIZES || !entrypoint.PPTX_DEFAULTS_VERSION) {
    throw new Error("Built entrypoint is missing public constants");
}

console.log(`Built ${bundle.outputs.length} JavaScript artifact(s) and TypeScript declarations in dist/`);
