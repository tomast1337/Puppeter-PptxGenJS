// Cold start and per-deck time for the text deck: Puppeteer default vs the WASM backend,
// both through PuppeteerGen.toPdf(). `bun bench.ts` spawns fresh processes for cold numbers,
// then runs warm loops. Medians over BENCH_RUNS (default 20 warm, 7 cold).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelRenderer } from "../../../src/render/document";

type Engine = "puppeteer" | "wasm";
const median = (values: number[]) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)]!;

async function deckPdf(renderer?: ModelRenderer): Promise<Uint8Array> {
    const [{ PuppeteerGen }, { PAGE_SIZES }, { populateTextDeck }] = await Promise.all([import("../../../src/node"), import("../../../src/pageLayouts"), import("./deck")]);
    return populateTextDeck(new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape, { renderer })).toPdf();
}

async function setup(engine: Engine): Promise<ModelRenderer | undefined> {
    if (engine === "puppeteer") return undefined;
    const { createRenderer } = await import("./backend");
    return createRenderer();
}

/** One engine in this process: [setupMs, firstDeckMs] measured from before its first import. */
async function cold(engine: Engine): Promise<{ setup: number; firstDeck: number }> {
    const t0 = performance.now();
    const renderer = await setup(engine);
    const t1 = performance.now();
    if (!(await deckPdf(renderer)).length) throw new Error("empty pdf");
    return { setup: t1 - t0, firstDeck: performance.now() - t1 };
}

if (process.argv[2] === "cold") {
    console.log(JSON.stringify(await cold(process.argv[3] as Engine)));
    process.exit(0);
}

const warmRuns = Number(process.env.BENCH_RUNS ?? 20);
const coldRuns = Number(process.env.BENCH_COLD_RUNS ?? 7);
const results: Record<string, unknown> = {};

for (const engine of ["puppeteer", "wasm"] as const) {
    const setups: number[] = [];
    const firsts: number[] = [];
    const walls: number[] = [];
    for (let i = 0; i < coldRuns; i++) {
        const start = performance.now();
        const child = Bun.spawn(["bun", import.meta.path, "cold", engine], { stdout: "pipe", stderr: "inherit" });
        const output = await new Response(child.stdout).text();
        if ((await child.exited) !== 0) throw new Error(`cold ${engine} failed`);
        walls.push(performance.now() - start);
        const { setup, firstDeck } = JSON.parse(output.trim().split("\n").at(-1)!);
        setups.push(setup);
        firsts.push(firstDeck);
    }

    // Warm: same process, engine already initialised. Deck time includes the JSDOM model build.
    const renderer = await setup(engine);
    await deckPdf(renderer);
    const deckMs: number[] = [];
    let size = 0;
    for (let i = 0; i < warmRuns; i++) {
        const start = performance.now();
        size = (await deckPdf(renderer)).length;
        deckMs.push(performance.now() - start);
    }
    results[engine] = { coldSetupMs: median(setups), coldFirstDeckMs: median(firsts), coldProcessWallMs: median(walls), warmDeckMs: median(deckMs), pdfBytes: size };
    console.log(engine, JSON.stringify(results[engine]));
}
if (process.env.SPIKE_OUT) writeFileSync(join(process.env.SPIKE_OUT, "bench.json"), JSON.stringify({ warmRuns, coldRuns, results }, null, 2));
process.exit(0);
