import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { populateParityFixture } from "./visual/fixture";

async function fixtureHtml(): Promise<string> {
    const pres = new PuppeteerGen();
    populateParityFixture(pres);
    return (await pres.toHtml()).html;
}

// The same deck must give byte-identical toHtml() output so two versions of a deck diff as HTML (#66).
describe("toHtml() determinism", () => {
    test("building the shared fixture twice in one process gives the same HTML", async () => {
        expect(await fixtureHtml()).toBe(await fixtureHtml());
    });

    test("a deck built after other decks gives the same HTML as in a fresh process", async () => {
        const other = new PuppeteerGen();
        other.addSlide().addChart("bar", [{ name: "S", labels: ["A", "B"], values: [1, 2] }], { x: 0, y: 0, w: 4, h: 3 });
        other.addSlide().addChartEx({ renderer: "echarts", option: { xAxis: { data: ["A"] }, yAxis: {}, series: [{ type: "bar", data: [4] }] } }, { x: 0, y: 0, w: 4, h: 3 });
        await other.toHtml();
        const afterOthers = await fixtureHtml();

        const script = `import { PuppeteerGen } from ${JSON.stringify(resolve(import.meta.dir, "../packages/pptxgenjs/src/node"))};
import { populateParityFixture } from ${JSON.stringify(resolve(import.meta.dir, "visual/fixture"))};
const pres = new PuppeteerGen();
populateParityFixture(pres);
process.stdout.write((await pres.toHtml()).html);`;
        const fresh = Bun.spawnSync([process.execPath, "-e", script], { cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
        expect(fresh.stderr.toString()).toBe("");
        expect(fresh.exitCode).toBe(0);
        expect(fresh.stdout.toString()).toBe(afterOthers);
    }, 60_000);

    test("chart SVGs carry no counter-numbered names and their ids are unique in the document", async () => {
        const html = await fixtureHtml();
        expect(html).not.toMatch(/\bzr\d+-/);
        const chartIds = [...html.matchAll(/ id="(slide-\d+-object-\d+-[^"]+)"/g)].map(match => match[1]);
        expect(chartIds.length).toBeGreaterThan(0);
        expect(new Set(chartIds).size).toBe(chartIds.length);
    });
});
