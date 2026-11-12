// Cold start and per-deck time for the text deck: Puppeteer vs WASM vs native.
// `bun bench.ts` spawns fresh processes for cold numbers, then runs warm loops.
// Medians over BENCH_RUNS (default 20 warm, 7 cold).
import { writeFileSync } from "node:fs";
import { join } from "node:path";

type Engine = "puppeteer" | "wasm" | "native";
const median = (values: number[]) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)]!;

async function deck() {
    const [{ PuppeteerGen }, { PAGE_SIZES }, { populateTextDeck }] = await Promise.all([import("../../../src/node"), import("../../../src/pageLayouts"), import("./deck")]);
    return populateTextDeck(new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape));
}

/** One engine in this process: returns [setupMs, firstDeckMs] measured from before its first import. */
async function cold(engine: Engine): Promise<{ setup: number; firstDeck: number; firstRender?: number }> {
    const t0 = performance.now();
    if (engine === "puppeteer") {
        const pdf = await (await deck()).toPdf();
        if (!pdf.length) throw new Error("empty pdf");
        return { setup: 0, firstDeck: performance.now() - t0 };
    }
    const { createRenderer, loadFonts } = await import("./backend");
    const renderer = await createRenderer(engine);
    loadFonts(renderer);
    const t1 = performance.now();
    const json = JSON.stringify((await deck()).getModel());
    const t2 = performance.now();
    renderer.render(json);
    // firstDeck = model build (imports src/, jsdom) + first render; firstRender is the WASM/native part.
    return { setup: t1 - t0, firstDeck: performance.now() - t1, firstRender: performance.now() - t2 };
}

if (process.argv[2] === "cold") {
    console.log(JSON.stringify(await cold(process.argv[3] as Engine)));
    process.exit(0);
}

const warmRuns = Number(process.env.BENCH_RUNS ?? 20);
const coldRuns = Number(process.env.BENCH_COLD_RUNS ?? 7);
const engines: Engine[] = ["puppeteer", "wasm", "native"];
const results: Record<string, unknown> = {};

for (const engine of engines) {
    const setups: number[] = [];
    const firsts: number[] = [];
    const walls: number[] = [];
    const firstRenders: number[] = [];
    for (let i = 0; i < coldRuns; i++) {
        const start = performance.now();
        const child = Bun.spawn(["bun", import.meta.path, "cold", engine], { stdout: "pipe", stderr: "inherit" });
        const output = await new Response(child.stdout).text();
        if ((await child.exited) !== 0) throw new Error(`cold ${engine} failed`);
        walls.push(performance.now() - start);
        const { setup, firstDeck, firstRender } = JSON.parse(output.trim().split("\n").at(-1)!);
        if (firstRender !== undefined) firstRenders.push(firstRender);
        setups.push(setup);
        firsts.push(firstDeck);
    }

    // Warm: same process, engine already initialised.
    const deckMs: number[] = [];
    const renderMs: number[] = [];
    let size = 0;
    if (engine === "puppeteer") {
        await (await deck()).toPdf();
        for (let i = 0; i < warmRuns; i++) {
            const start = performance.now();
            size = (await (await deck()).toPdf()).length;
            deckMs.push(performance.now() - start);
        }
    } else {
        const { createRenderer, loadFonts } = await import("./backend");
        const renderer = await createRenderer(engine);
        loadFonts(renderer);
        renderer.render(JSON.stringify((await deck()).getModel()));
        for (let i = 0; i < warmRuns; i++) {
            const start = performance.now();
            const json = JSON.stringify((await deck()).getModel());
            const t = performance.now();
            size = renderer.render(json).length;
            renderMs.push(performance.now() - t);
            deckMs.push(performance.now() - start);
        }
    }
    results[engine] = {
        coldSetupMs: median(setups),
        coldFirstDeckMs: median(firsts),
        coldFirstRenderMs: firstRenders.length ? median(firstRenders) : undefined,
        coldProcessWallMs: median(walls),
        warmDeckMs: median(deckMs),
        warmRenderOnlyMs: renderMs.length ? median(renderMs) : undefined,
        pdfBytes: size,
    };
    console.log(engine, JSON.stringify(results[engine]));
}
if (process.env.SPIKE_OUT) writeFileSync(join(process.env.SPIKE_OUT, "bench.json"), JSON.stringify({ warmRuns, coldRuns, results }, null, 2));
process.exit(0);
