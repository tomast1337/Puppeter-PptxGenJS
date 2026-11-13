import type { PuppeteerGen as CorePuppeteerGen } from "../packages/pptxgenjs/src/PuppeteerGen";

/**
 * Runs in Node and, from its source text, in Chromium (tests/htmlBrowser.test.ts), so it uses only its
 * arguments. It covers the values the CSSOM serializes differently per runtime: float lengths, hex colors,
 * padding and quoted font families.
 * shortcut: no chart, because ECharts' SVG still differs between jsdom and Chromium; add one when chart
 * output is runtime-independent (charts stay an opaque subtree until #69 phase 8).
 */
export function buildCrossRuntimeDeck(Gen: typeof CorePuppeteerGen, png: string): CorePuppeteerGen {
    const pres = new Gen();
    pres.registerComponent("test/badge", 1, { render: props => `<strong style="color: #17365D">${String(props.label)}</strong>` });
    const slide = pres.addSlide();
    slide.color = "17365D";
    slide.addText(
        [
            { text: "Bullet", options: { bullet: true, fontFace: "Arial", color: "17365D", breakLine: true } },
            { text: "Sub", options: { subscript: true, underline: { style: "dbl", color: "FF0000" }, glow: { size: 4, opacity: 0.5, color: "00FF00" } } },
        ],
        { x: 0.15, y: 0.35, w: 3.33, h: 1.1, margin: 0, fill: { color: "F2F2F2" }, line: { color: "A6A6A6", width: 0.75 }, shadow: { type: "outer", blur: 3, offset: 2, angle: 45, color: "000000", opacity: 0.4 } },
    );
    slide.addText("Vertical", { x: 4.15, y: 0.35, w: 1, h: 2, vert: "vert270", fit: "resize" });
    slide.addShape("roundRect", { x: 5.15, y: 0.35, w: 1.33, h: 0.77, fill: { color: "4472C4", transparency: 25 }, line: { color: "000000", width: 1.5, dashType: "sysDot", endArrowType: "triangle" }, rotate: 33.3, shadow: { type: "outer", blur: 2, offset: 1, angle: 90, color: "333333" } });
    slide.addImage({ data: png, x: 7.15, y: 0.35, w: 1.1, h: 0.9, sizing: { type: "contain", w: 1.1, h: 0.7 }, transparency: 10 });
    slide.addTable(
        [
            [{ text: "H1", options: { bold: true, fill: { color: "D9EAF7" } } }, { text: "H2" }],
            [{ text: "a", options: { border: [{ type: "dash", pt: 2, color: "C00000" }, { type: "none" }, { type: "solid", pt: 1, color: "5B9BD5" }, { type: "none" }] } }, { text: "b" }],
        ],
        { x: 0.15, y: 2.35, w: 4.33, colW: [1.33, 3], rowH: 0.37 },
    );
    slide.addComponent({ type: "test/badge", version: 1, props: { label: "Badge" } }, { x: 5.15, y: 2.35, w: 2, h: 0.5 });
    return pres;
}
