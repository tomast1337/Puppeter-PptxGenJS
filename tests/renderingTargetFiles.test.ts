import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

// Each rendering target's quirks live in packages/pptxgenjs/src/target/<target>.ts: normalization reads the flags of
// RenderingTargetProfile and never a target's name, so a new target is one new file plus its RENDERING_TARGETS entry.
const SRC = resolve(import.meta.dir, "../packages/pptxgenjs/src");
const TARGET_NAME = /["'`](?:powerpoint|libreoffice)["'`]/;
// The entry classes that pick a target by name (PuppeteerGenLibreOffice, PuppeteerGenPowerPoint).
const NAMES_TARGET = new Set(["node.ts"]);
const TARGET_FILE_IMPORT = /from\s*["'][^"']*(?:target\/|\.\/)(?:powerpoint|libreoffice)["']/;

async function sources(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(entry => (entry.isDirectory() ? sources(join(directory, entry.name)) : entry.name.endsWith(".ts") ? [join(directory, entry.name)] : [])));

    return nested.flat();
}

const isComment = (line: string) => /^\s*(?:\/\/|\/\*|\*)/.test(line);

describe("rendering target files", () => {
    test("only src/target/ names a target, outside the entry classes and comments", async () => {
        const named = [];

        for (const file of await sources(SRC)) {
            const path = relative(SRC, file);

            if (path.startsWith("target/") || NAMES_TARGET.has(path)) {
                continue;
            }

            const lines = (await readFile(file, "utf8")).split("\n");

            for (const [index, line] of lines.entries()) {
                if (TARGET_NAME.test(line) && !isComment(line)) {
                    named.push(`${path}:${index + 1}`);
                }
            }
        }

        expect(named).toEqual([]);
    });

    test("only target/index.ts imports a target's file", async () => {
        const importers = [];

        for (const file of await sources(SRC)) {
            if (TARGET_FILE_IMPORT.test(await readFile(file, "utf8"))) {
                importers.push(relative(SRC, file));
            }
        }

        expect(importers).toEqual(["target/index.ts"]);
    });
});
