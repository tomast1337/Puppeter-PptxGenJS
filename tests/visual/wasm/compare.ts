// Scores the WASM backend's PDFs (and, for context, the Puppeteer default's) against the same
// LibreOffice reference, with the tests/visual/compare.ts machinery (pdftoppm 96dpi, ImageMagick
// RMSE, crops padded like PARITY_REGIONS). Run in the pinned visual image:
//   bun run test:visual:wasm:docker [text|emoji ...]
//
// Gate (WASM only):
// - every page <= PAGE_THRESHOLD, the AGENTS.md whole-slide limit.
// - every deck: no crop scores worse than its committed baseline.json entry + EPSILON. Most crops
//   are still above the 0.08 target, so a fixed limit would either fail today or hide regressions
//   behind a loosened threshold; the baseline is a ratchet that only moves down.
// WASM_BASELINE_UPDATE=1 writes the measured scores to <out>/baseline.json; review the diff and copy
// it over tests/visual/wasm/baseline.json deliberately (CONTRIBUTING.md).
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pptxgen from "pptxgenjs";
import { PuppeteerGen } from "../../../packages/pptxgenjs/src/node";
import { PAGE_SIZES } from "../../../packages/pptxgenjs/src/pageLayouts";
import { createRenderer } from "./backend";
import baseline from "./baseline.json";
import { populateTextDeck, TEXT_PAGES } from "./deck";
import { EMOJI_PAGES, populateEmojiDeck } from "./emoji-deck";

const PAGE_THRESHOLD = 0.12;
// The pinned image makes scores repeatable to the last digit; 0.002 absorbs the 4-decimal rounding
// of baseline.json plus a few antialiased pixels, well below one misplaced glyph in a crop (~0.01).
const EPSILON = 0.002;

type Populate = <T extends pptxgen | PuppeteerGen>(presentation: T) => T;
// emoji: Noto Color Emoji / Noto Sans CJK fallback (issue #14), installed in the pinned image.
const DECKS: Record<string, { populate: Populate; pages: number }> = {
    text: { populate: populateTextDeck, pages: TEXT_PAGES },
    emoji: { populate: populateEmojiDeck, pages: EMOJI_PAGES },
};
const deckNames = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(DECKS);
const root = join(tmpdir(), "wasm-parity");

async function run(command: string[], ok = [0]): Promise<string> {
    const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (!ok.includes(code)) throw new Error(`${command.join(" ")} failed (${code})\n${stderr || stdout}`);
    return `${stdout}\n${stderr}`;
}

async function rmse(a: string, b: string): Promise<number> {
    const output = await run(["magick", "compare", "-metric", "RMSE", a, b, "null:"], [0, 1]);
    const value = output.match(/\((\d*\.?\d+(?:e-?\d+)?)\)/)?.[1];
    if (value === undefined) throw new Error(`cannot parse RMSE: ${output}`);
    return Number(value);
}

const f = (n: unknown) => (n as number).toFixed(4);
const median = (values: number[]) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)]!;
const failures: string[] = [];
const measured: Record<string, Record<string, number>> = {};

for (const deckName of deckNames) {
    const deckSpec = DECKS[deckName];
    if (!deckSpec) throw new Error(`unknown deck '${deckName}' (expected ${Object.keys(DECKS).join(", ")})`);
    const { populate, pages: PAGES } = deckSpec;
    const out = join(root, deckName);
    mkdirSync(out, { recursive: true });

    // 1. Reference: PptxGenJS -> PPTX -> LibreOffice PDF.
    const reference = new pptxgen();
    reference.defineLayout({ name: "PARITY", width: 10, height: 5.625 });
    reference.layout = "PARITY";
    populate(reference);
    await reference.writeFile({ fileName: join(out, "reference.pptx") });
    await run(["libreoffice", "--headless", `-env:UserInstallation=file://${join(out, "lo-profile")}`, "--convert-to", "pdf", "--outdir", out, join(out, "reference.pptx")]);

    // 2. The same deck through the Puppeteer default and the WASM backend.
    const deck = populate(new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape));
    writeFileSync(join(out, "puppeteer.pdf"), await deck.toPdf());
    const model = deck.getModel();
    const renderer = await createRenderer();
    writeFileSync(join(out, "wasm.pdf"), await populate(new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape, { renderer })).toPdf());
    const warnings = renderer.warnings();

    const engines = ["puppeteer", "wasm"] as const;
    for (const name of ["reference", ...engines]) {
        await run(["pdftoppm", "-png", "-r", "96", "-f", "1", "-l", String(PAGES), join(out, `${name}.pdf`), join(out, name)]);
    }
    // pdftoppm zero-pads page numbers to the document's page count.
    const rendered = readdirSync(out);
    const png = (name: string, page: number) =>
        join(
            out,
            rendered.find(file => new RegExp(`^${name}-0*${page}\\.png$`).test(file))!,
        );

    // 3. Page RMSE and one crop per text object.
    const pages: ({ page: number; nonText: string[] } & Record<string, unknown>)[] = [];
    for (let page = 1; page <= PAGES; page++) {
        const scores = Object.fromEntries(await Promise.all(engines.map(async e => [e, await rmse(png("reference", page), png(e, page))])));
        pages.push({ page, nonText: model.slides[page - 1]!.objects.filter(o => o.kind !== "text" && o.kind !== "shape").map(o => o.kind), ...scores });
    }

    const crops: Record<string, unknown>[] = [];
    for (const [index, slide] of model.slides.entries()) {
        const page = index + 1;
        for (const object of slide.objects) {
            if (object.kind !== "text") continue;
            const { x, y, width = 0, height = 0 } = object.style.geometry;
            const x0 = Math.max(0, Math.floor(x) - 3);
            const y0 = Math.max(0, Math.floor(y) - 3);
            const geometry = `${Math.min(960 - x0, Math.ceil(width) + 7)}x${Math.min(540 - y0, Math.ceil(height) + 7)}+${x0}+${y0}`;
            const label = object.text.paragraphs
                .map(p => p.runs.map(r => r.text).join(""))
                .join(" / ")
                .slice(0, 40);
            const name = `p${page}-${object.style.objectName.replace(/\W+/g, "")}`;
            const files: Record<string, string> = {};
            for (const engine of ["reference", ...engines]) {
                files[engine] = join(out, `crop-${name}-${engine}.png`);
                await run(["magick", png(engine, page), "-crop", geometry, "+repage", files[engine]!]);
            }
            const scores = Object.fromEntries(await Promise.all(engines.map(async e => [e, await rmse(files.reference!, files[e]!)])));
            crops.push({ page, name, label, ...scores });
            // Side-by-side for eyeballing: reference | puppeteer | wasm.
            await run(["magick", "montage", "-label", "%t", files.reference!, files.puppeteer!, files.wasm!, "-tile", "3x", "-geometry", "+6+6", "-pointsize", "10", join(out, `montage-${name}.png`)]);
        }
    }

    const summary = Object.fromEntries(engines.map(e => [e, { pageMedian: median(pages.map(p => p[e] as number)), cropMedian: median(crops.map(c => c[e] as number)), cropsUnder008: crops.filter(c => (c[e] as number) <= 0.08).length }]));
    writeFileSync(join(out, "fidelity.json"), JSON.stringify({ warnings, pages, crops, summary, cropCount: crops.length }, null, 2));

    // 4. Gate the WASM scores.
    const expected = (baseline as Record<string, Record<string, number>>)[deckName] ?? {};
    measured[deckName] = Object.fromEntries(crops.map(c => [c.name as string, Number(f(c.wasm))]));
    const improved: string[] = [];
    console.log(`\n## ${deckName} deck (${out})\n\n| page | non-text objects | Puppeteer | WASM |\n|---|---|---|---|`);
    for (const p of pages) {
        const fail = (p.wasm as number) > PAGE_THRESHOLD;
        if (fail) failures.push(`${deckName} page ${p.page}: WASM ${f(p.wasm)} > ${PAGE_THRESHOLD}`);
        console.log(`| ${p.page} | ${p.nonText.join(", ") || "-"} | ${f(p.puppeteer)} | ${f(p.wasm)}${fail ? " FAIL" : ""} |`);
    }
    console.log(`\n| crop | text | Puppeteer | WASM | baseline |\n|---|---|---|---|---|`);
    for (const c of crops) {
        const name = c.name as string;
        const limit = expected[name];
        let status = "";
        if (limit === undefined) {
            failures.push(`${deckName} crop ${name}: no baseline entry`);
            status = " FAIL (no baseline)";
        } else if ((c.wasm as number) > limit + EPSILON) {
            failures.push(`${deckName} crop ${name}: WASM ${f(c.wasm)} > baseline ${f(limit)} + ${EPSILON}`);
            status = " FAIL";
        } else if ((c.wasm as number) < limit - EPSILON) improved.push(name);
        console.log(`| ${name} | ${c.label} | ${f(c.puppeteer)} | ${f(c.wasm)}${status} | ${limit === undefined ? "-" : f(limit)} |`);
    }
    for (const stale of Object.keys(expected).filter(name => !(name in measured[deckName]!))) failures.push(`${deckName} crop ${stale}: in baseline.json but no longer measured`);
    if (improved.length) console.log(`\nImproved beyond ${EPSILON}: ${improved.join(", ")}. Ratchet them down with WASM_BASELINE_UPDATE=1.`);
    console.log(`\nsummary: ${JSON.stringify(summary)}`);
    console.log(`warnings: ${JSON.stringify(warnings)}`);
}

if (process.env.WASM_BASELINE_UPDATE === "1") {
    const next = { ...baseline, ...measured };
    writeFileSync(join(root, "baseline.json"), `${JSON.stringify(next, null, 2)}\n`);
    console.log(`\nWrote ${join(root, "baseline.json")}; review it and copy it to tests/visual/wasm/baseline.json.`);
} else if (failures.length) {
    console.error(`\nWASM visual parity failed:\n- ${failures.join("\n- ")}`);
    process.exit(1);
} else {
    console.log(`\nWASM visual parity passed: pages <= ${PAGE_THRESHOLD}, every crop within ${EPSILON} of baseline.json.`);
}
