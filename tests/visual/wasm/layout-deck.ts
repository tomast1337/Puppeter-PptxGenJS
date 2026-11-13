// Text-layout deck for the WASM backend: features the Puppeteer renderer does not draw the same way
// (explicit tab stops), so they stay out of the shared fixture's gated crops.
import type PptxGenJS from "pptxgenjs";
import type { PuppeteerGen } from "../../../packages/pptxgenjs/src/node";

export const LAYOUT_PAGES = 1;

// Spread per call: PptxGenJS mutates the options object it is given.
const title = { x: 0.5, y: 0.2, w: 9, h: 0.5, fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0 } as const;
const body = { fontFace: "Arial", fontSize: 16, color: "363636", fill: { color: "F2F2F2" }, margin: 6, valign: "top" } as const;

export function populateLayoutDeck<T extends PptxGenJS | PuppeteerGen>(presentation: T): T {
    const tabs = presentation.addSlide();
    tabs.addText("Tab stops", { ...title });
    // No explicit stops: default stops every inch (defTabSz).
    tabs.addText("One\tTwo\tThree\nA\tBB\tCCC", { ...body, x: 0.5, y: 0.9, w: 9, h: 1 });
    // Left, right, center and decimal stops, then a default stop past the last one.
    tabs.addText("Item\tWidget\t1,250\tA\t12.5\tend\nTotal\tGadgets\t3\tBBB\t1024.75\tend", {
        ...body,
        x: 0.5,
        y: 2.1,
        w: 9,
        h: 1,
        tabStops: [
            { position: 1.2, alignment: "l" },
            { position: 4, alignment: "r" },
            { position: 5.5, alignment: "ctr" },
            { position: 7, alignment: "dec" },
        ],
    });
    return presentation;
}
