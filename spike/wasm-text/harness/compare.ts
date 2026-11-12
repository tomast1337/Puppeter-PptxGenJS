// Scores Puppeteer, WASM and native PDFs of the text deck against the same
// LibreOffice reference, with the tests/visual/compare.ts machinery
// (pdftoppm 96dpi, ImageMagick RMSE, crops padded like PARITY_REGIONS).
// Run inside the visual image: spike/wasm-text/scripts/docker.sh
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pptxgen from "pptxgenjs";
import { PuppeteerGen } from "../../../src/node";
import { PAGE_SIZES } from "../../../src/pageLayouts";
import { createRenderer, loadFonts } from "./backend";
import { populateTextDeck, TEXT_PAGES } from "./deck";
import { EMOJI_PAGES, populateEmojiDeck } from "./emoji-deck";

// `compare.ts [text|emoji]`; the emoji deck needs the spike image (spike/wasm-text/Dockerfile).
const deckName = process.argv[2] ?? "text";
const [populate, PAGES] = deckName === "emoji" ? [populateEmojiDeck, EMOJI_PAGES] : [populateTextDeck, TEXT_PAGES];

const out = join(process.env.SPIKE_OUT ?? "results", deckName);
mkdirSync(out, { recursive: true });

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

// 1. Reference: PptxGenJS -> PPTX -> LibreOffice PDF.
const reference = new pptxgen();
reference.defineLayout({ name: "PARITY", width: 10, height: 5.625 });
reference.layout = "PARITY";
populate(reference);
await reference.writeFile({ fileName: join(out, "reference.pptx") });
await run(["libreoffice", "--headless", `-env:UserInstallation=file://${join(out, "lo-profile")}`, "--convert-to", "pdf", "--outdir", out, join(out, "reference.pptx")]);

// 2. Puppeteer and the two Rust bindings from the same model.
const deck = populate(new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape));
writeFileSync(join(out, "puppeteer.pdf"), await deck.toPdf());
const model = deck.getModel();
const warnings: Record<string, string[]> = {};
for (const kind of ["wasm", "native"] as const) {
    const renderer = await createRenderer(kind);
    loadFonts(renderer);
    writeFileSync(join(out, `${kind}.pdf`), renderer.render(JSON.stringify(model)));
    warnings[kind] = renderer.warnings();
}
const sha = (file: string) => createHash("sha256").update(readFileSync(join(out, file))).digest("hex");
const identical = sha("wasm.pdf") === sha("native.pdf");

const engines = ["puppeteer", "wasm", "native"] as const;
for (const name of ["reference", ...engines]) {
    await run(["pdftoppm", "-png", "-r", "96", "-f", "1", "-l", String(PAGES), join(out, `${name}.pdf`), join(out, name)]);
}
// pdftoppm zero-pads page numbers to the document's page count.
const rendered = readdirSync(out);
const png = (name: string, page: number) => join(out, rendered.find(file => new RegExp(`^${name}-0*${page}\\.png$`).test(file))!);

// 3. Page RMSE and one crop per text object.
const pages = [];
for (let page = 1; page <= PAGES; page++) {
    const scores = Object.fromEntries(await Promise.all(engines.map(async e => [e, await rmse(png("reference", page), png(e, page))])));
    pages.push({ page, nonText: model.slides[page - 1]!.objects.filter(o => o.kind !== "text" && o.kind !== "shape").map(o => o.kind), ...scores });
}

const crops = [];
for (const [index, slide] of model.slides.entries()) {
    const page = index + 1;
    for (const object of slide.objects) {
        if (object.kind !== "text") continue;
        const { x, y, width = 0, height = 0 } = object.style.geometry;
        const x0 = Math.max(0, Math.floor(x) - 3);
        const y0 = Math.max(0, Math.floor(y) - 3);
        const geometry = `${Math.min(960 - x0, Math.ceil(width) + 7)}x${Math.min(540 - y0, Math.ceil(height) + 7)}+${x0}+${y0}`;
        const label = object.text.paragraphs.map(p => p.runs.map(r => r.text).join("")).join(" / ").slice(0, 40);
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

const median = (values: number[]) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)]!;
const summary = Object.fromEntries(engines.map(e => [e, { pageMedian: median(pages.map(p => p[e] as number)), cropMedian: median(crops.map(c => c[e] as number)), cropsUnder008: crops.filter(c => (c[e] as number) <= 0.08).length }]));
const result = { identical, sha: { wasm: sha("wasm.pdf"), native: sha("native.pdf") }, warnings, pages, crops, summary, cropCount: crops.length };
writeFileSync(join(out, "fidelity.json"), JSON.stringify(result, null, 2));

const f = (n: unknown) => (n as number).toFixed(4);
console.log("| page | non-text objects | Puppeteer | WASM | native |\n|---|---|---|---|---|");
for (const p of pages) console.log(`| ${p.page} | ${p.nonText.join(", ") || "-"} | ${f(p.puppeteer)} | ${f(p.wasm)} | ${f(p.native)} |`);
console.log("\n| crop | text | Puppeteer | WASM | native |\n|---|---|---|---|---|");
for (const c of crops) console.log(`| ${c.name} | ${c.label} | ${f(c.puppeteer)} | ${f(c.wasm)} | ${f(c.native)} |`);
console.log(`\nsummary: ${JSON.stringify(summary)}`);
console.log(`wasm.pdf and native.pdf byte-identical: ${identical}`);
console.log(`warnings: ${JSON.stringify(warnings.wasm)}`);
