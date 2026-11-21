import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { galleryPageTitles, writeVisualGallery } from "./visual/gallery";
import { populateParityFixture } from "./visual/fixture";

// The gallery (`bun run test:visual:gallery`) once kept its page titles by hand and threw when the fixture grew (#225).
describe("visual gallery", () => {
    test("titles every page the fixture prints, and writes one row per page", async () => {
        const fixture = new PuppeteerGen();

        populateParityFixture(fixture);
        const titles = galleryPageTitles(fixture.getModel());
        // One body child per printed page in the HTML the renderers draw.
        const pages = new JSDOM((await fixture.toHtml()).html).window.document.body.children.length;

        expect(titles).toHaveLength(pages);
        expect(titles[0]).toBe("PuppeteerGen visual parity");
        expect(titles.every(title => title.length > 0)).toBe(true);

        const artifacts = await mkdtemp(join(tmpdir(), "pdflapas-gallery-"));
        const gallery = titles.map((title, index) => {
            const page = String(index + 1).padStart(2, "0");

            return { page, title, referenceName: `${page}-reference.png`, actualName: `${page}-actual.png` };
        });

        await Promise.all(gallery.flatMap(page => [writeFile(join(artifacts, page.referenceName), ""), writeFile(join(artifacts, page.actualName), "")]));
        await writeVisualGallery(
            artifacts,
            gallery,
            titles.map(() => 0),
            0.12,
            join(artifacts, "gallery"),
        );
        const readme = await readFile(join(artifacts, "gallery", "README.md"), "utf8");

        expect(readme.match(/^\| \*\*\d+ — /gm)).toHaveLength(pages);
        expect(readme).toContain(`| **01 — PuppeteerGen visual parity** (\`0.0000\`)`);
        await rm(artifacts, { recursive: true, force: true });
    }, 60_000);

    test("names a page without text by the kinds of object on it", () => {
        const deck = new PuppeteerGen();

        deck.addSlide().addShape("rect", { x: 0, y: 0, w: 1, h: 1 });
        const hidden = deck.addSlide();

        hidden.addText("Hidden", { x: 0, y: 0, w: 1, h: 1 });
        hidden.hidden = true;
        deck.addSlide().addText("Shown", { x: 0, y: 0, w: 1, h: 1 });
        expect(galleryPageTitles(deck.getModel())).toEqual(["Untitled: shape", "Shown"]);
    });
});
