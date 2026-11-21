import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const PACKAGES_DIR = resolve(import.meta.dir, "../packages");

// Dependency direction (issue #22): renderers depend only on the model; the compat layer needs
// Puppeteer only for its Node entry's default renderer. Anything else is a layering regression.
const ALLOWED: Record<string, string[]> = {
    model: [],
    puppeteer: ["@pdflapas/model"],
    wasm: ["@pdflapas/model"],
    pdfkit: ["@pdflapas/model"],
    pptxgenjs: ["@pdflapas/model", "@pdflapas/puppeteer"],
    react: ["@pdflapas/pptxgenjs"],
};
const NODE_ONLY: Record<string, string[]> = { "@pdflapas/puppeteer": ["pptxgenjs/src/index.ts", "pptxgenjs/src/node.ts"] };

async function sources(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(entry => (entry.isDirectory() ? sources(join(directory, entry.name)) : /\.(ts|js)$/.test(entry.name) ? [join(directory, entry.name)] : [])));

    return nested.flat();
}

async function imports(): Promise<{ pkg: string; file: string; specifier: string }[]> {
    const found = [];

    for (const pkg of Object.keys(ALLOWED)) {
        for (const file of await sources(join(PACKAGES_DIR, pkg, "src"))) {
            const text = await readFile(file, "utf8");

            for (const match of text.matchAll(/^\s*(?:import|export)\b[^"';]*?from\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|^\s*import\s*["']([^"']+)["']/gm)) {
                found.push({ pkg, file: relative(PACKAGES_DIR, file), specifier: (match[1] ?? match[2] ?? match[3])! });
            }
        }
    }

    return found;
}

const workspaceName = (specifier: string) => specifier.match(/^(@pdflapas\/[^/]+)(\/|$)/)?.[1];

describe("workspace packages", () => {
    test("import other workspace packages only in the allowed direction", async () => {
        const all = await imports();

        expect(all.length).toBeGreaterThan(50);
        const wrong = all.filter(({ pkg, file, specifier }) => {
            const target = workspaceName(specifier);

            if (!target) {
                return false;
            }

            return !ALLOWED[pkg]!.includes(target) || (target in NODE_ONLY && !NODE_ONLY[target]!.includes(file));
        });

        expect(wrong).toEqual([]);
    });

    test("imports never climb with ../, and #src/ names a source file of the importing package", async () => {
        const all = await imports();

        expect(all.filter(({ specifier }) => specifier.startsWith(".") && specifier.split("/").includes(".."))).toEqual([]);
        const broken = [];

        for (const { pkg, file, specifier } of all.filter(({ specifier }) => specifier.startsWith("#"))) {
            const target = join(PACKAGES_DIR, pkg, "src", `${specifier.slice("#src/".length)}.ts`);
            const inside = specifier.startsWith("#src/") && !specifier.split("/").includes("..") && target.startsWith(join(PACKAGES_DIR, pkg, "src/"));

            if (!inside || !(await Bun.file(target).exists())) {
                broken.push({ file, specifier });
            }
        }

        expect(broken).toEqual([]);
    });

    test("every package maps #src/* to its sources for development and to its declarations once published", async () => {
        for (const pkg of Object.keys(ALLOWED)) {
            const manifest = JSON.parse(await readFile(join(PACKAGES_DIR, pkg, "package.json"), "utf8"));

            // Key order is resolution order: tsc takes "source" through customConditions, consumers "types".
            expect({ pkg, imports: JSON.stringify(manifest.imports) }).toEqual({ pkg, imports: JSON.stringify({ "#src/*": { source: "./src/*.ts", types: "./dist/*.d.ts", default: "./src/*.ts" } }) });
        }
    });

    test("package.json dependencies match the allowed direction, and the model has none", async () => {
        for (const [pkg, allowed] of Object.entries(ALLOWED)) {
            const manifest = JSON.parse(await readFile(join(PACKAGES_DIR, pkg, "package.json"), "utf8"));
            const dependencies = Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies });

            expect({ pkg, workspace: dependencies.filter(name => workspaceName(name)).sort() }).toEqual({ pkg, workspace: [...allowed].sort() });
            for (const name of allowed) {
                expect(manifest.dependencies[name]).toBe("workspace:*");
            }
        }

        const model = JSON.parse(await readFile(join(PACKAGES_DIR, "model/package.json"), "utf8"));

        expect([model.dependencies, model.peerDependencies]).toEqual([undefined, undefined]);
        const versions = await Promise.all(Object.keys(ALLOWED).map(async pkg => JSON.parse(await readFile(join(PACKAGES_DIR, pkg, "package.json"), "utf8")).version));

        expect(new Set(versions).size).toBe(1);
    });

    test("the root tsconfig paths point at the sources of each package's exports", async () => {
        // tsconfig.json has line comments and no "//" inside strings.
        const { compilerOptions } = JSON.parse((await readFile(resolve(import.meta.dir, "../tsconfig.json"), "utf8")).replace(/\/\/.*$/gm, ""));
        const paths = compilerOptions.paths as Record<string, [string]>;
        const expected: Record<string, string> = {};

        for (const pkg of Object.keys(ALLOWED)) {
            const manifest = JSON.parse(await readFile(join(PACKAGES_DIR, pkg, "package.json"), "utf8"));

            // Bun applies these paths at run time, so a runtime-split package maps to its "bun" entry (#351).
            for (const [subpath, conditions] of Object.entries(manifest.exports as Record<string, { types: string; bun?: string }>)) {
                const entry = conditions.bun ?? conditions.types;

                expected[manifest.name + subpath.slice(1)] = `./packages/${pkg}/src/${entry.replace(/^\.\/dist\//, "").replace(/\.(d\.ts|js)$/, ".ts")}`;
            }
        }

        expect(Object.fromEntries(Object.entries(paths).map(([name, [path]]) => [name, path]))).toEqual(expected);
    });

    test("Bun scripts in the repo get the Node entry of runtime-split packages", async () => {
        // A script beside the packages resolves @pdflapas/* through the root tsconfig paths, as a repro does (#351).
        const script = `import { loadSystemFonts as wasm } from "@pdflapas/wasm"; import { loadSystemFonts as pdfkit } from "@pdflapas/pdfkit"; const missing = { dirs: [] }; for (const load of [wasm, pdfkit]) await load(missing).catch((error: Error) => console.log(error.message));`;
        const file = resolve(import.meta.dir, `../.bun-resolution-check-${process.pid}.ts`);

        await Bun.write(file, script);
        try {
            const child = Bun.spawnSync([process.execPath, file], { cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });

            expect({ exitCode: child.exitCode, stderr: child.stderr.toString() }).toEqual({ exitCode: 0, stderr: "" });
            // The Node entry reports the empty font directory list; the browser entry would say it needs Node/Bun.
            const reports: boolean[] = [];

            for (const line of child.stdout.toString().split("\n")) {
                if (line) {
                    reports.push(line.startsWith("No font files matching"));
                }
            }

            expect(reports).toEqual([true, true]);
        } finally {
            await Bun.file(file).delete();
        }
    });

    test("@pdflapas/model bundles for the browser without importing anything outside itself", async () => {
        const config = { entrypoints: [join(PACKAGES_DIR, "model/src/index.ts")], target: "browser", format: "esm", metafile: true } as Parameters<typeof Bun.build>[0];
        const build = (await Bun.build(config)) as Awaited<ReturnType<typeof Bun.build>> & { metafile: { inputs: Record<string, { imports: { path: string }[] }> } };

        expect(build.success).toBe(true);
        const imports = Object.values(build.metafile.inputs).flatMap(input => input.imports);

        expect(imports.filter(({ path }) => !resolve(path).startsWith(join(PACKAGES_DIR, "model/src/")))).toEqual([]);
    });
});
