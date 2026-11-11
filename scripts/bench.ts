// Measures writeFile wall time: sequential and concurrent decks.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PuppeteerGen } from "../src/PuppeterrGen";

const RUNS = Number(process.env.BENCH_RUNS ?? 5);
const dir = await mkdtemp(join(tmpdir(), "puppeteer-gen-bench-"));

function deck() {
    const pres = new PuppeteerGen();
    for (let i = 0; i < 5; i++) {
        const slide = pres.addSlide();
        slide.addText(`Slide ${i + 1}`, { x: 1, y: 1, w: 8, h: 1, fontSize: 32, bold: true });
        slide.addShape("rect", { x: 1, y: 2.5, w: 3, h: 1.5, fill: { color: "4472C4" } });
        slide.addTable([[{ text: "A" }, { text: "B" }], [{ text: "1" }, { text: "2" }]], { x: 5, y: 2.5, w: 4 });
    }
    return pres;
}

try {
    const sequential: number[] = [];
    for (let i = 0; i < RUNS; i++) {
        const start = performance.now();
        await deck().writeFile({ fileName: join(dir, `seq-${i}.pdf`) });
        sequential.push(performance.now() - start);
    }
    const start = performance.now();
    await Promise.all(Array.from({ length: RUNS }, (_, i) => deck().writeFile({ fileName: join(dir, `par-${i}.pdf`) })));
    const concurrent = performance.now() - start;

    const fmt = (ms: number) => `${ms.toFixed(0)}ms`;
    console.log(`sequential: first ${fmt(sequential[0]!)}, mean ${fmt(sequential.reduce((a, b) => a + b, 0) / RUNS)}, all [${sequential.map(fmt).join(", ")}]`);
    console.log(`concurrent x${RUNS}: ${fmt(concurrent)}`);
} finally {
    await rm(dir, { recursive: true, force: true });
}
