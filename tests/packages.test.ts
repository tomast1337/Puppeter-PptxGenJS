import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const PACKAGES_DIR = resolve(import.meta.dir, "../packages");

// Dependency direction (issue #22): renderers depend only on the model; the compat layer needs
// Puppeteer only for its Node entry's default renderer. Anything else is a layering regression.
const ALLOWED: Record<string, string[]> = {
    model: [],
    puppeteer: ["@pdfdeck/model"],
    wasm: ["@pdfdeck/model"],
    pptxgenjs: ["@pdfdeck/model", "@pdfdeck/puppeteer"],
    react: ["@pdfdeck/pptxgenjs"],
    "puppeteer-pptxgenjs": ["@pdfdeck/pptxgenjs", "@pdfdeck/react", "@pdfdeck/wasm"],
};
const NODE_ONLY: Record<string, string[]> = { "@pdfdeck/puppeteer": ["pptxgenjs/src/exports.ts", "pptxgenjs/src/node.ts"] };

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

const workspaceName = (specifier: string) => specifier.match(/^(@pdfdeck\/[^/]+|puppeteer-pptxgenjs)(\/|$)/)?.[1];

describe("workspace packages", () => {
    test("import other workspace packages only in the allowed direction", async () => {
        const all = await imports();
        expect(all.length).toBeGreaterThan(50);
        const wrong = all.filter(({ pkg, file, specifier }) => {
            const target = workspaceName(specifier);
            if (!target) return false;
            return !ALLOWED[pkg]!.includes(target) || (target in NODE_ONLY && !NODE_ONLY[target]!.includes(file));
        });
        expect(wrong).toEqual([]);
    });

    test("relative imports stay inside their own package", async () => {
        const escaping = (await imports()).filter(({ pkg, file, specifier }) => specifier.startsWith(".") && !relative(join(PACKAGES_DIR, pkg, "src"), resolve(PACKAGES_DIR, dirname(file), specifier)).match(/^[^.]/));
        expect(escaping).toEqual([]);
    });

    test("package.json dependencies match the allowed direction, and the model has none", async () => {
        for (const [pkg, allowed] of Object.entries(ALLOWED)) {
            const manifest = JSON.parse(await readFile(join(PACKAGES_DIR, pkg, "package.json"), "utf8"));
            const dependencies = Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies });
            expect({ pkg, workspace: dependencies.filter(name => workspaceName(name)).sort() }).toEqual({ pkg, workspace: [...allowed].sort() });
            for (const name of allowed) expect(manifest.dependencies[name]).toBe("workspace:*");
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
        for (const pkg of Object.keys(ALLOWED).filter(pkg => pkg !== "puppeteer-pptxgenjs")) {
            const manifest = JSON.parse(await readFile(join(PACKAGES_DIR, pkg, "package.json"), "utf8"));
            for (const [subpath, conditions] of Object.entries(manifest.exports as Record<string, { types: string }>)) {
                expected[manifest.name + subpath.slice(1)] = `./packages/${pkg}/src/${conditions.types.replace(/^\.\/dist\//, "").replace(/\.d\.ts$/, ".ts")}`;
            }
        }
        expect(Object.fromEntries(Object.entries(paths).map(([name, [path]]) => [name, path]))).toEqual(expected);
    });

    test("@pdfdeck/model bundles for the browser without any import", async () => {
        const config = { entrypoints: [join(PACKAGES_DIR, "model/src/index.ts")], target: "browser", format: "esm", metafile: true } as Parameters<typeof Bun.build>[0];
        const build = (await Bun.build(config)) as Awaited<ReturnType<typeof Bun.build>> & { metafile: { inputs: Record<string, { imports: { path: string }[] }> } };
        expect(build.success).toBe(true);
        expect(Object.values(build.metafile.inputs).flatMap(input => input.imports)).toEqual([]);
    });
});
