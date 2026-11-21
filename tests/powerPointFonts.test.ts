import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PPTX_DEFAULTS } from "../packages/pptxgenjs/src/defaults";
import { checkPowerPointFonts } from "../packages/pptxgenjs/src/node";
import { POWERPOINT_FACES, RENDERING_TARGETS } from "../packages/pptxgenjs/src/target";

const names = POWERPOINT_FACES.map(({ name }) => name);
const USAGE = resolve(import.meta.dir, "../docs/USAGE.md");

describe("POWERPOINT_FACES", () => {
    test("lists the theme defaults, every face of the fallback chains and the emoji face, each once", () => {
        const { fallbackFaces, eastAsianFallback, emojiFace } = RENDERING_TARGETS.powerpoint;
        const chains = [...fallbackFaces, ...Object.values(eastAsianFallback.byFace).flat(), ...eastAsianFallback.otherFaces, ...(emojiFace === undefined ? [] : [emojiFace])];
        const expected = [PPTX_DEFAULTS.theme.bodyFontFace, PPTX_DEFAULTS.theme.headFontFace, PPTX_DEFAULTS.chart.fontFace, ...chains];

        expect(new Set(names)).toEqual(new Set(expected));
        expect(names.length).toBe(new Set(names).size);
    });

    test("is the table in docs/USAGE.md", async () => {
        const section = (await readFile(USAGE, "utf8")).split("### Fonts for the PowerPoint target")[1] ?? "";
        const rows = section
            .split("\n")
            .filter(line => line.startsWith("| ") && !line.startsWith("| Face") && !line.startsWith("| --"))
            .map(line =>
                line
                    .split("|")
                    .slice(1, -1)
                    .map(cell => cell.trim()),
            );

        expect(rows).toEqual(POWERPOINT_FACES.map(({ name, role, withoutIt }) => [name, role, withoutIt]));
    });
});

describe("checkPowerPointFonts", () => {
    test("reports the target's faces and the deck's by the injected family listing, without case", () => {
        const installed = ["calibri", "ARIAL", "Segoe UI Emoji", "my brand sans", "Noto Sans CJK JP"];
        const { present, missing } = checkPowerPointFonts({ faces: ["My Brand Sans", "My Brand Serif", "arial"], installedFamilies: installed });

        expect(present).toEqual(["Calibri", "Arial", "Segoe UI Emoji", "My Brand Sans"]);
        expect(missing).toEqual([...names.filter(name => !present.includes(name)), "My Brand Serif"]);
    });

    test("reports every face missing when nothing is installed, and does not throw", () => {
        expect(checkPowerPointFonts({ installedFamilies: [] })).toEqual({ present: [], missing: names });
    });
});
