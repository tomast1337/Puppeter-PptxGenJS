// Builds every workspace package into packages/<name>/dist, in dependency order: each package's
// declarations resolve its @pdflapas/* dependencies from their already-built dist, as consumers will.
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
    { name: "pdfkit", entrypoints: ["browser", "node"] },
    { name: "react", entrypoints: ["index"] },
] as { name: string; entrypoints: string[] }[];

const RELATIVE_SPECIFIER = /(\bfrom\s*|\bimport\(\s*)(["'])(\.{1,2}\/[^"']*)\2/g;

/** Bundles that must load in a browser: no puppeteer, jsdom or node:* imports. */
const BROWSER_SAFE = ["model/dist/index.js", "pptxgenjs/dist/html.js", "wasm/dist/browser.js", "pdfkit/dist/browser.js"];

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

const configDirectory = await mkdtemp(join(tmpdir(), "pdflapas-build-"));

try {
    for (const { name, entrypoints } of PACKAGES) {
        const packageDirectory = resolve(packagesDirectory, name);
        const outputDirectory = resolve(packageDirectory, "dist");

        if (outputDirectory === packageDirectory) {
            throw new Error("Refusing to clean a package root");
        }

        await rm(outputDirectory, { recursive: true, force: true });

        const bundle = await Bun.build({
            entrypoints: entrypoints.map(entry => resolve(packageDirectory, `src/${entry}.ts`)),
            outdir: outputDirectory,
            target: "node",
            format: "esm",
            // Dependencies, including the other @pdflapas packages, stay imports.
            packages: "external",
            // The root tsconfig maps @pdflapas/* to sources for development; never inline them.
            external: ["@pdflapas/*"],
            // `packages: "external"` also keeps "#src/..." subpath imports external (Bun 1.4.4); resolve them through
            // the package's imports map, to its own sources, so they are inlined.
            plugins: [
                {
                    name: "inline-src-imports",
                    setup: build => {
                        build.onResolve({ filter: /^#src\// }, ({ path, importer }) => ({ path: Bun.resolveSync(path, importer) }));
                    },
                },
            ],
            sourcemap: "inline",

            minify: true,
        });

        if (!bundle.success) {
            for (const log of bundle.logs) {
                console.error(log);
            }

            throw new Error(`JavaScript bundle failed for ${name}`);
        }

        // No `paths` here: @pdflapas/* imports resolve through node_modules to the dist declarations built above.
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

        if ((await declarations.exited) !== 0) {
            throw new Error(`Type declaration build failed for ${name}`);
        }

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
    if (declarationFile === pptxTypeTarget) {
        continue;
    }

    const source = await readFile(declarationFile, "utf8");
    const relativeTypePath = relative(dirname(declarationFile), pptxTypeTarget)
        .replaceAll("\\", "/")
        .replace(/\.d\.ts$/, ".js");
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

        if (undeclared.length) {
            throw new Error(`packages/${name}/dist/${entry}.js imports undeclared dependencies: ${undeclared.join(", ")}`);
        }
    }
}

for (const browserSafe of BROWSER_SAFE) {
    const source = await readFile(resolve(packagesDirectory, browserSafe), "utf8");

    if (/from\s*["'](?:puppeteer|jsdom|node:|@pdflapas\/puppeteer)|import\(["'](?:puppeteer|jsdom|node:|@pdflapas\/puppeteer)|require\(["'](?:puppeteer|jsdom|node:|@pdflapas\/puppeteer)/.test(source)) {
        throw new Error(`The browser-safe ${browserSafe} bundle must not import puppeteer, jsdom or node:* modules`);
    }
}

// The WASM loaders resolve the binary next to themselves (dist/). scripts/test-package.ts fails a tarball without it.
const wasmBinary = resolve(packagesDirectory, "wasm/src/pdf_wasm_bg.wasm");

if (await Bun.file(wasmBinary).exists()) {
    await copyFile(wasmBinary, resolve(packagesDirectory, "wasm/dist/pdf_wasm_bg.wasm"));
} else {
    console.warn("packages/wasm/src/pdf_wasm_bg.wasm is not built (bun run build:wasm); @pdflapas/wasm will not work");
}

for (const { name } of PACKAGES) {
    for (const declarationFile of await declarationFiles(resolve(packagesDirectory, name, "dist"))) {
        // The vendored PptxGenJS declarations are copied verbatim; their only relative paths are in comments.
        if (declarationFile !== pptxTypeTarget) {
            // tsc keeps the sources' extensionless relative imports in the declarations it emits, and Node's own resolution
            // (`moduleResolution: "nodenext"`) needs the file named (#226). The sources stay extensionless; the shipped
            // declarations name `./x.js`, or `./x/index.js` for a folder, whichever was emitted.
            const declaration = await readFile(declarationFile, "utf8");
            const resolved = new Map<string, string>();

            for (const [, , , specifier] of declaration.matchAll(RELATIVE_SPECIFIER)) {
                if (!specifier || resolved.has(specifier) || specifier.endsWith(".js")) {
                    continue;
                }

                const base = resolve(dirname(declarationFile), specifier);

                if (await Bun.file(`${base}.d.ts`).exists()) {
                    resolved.set(specifier, `${specifier}.js`);
                } else if (await Bun.file(join(base, "index.d.ts")).exists()) {
                    resolved.set(specifier, `${specifier}/index.js`);
                } else {
                    throw new Error(`${declarationFile} imports ${specifier}, which has no emitted declaration`);
                }
            }

            const withExtensions = declaration.replace(RELATIVE_SPECIFIER, (match, prefix: string, quote: string, specifier: string) => {
                const target = resolved.get(specifier);

                return target ? `${prefix}${quote}${target}${quote}` : match;
            });

            await writeFile(declarationFile, withExtensions);
        }

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
