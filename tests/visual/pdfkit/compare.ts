// Scores the PDFKit backend's PDFs against the same LibreOffice reference as the WASM decks, next to the Puppeteer
// default's and the WASM backend's, with the tests/visual/wasm/compare.ts machinery (pdftoppm 96dpi, ImageMagick RMSE,
// crops padded by 3 px). Run in the pinned visual image:
//   bun run test:visual:pdfkit:docker [text|images|shapes|options|tables|tableOptions ...]
//
// No gate and no baseline: the backend is a spike (#310), so this prints the score tables and writes
// <out>/<deck>/fidelity.json plus a reference | puppeteer | wasm | pdfkit montage per crop for eyeballing.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pptxgen from "pptxgenjs";
import { createPdfkitRenderer, loadSystemFonts } from "../../../packages/pdfkit/src/node";
import { PuppeteerGen } from "../../../packages/pptxgenjs/src/node";
import { PAGE_SIZES } from "../../../packages/pptxgenjs/src/pageLayouts";
import { CROP_TARGET, PAGE_THRESHOLD } from "../thresholds";
import { createRenderer as createWasmRenderer } from "../wasm/backend";
import { DECKS } from "../wasm/decks";

const DEFAULT_DECKS = ["text", "images", "shapes", "options", "tables", "tableOptions"];
const deckNames = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_DECKS;
const root = join(tmpdir(), "pdfkit-parity");
const ENGINES = ["puppeteer", "wasm", "pdfkit"] as const;
type Engine = (typeof ENGINES)[number];

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

const f = (n: number) => n.toFixed(4);
const median = (values: number[]) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN;
const fonts = await loadSystemFonts({ dirs: process.env.FONT_DIRS?.split(":") });
const pdfkit = await createPdfkitRenderer({ fonts, onUnsupported: "warn", onMissingFont: "ignore" });
const wasm = await createWasmRenderer();
const overall: Record<string, Record<Engine, { pageMedian: number; cropMedian: number; cropsUnder008: number }>> = {};

for (const deckName of deckNames) {
    const deckSpec = DECKS[deckName];
    if (!deckSpec) throw new Error(`unknown deck '${deckName}' (expected ${Object.keys(DECKS).join(", ")})`);
    const { populate, pages: PAGES, crop } = deckSpec;
    const out = join(root, deckName);
    mkdirSync(out, { recursive: true });

    const reference = new pptxgen();
    reference.defineLayout({ name: "PARITY", width: 10, height: 5.625 });
    reference.layout = "PARITY";
    populate(reference);
    await reference.writeFile({ fileName: join(out, "reference.pptx") });
    await run(["libreoffice", "--headless", `-env:UserInstallation=file://${join(out, "lo-profile")}`, "--convert-to", "pdf", "--outdir", out, join(out, "reference.pptx")]);

    const deck = populate(new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape));
    writeFileSync(join(out, "puppeteer.pdf"), await deck.toPdf());
    const model = { slides: deck.getModel().slides.filter(slide => !slide.hidden) };
    writeFileSync(join(out, "wasm.pdf"), await populate(new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape, { renderer: wasm })).toPdf());
    const started = performance.now();
    writeFileSync(join(out, "pdfkit.pdf"), await populate(new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape, { renderer: pdfkit })).toPdf());
    const pdfkitMs = performance.now() - started;
    const warnings = pdfkit.warnings();

    for (const name of ["reference", ...ENGINES]) {
        await run(["pdftoppm", "-png", "-r", "96", "-f", "1", "-l", String(PAGES), join(out, `${name}.pdf`), join(out, name)]);
    }
    const rendered = readdirSync(out);
    const png = (name: string, page: number) => {
        const file = rendered.find(entry => new RegExp(`^${name}-0*${page}\\.png$`).test(entry));
        if (!file) throw new Error(`${name}.pdf has no page ${page}`);
        return join(out, file);
    };

    const pages: ({ page: number } & Record<Engine, number>)[] = [];
    for (let page = 1; page <= PAGES; page++) {
        const scores = await Promise.all(ENGINES.map(engine => rmse(png("reference", page), png(engine, page))));
        pages.push({ page, puppeteer: scores[0] ?? Number.NaN, wasm: scores[1] ?? Number.NaN, pdfkit: scores[2] ?? Number.NaN });
    }

    const crops: ({ page: number; name: string; label: string } & Record<Engine, number>)[] = [];
    for (const [index, slide] of model.slides.entries()) {
        const page = index + 1;
        for (const object of slide.objects) {
            if (!crop(object)) continue;
            const { x, y, width = 0, height = 0 } = object.style.geometry;
            const x0 = Math.max(0, Math.floor(x) - 3);
            const y0 = Math.max(0, Math.floor(y) - 3);
            const geometry = `${Math.min(960 - x0, Math.ceil(width) + 7)}x${Math.min(540 - y0, Math.ceil(height) + 7)}+${x0}+${y0}`;
            const text = object.kind === "text" ? object.text.paragraphs.map(p => p.runs.map(r => r.text).join("")).join(" / ") : "";
            const label = text.slice(0, 40) || object.kind;
            const name = `p${page}-${object.style.objectName.replace(/\W+/g, "")}`;
            const files = Object.fromEntries(["reference", ...ENGINES].map(engine => [engine, join(out, `crop-${name}-${engine}.png`)]));
            for (const [engine, file] of Object.entries(files)) await run(["magick", png(engine, page), "-crop", geometry, "+repage", file]);
            const reference = files.reference ?? "";
            const scores = await Promise.all(ENGINES.map(engine => rmse(reference, files[engine] ?? "")));
            crops.push({ page, name, label, puppeteer: scores[0] ?? Number.NaN, wasm: scores[1] ?? Number.NaN, pdfkit: scores[2] ?? Number.NaN });
            await run(["magick", "montage", "-label", "%t", reference, ...ENGINES.map(engine => files[engine] ?? ""), "-tile", "4x", "-geometry", "+6+6", "-pointsize", "10", join(out, `montage-${name}.png`)]);
        }
    }

    const summary = Object.fromEntries(ENGINES.map(engine => [engine, { pageMedian: median(pages.map(p => p[engine])), cropMedian: median(crops.map(c => c[engine])), cropsUnder008: crops.filter(c => c[engine] <= CROP_TARGET).length }])) as Record<
        Engine,
        { pageMedian: number; cropMedian: number; cropsUnder008: number }
    >;
    overall[deckName] = summary;
    writeFileSync(join(out, "fidelity.json"), JSON.stringify({ warnings, pages, crops, summary, cropCount: crops.length, pdfkitMs }, null, 2));

    console.log(`\n## ${deckName} deck (${out}), PDFKit render ${Math.round(pdfkitMs)} ms\n\n| page | Puppeteer | WASM | PDFKit |\n|---|---|---|---|`);
    for (const p of pages) console.log(`| ${p.page} | ${f(p.puppeteer)} | ${f(p.wasm)} | ${f(p.pdfkit)}${p.pdfkit > PAGE_THRESHOLD ? " (> page limit)" : ""} |`);
    console.log(`\n| crop | text | Puppeteer | WASM | PDFKit |\n|---|---|---|---|---|`);
    for (const c of crops) console.log(`| ${c.name} | ${c.label.replaceAll("|", "\\|")} | ${f(c.puppeteer)} | ${f(c.wasm)} | ${f(c.pdfkit)} |`);
    console.log(`\nPDFKit warnings (${warnings.length}):\n${warnings.map(warning => `- ${warning}`).join("\n")}`);
}

console.log(`\n## Summary\n\n| deck | engine | page median | crop median | crops <= ${CROP_TARGET} |\n|---|---|---|---|---|`);
for (const [deckName, summary] of Object.entries(overall)) {
    for (const engine of ENGINES) console.log(`| ${deckName} | ${engine} | ${f(summary[engine].pageMedian)} | ${f(summary[engine].cropMedian)} | ${summary[engine].cropsUnder008} |`);
}
