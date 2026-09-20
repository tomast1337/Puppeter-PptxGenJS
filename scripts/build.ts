import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = resolve(import.meta.dir, "..");
const outputDirectory = resolve(projectRoot, "dist");
if (outputDirectory === projectRoot) throw new Error("Refusing to clean the project root");

await rm(outputDirectory, { recursive: true, force: true });

const bundle = await Bun.build({
    entrypoints: [resolve(projectRoot, "src/exports.ts")],
    outdir: outputDirectory,
    target: "node",
    format: "esm",
    packages: "external",
    sourcemap: "inline",

    minify: true,
});

if (!bundle.success) {
    bundle.logs.forEach(log => {
        console.error(log);
    });
    throw new Error("JavaScript bundle failed");
}

const declarations = Bun.spawn([process.execPath, "x", "tsc", "-p", resolve(projectRoot, "tsconfig.build.json")], {
    cwd: projectRoot,
    stdout: "inherit",
    stderr: "inherit",
});
if ((await declarations.exited) !== 0) throw new Error("Type declaration build failed");

const pptxTypeSource = resolve(projectRoot, "node_modules/pptxgenjs/types/index.d.ts");
const pptxTypeTarget = resolve(outputDirectory, "pptxgenjs.d.ts");
const pptxTypes = await readFile(pptxTypeSource, "utf8");
if (!pptxTypes.includes("Type definitions for pptxgenjs 4.0.1")) {
    throw new Error("Expected the pinned pptxgenjs@4.0.1 type declarations");
}
await copyFile(pptxTypeSource, pptxTypeTarget);
await mkdir(resolve(outputDirectory, "THIRD_PARTY_LICENSES"), { recursive: true });
await copyFile(resolve(projectRoot, "node_modules/pptxgenjs/LICENSE"), resolve(outputDirectory, "THIRD_PARTY_LICENSES/PptxGenJS.txt"));

async function declarationFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(
        entries.map(entry => {
            const path = resolve(directory, entry.name);
            return entry.isDirectory() ? declarationFiles(path) : path.endsWith(".d.ts") ? [path] : [];
        }),
    );
    return files.flat();
}

for (const declarationFile of await declarationFiles(outputDirectory)) {
    if (declarationFile === pptxTypeTarget) continue;
    const source = await readFile(declarationFile, "utf8");
    const relativeTypePath = relative(dirname(declarationFile), pptxTypeTarget)
        .replaceAll("\\", "/")
        .replace(/\.d\.ts$/, "");
    const importPath = relativeTypePath.startsWith(".") ? relativeTypePath : `./${relativeTypePath}`;
    const standalone = source.replace(/(["'])pptxgenjs\1/g, `"${importPath}"`);
    await writeFile(declarationFile, standalone);
}

const builtEntrypoint = resolve(outputDirectory, "exports.js");
const bundledSource = await readFile(builtEntrypoint, "utf8");
if (/from\s+["']pptxgenjs["']|require\(["']pptxgenjs["']\)/.test(bundledSource)) {
    throw new Error("The runtime bundle must not import pptxgenjs; it is a type-only development oracle");
}
if (/\bBun\s*\./.test(bundledSource)) {
    throw new Error("The runtime bundle must not depend on Bun APIs; published packages support Node.js");
}
for (const declarationFile of await declarationFiles(outputDirectory)) {
    const source = await readFile(declarationFile, "utf8");
    if (/from\s+["']pptxgenjs["']|import\(["']pptxgenjs["']\)/.test(source)) {
        throw new Error(`Generated declaration still depends on pptxgenjs: ${declarationFile}`);
    }
}
const entrypoint = await import(`${pathToFileURL(builtEntrypoint).href}?build-smoke=${Date.now()}`);
if (typeof entrypoint.default !== "function" || entrypoint.default !== entrypoint.PuppeteerGen) {
    throw new Error("Built entrypoint does not expose PuppeteerGen as its named and default export");
}
if (!entrypoint.PAGE_SIZES || !entrypoint.PPTX_DEFAULTS_VERSION) {
    throw new Error("Built entrypoint is missing public constants");
}

console.log(`Built ${bundle.outputs.length} JavaScript artifact(s) and TypeScript declarations in dist/`);
