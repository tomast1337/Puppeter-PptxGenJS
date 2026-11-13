// Builds every workspace package into packages/<name>/dist, in dependency order: each package's
// declarations resolve its @pdfdeck/* dependencies from their already-built dist, as consumers will.
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = resolve(import.meta.dir, "..");
const packagesDirectory = resolve(projectRoot, "packages");

/** Source entrypoints (relative to the package's src/) per package, in dependency order. */
const PACKAGES = [
    { name: "model", entrypoints: ["index"] },
    { name: "puppeteer", entrypoints: ["index"] },
    { name: "pptxgenjs", entrypoints: ["index", "html"] },
    { name: "wasm", entrypoints: ["browser", "node"] },
    { name: "react", entrypoints: ["index"] },
    // Pure re-exports, so transpiled instead of bundled: with the root tsconfig paths, Bun 1.4.0 (CI)
    // bundles `export { default } from "@pdfdeck/pptxgenjs"` to an export of an undeclared binding.
    { name: "puppeteer-pptxgenjs", entrypoints: ["index", "html", "react", "wasm"], transpileOnly: true },
] as { name: string; entrypoints: string[]; transpileOnly?: boolean }[];

/** Bundles that must load in a browser: no puppeteer, jsdom or node:* imports. */
const BROWSER_SAFE = ["model/dist/index.js", "pptxgenjs/dist/html.js", "wasm/dist/browser.js"];

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

const configDirectory = await mkdtemp(join(tmpdir(), "pdfdeck-build-"));
try {
    for (const { name, entrypoints, transpileOnly } of PACKAGES) {
        const packageDirectory = resolve(packagesDirectory, name);
        const outputDirectory = resolve(packageDirectory, "dist");
        if (outputDirectory === packageDirectory) throw new Error("Refusing to clean a package root");
        await rm(outputDirectory, { recursive: true, force: true });

        if (transpileOnly) {
            const transpiler = new Bun.Transpiler({ loader: "ts", target: "node" });
            for (const entry of entrypoints) {
                await Bun.write(resolve(outputDirectory, `${entry}.js`), transpiler.transformSync(await readFile(resolve(packageDirectory, `src/${entry}.ts`), "utf8")));
            }
        }
        const bundle = transpileOnly
            ? { success: true, logs: [], outputs: entrypoints }
            : await Bun.build({
                  entrypoints: entrypoints.map(entry => resolve(packageDirectory, `src/${entry}.ts`)),
                  outdir: outputDirectory,
                  target: "node",
                  format: "esm",
                  // Dependencies, including the other @pdfdeck packages, stay imports.
                  packages: "external",
                  // The root tsconfig maps @pdfdeck/* to sources for development; never inline them.
                  external: ["@pdfdeck/*"],
                  sourcemap: "inline",

                  minify: true,
              });
        if (!bundle.success) {
            bundle.logs.forEach(log => {
                console.error(log);
            });
            throw new Error(`JavaScript bundle failed for ${name}`);
        }

        // No `paths` here: @pdfdeck/* imports resolve through node_modules to the dist declarations built above.
        const config = join(configDirectory, `${name}.json`);
        await writeFile(
            config,
            JSON.stringify({
                extends: resolve(projectRoot, "tsconfig.build.json"),
                compilerOptions: { paths: {}, outDir: outputDirectory, rootDir: resolve(packageDirectory, "src"), typeRoots: [resolve(projectRoot, "node_modules/@types")] },
                include: [resolve(packageDirectory, "src/**/*.ts")],
            }),
        );
        const declarations = Bun.spawn([process.execPath, "x", "tsc", "-p", config], { cwd: projectRoot, stdout: "inherit", stderr: "inherit" });
        if ((await declarations.exited) !== 0) throw new Error(`Type declaration build failed for ${name}`);
        console.log(`Built ${bundle.outputs.length} JavaScript artifact(s) and TypeScript declarations in packages/${name}/dist/`);
    }
} finally {
    await rm(configDirectory, { recursive: true, force: true });
}

// The compatibility layer ships the pinned PptxGenJS declarations its public types are written against.
const pptxDirectory = resolve(packagesDirectory, "pptxgenjs/dist");
const pptxTypeSource = resolve(projectRoot, "node_modules/pptxgenjs/types/index.d.ts");
const pptxTypeTarget = resolve(pptxDirectory, "pptxgenjs.d.ts");
const pptxTypes = await readFile(pptxTypeSource, "utf8");
if (!pptxTypes.includes("Type definitions for pptxgenjs 4.0.1")) {
    throw new Error("Expected the pinned pptxgenjs@4.0.1 type declarations");
}
await copyFile(pptxTypeSource, pptxTypeTarget);
await mkdir(resolve(pptxDirectory, "THIRD_PARTY_LICENSES"), { recursive: true });
await copyFile(resolve(projectRoot, "node_modules/pptxgenjs/LICENSE"), resolve(pptxDirectory, "THIRD_PARTY_LICENSES/PptxGenJS.txt"));

for (const declarationFile of await declarationFiles(pptxDirectory)) {
    if (declarationFile === pptxTypeTarget) continue;
    const source = await readFile(declarationFile, "utf8");
    const relativeTypePath = relative(dirname(declarationFile), pptxTypeTarget)
        .replaceAll("\\", "/")
        .replace(/\.d\.ts$/, "");
    const importPath = relativeTypePath.startsWith(".") ? relativeTypePath : `./${relativeTypePath}`;
    const standalone = source.replace(/(["'])pptxgenjs\1/g, `"${importPath}"`);
    await writeFile(declarationFile, standalone);
}

const builtEntrypoint = resolve(pptxDirectory, "index.js");
const bundledSource = await readFile(builtEntrypoint, "utf8");
if (/from\s+["']pptxgenjs["']|require\(["']pptxgenjs["']\)/.test(bundledSource)) {
    throw new Error("The runtime bundle must not import pptxgenjs; it is a type-only development oracle");
}
if (/from\s+["']react(?:-dom)?(?:\/[^"']*)?["']|import\(["']react(?:-dom)?/.test(bundledSource)) {
    throw new Error("The core bundle must not import the optional React adapter");
}
for (const { name, entrypoints } of PACKAGES) {
    for (const entry of entrypoints) {
        const source = await readFile(resolve(packagesDirectory, name, `dist/${entry}.js`), "utf8");
        if (/\bBun\s*\./.test(source)) {
            throw new Error(`packages/${name}/dist/${entry}.js must not depend on Bun APIs; published packages support Node.js`);
        }
        // Every bare import must be a declared dependency, so consumers install it (and workspace packages were not inlined).
        const { dependencies = {}, peerDependencies = {} } = (await Bun.file(resolve(packagesDirectory, name, "package.json")).json()) as Record<string, Record<string, string> | undefined>;
        const imported = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"'./][^"']*)["']/g)].map(match => match[1]!.match(/^(?:@[^/]+\/)?[^/]+/)![0]);
        const undeclared = [...new Set(imported)].filter(specifier => !specifier.startsWith("node:") && !(specifier in dependencies) && !(specifier in peerDependencies));
        if (undeclared.length) throw new Error(`packages/${name}/dist/${entry}.js imports undeclared dependencies: ${undeclared.join(", ")}`);
    }
}
for (const browserSafe of BROWSER_SAFE) {
    const source = await readFile(resolve(packagesDirectory, browserSafe), "utf8");
    if (/from\s*["'](?:puppeteer|jsdom|node:|@pdfdeck\/puppeteer)|import\(["'](?:puppeteer|jsdom|node:|@pdfdeck\/puppeteer)|require\(["'](?:puppeteer|jsdom|node:|@pdfdeck\/puppeteer)/.test(source)) {
        throw new Error(`The browser-safe ${browserSafe} bundle must not import puppeteer, jsdom or node:* modules`);
    }
}
// The WASM loaders resolve the binary next to themselves (dist/). scripts/test-package.ts fails a tarball without it.
const wasmBinary = resolve(packagesDirectory, "wasm/src/pdf_wasm_bg.wasm");
if (await Bun.file(wasmBinary).exists()) await copyFile(wasmBinary, resolve(packagesDirectory, "wasm/dist/pdf_wasm_bg.wasm"));
else console.warn("packages/wasm/src/pdf_wasm_bg.wasm is not built (bun run build:wasm); @pdfdeck/wasm will not work");
for (const { name } of PACKAGES) {
    for (const declarationFile of await declarationFiles(resolve(packagesDirectory, name, "dist"))) {
        const source = await readFile(declarationFile, "utf8");
        if (/from\s+["']pptxgenjs["']|import\(["']pptxgenjs["']\)/.test(source)) {
            throw new Error(`Generated declaration still depends on pptxgenjs: ${declarationFile}`);
        }
    }
}
const entrypoint = await import(`${pathToFileURL(builtEntrypoint).href}?build-smoke=${Date.now()}`);
if (typeof entrypoint.default !== "function" || entrypoint.default !== entrypoint.PuppeteerGen) {
    throw new Error("Built entrypoint does not expose PuppeteerGen as its named and default export");
}
if (!entrypoint.PAGE_SIZES || !entrypoint.PPTX_DEFAULTS_VERSION || typeof entrypoint.PuppeteerPdfRenderer !== "function") {
    throw new Error("Built entrypoint is missing public constants");
}
const htmlEntrypoint = await import(`${pathToFileURL(resolve(pptxDirectory, "html.js")).href}?build-smoke=${Date.now()}`);
if (typeof htmlEntrypoint.default !== "function" || htmlEntrypoint.default === entrypoint.default || "closeBrowser" in htmlEntrypoint) {
    throw new Error("Built html entrypoint must expose the core PuppeteerGen without Node adapters");
}
for (const entry of ["index", "html"]) {
    const shim = await import(`${pathToFileURL(resolve(packagesDirectory, `puppeteer-pptxgenjs/dist/${entry}.js`)).href}?build-smoke=${Date.now()}`);
    if (typeof shim.default !== "function" || shim.default !== shim.PuppeteerGen) throw new Error(`Built puppeteer-pptxgenjs/dist/${entry}.js does not re-export PuppeteerGen as its default`);
}
