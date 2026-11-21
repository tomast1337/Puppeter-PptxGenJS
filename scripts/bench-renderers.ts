// Cold start and per-deck time for the text deck on every renderer: the Puppeteer default, WASM and PDFKit,
// each through PuppeteerGen.toPdf(), which hands it the toHtml() document. `bun run bench:renderers` spawns
// fresh processes for cold numbers, then runs warm loops. Medians over BENCH_RUNS (default 20 warm, 7 cold).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PdfkitRenderer } from "../packages/pdfkit/src/node";
import type { WasmRenderer } from "../packages/wasm/src/node";
import { benchRuns } from "./benchConfig";

const ENGINES = ["puppeteer", "wasm", "pdfkit"] as const;

type Engine = (typeof ENGINES)[number];
/** The renderer each engine hands PuppeteerGen: the Node entry's Puppeteer default, or a WASM or PDFKit renderer. */
type Backend = { readonly kind: "puppeteer" } | { readonly kind: "wasm"; readonly renderer: WasmRenderer } | { readonly kind: "pdfkit"; readonly renderer: PdfkitRenderer };
const median = (values: number[]) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)]!;

async function deckPdf(backend: Backend): Promise<Uint8Array> {
    const [{ PuppeteerGen }, { PAGE_SIZES }, { populateTextDeck }] = await Promise.all([import("../packages/pptxgenjs/src/node"), import("../packages/pptxgenjs/src/pageLayouts"), import("../tests/visual/wasm/deck")]);
    const page = PAGE_SIZES.SCREEN_16X9.landscape;

    return populateTextDeck(new PuppeteerGen(page, { renderer: backend.kind === "puppeteer" ? undefined : backend.renderer })).toPdf();
}

async function setup(engine: Engine): Promise<Backend> {
    if (engine === "puppeteer") {
        return { kind: "puppeteer" };
    }

    if (engine === "wasm") {
        const { createRenderer } = await import("../tests/visual/wasm/backend");

        return { kind: "wasm", renderer: await createRenderer() };
    }

    // Like the WASM backend: system fonts once per process, unsupported objects reported, not thrown.
    const { createPdfkitRenderer, loadSystemFonts } = await import("../packages/pdfkit/src/node");

    return { kind: "pdfkit", renderer: await createPdfkitRenderer({ fonts: await loadSystemFonts({ dirs: process.env.FONT_DIRS?.split(":") }), onUnsupported: "warn" }) };
}

if (process.argv[2] === "cold") {
    // One engine in this process: setup and first deck, measured from before its first import.
    const t0 = performance.now();
    const backend = await setup(process.argv[3] as Engine);
    const t1 = performance.now();

    if (!(await deckPdf(backend)).length) {
        throw new Error("empty pdf");
    }

    console.log(JSON.stringify({ setup: t1 - t0, firstDeck: performance.now() - t1 }));
    process.exit(0);
}

const warmRuns = benchRuns("rendererWarm");
const coldRuns = Number(process.env.BENCH_COLD_RUNS ?? 7);
const results: Record<string, unknown> = {};

for (const engine of ENGINES) {
    const setups: number[] = [];
    const firsts: number[] = [];
    const walls: number[] = [];

    for (let i = 0; i < coldRuns; i++) {
        const start = performance.now();
        const child = Bun.spawn(["bun", import.meta.path, "cold", engine], { stdout: "pipe", stderr: "inherit" });
        const output = await new Response(child.stdout).text();

        if ((await child.exited) !== 0) {
            throw new Error(`cold ${engine} failed`);
        }

        walls.push(performance.now() - start);
        const { setup, firstDeck } = JSON.parse(output.trim().split("\n").at(-1)!);

        setups.push(setup);
        firsts.push(firstDeck);
    }

    // Warm: same process, engine already initialised. Deck time includes the model and toHtml() builds.
    const backend = await setup(engine);

    await deckPdf(backend);
    const deckMs: number[] = [];
    let size = 0;

    for (let i = 0; i < warmRuns; i++) {
        const start = performance.now();

        size = (await deckPdf(backend)).length;
        deckMs.push(performance.now() - start);
    }

    results[engine] = { coldSetupMs: median(setups), coldFirstDeckMs: median(firsts), coldProcessWallMs: median(walls), warmDeckMs: median(deckMs), pdfBytes: size };
    console.log(engine, JSON.stringify(results[engine]));
}

if (process.env.BENCH_OUT) {
    writeFileSync(join(process.env.BENCH_OUT, "bench.json"), JSON.stringify({ warmRuns, coldRuns, results }, null, 2));
}

process.exit(0);
