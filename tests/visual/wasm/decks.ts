// The WASM visual decks: compare.ts scores them against LibreOffice through toPdf() and pins each
// PDF's bytes (pdf-sha256.json); tests/htmlBytes.test.ts pins their toHtml() bytes.
import type pptxgen from "pptxgenjs";
import type { PuppeteerGen } from "../../../packages/pptxgenjs/src/node";
import { populateChartFixture, populateComponentFixture, populateImageFixture, populateSlidePropertiesFixture, populateTableOptionsFixture, populateTextOptionsFixture, TEXT_OPTION_PAGES } from "../fixture";
import { populateShapeDeck, populateTableDeck, populateTextDeck, SHAPE_PAGES, TABLE_PAGES, TEXT_PAGES } from "./deck";
import { EFFECT_PAGES, populateEffectDeck } from "./effect-deck";
import { EMOJI_PAGES, populateEmojiDeck } from "./emoji-deck";
import { FORMAT_PAGES, populateGifDeck, populateWebpDeck } from "./format-deck";
import { IMAGE_PAGES, populateImageDeck } from "./image-deck";
import { LAYOUT_PAGES, populateLayoutDeck } from "./layout-deck";

export type Populate = <T extends pptxgen | PuppeteerGen>(presentation: T) => T;
export type SlideObject = ReturnType<PuppeteerGen["getModel"]>["slides"][number]["objects"][number];
const isText = (object: SlideObject) => object.kind === "text";
// emoji: Noto Color Emoji / Noto Sans CJK fallback (issue #14), installed in the pinned image.
// `crop` picks the objects that get a crop each: text boxes, for the shapes deck every shape
// (with or without text), so labels do not dilute the geometry scores, for the image format decks
// every picture, for the tables deck every table and for the charts deck every chart.
export const DECKS: Record<string, { populate: Populate; pages: number; crop: (object: SlideObject) => boolean }> = {
    text: { populate: populateTextDeck, pages: TEXT_PAGES, crop: isText },
    emoji: { populate: populateEmojiDeck, pages: EMOJI_PAGES, crop: isText },
    // layout: tab stops. LibreOffice drops a <a:tabLst> whose <a:pPr> carries marL/indent, which
    // PptxGenJS always writes, so its reference never shows explicit stops: those boxes count on the
    // page score only and the Rust test `tabs_end_at_their_stops` pins their positions.
    layout: { populate: populateLayoutDeck, pages: LAYOUT_PAGES, crop: object => object.kind === "text" && object.text.paragraphs.every(p => p.tabStops.length === 0) },
    shapes: { populate: populateShapeDeck, pages: SHAPE_PAGES, crop: object => object.kind === "shape" || (object.kind === "text" && object.shape !== undefined) },
    tables: { populate: populateTableDeck, pages: TABLE_PAGES, crop: object => object.kind === "table" },
    images: { populate: populateImageDeck, pages: IMAGE_PAGES, crop: object => object.kind === "image" },
    // svg: the shared fixture's two image slides, whose pictures are SVG.
    svg: {
        populate: presentation => {
            populateImageFixture(presentation);
            return presentation;
        },
        pages: 2,
        crop: object => object.kind === "image",
    },
    gif: { populate: populateGifDeck, pages: FORMAT_PAGES, crop: object => object.kind === "image" },
    webp: { populate: populateWebpDeck, pages: FORMAT_PAGES, crop: object => object.kind === "image" },
    // effects: every shadowed or glowing object; the slide titles sit above y = 0.5in (48px).
    effects: { populate: populateEffectDeck, pages: EFFECT_PAGES, crop: object => object.style.geometry.y > 48 },
    // charts: the shared fixture's chart slides. Pie, doughnut, radar and scatter are left to tests/wasm.test.ts:
    // LibreOffice draws them too far from ECharts for the page limit (0.1455 Puppeteer, 0.1485 WASM on one slide).
    charts: {
        populate: presentation => {
            populateChartFixture(presentation);
            return presentation;
        },
        pages: 5,
        crop: object => object.kind === "chart",
    },
    // components: the shared fixture's component slide (an HTML and a React progress bar, sized boxes;
    // the reference draws the same bars as PptxGenJS rectangles).
    components: {
        populate: presentation => {
            populateComponentFixture(presentation);
            return presentation;
        },
        pages: 1,
        crop: object => object.kind === "component",
    },
    // slides: the shared fixture's background picture, hidden slide and slide numbers (two printed pages);
    // the crops are the titles and the slide numbers, the picture is the page score.
    slides: {
        populate: presentation => {
            populateSlidePropertiesFixture(presentation);
            return presentation;
        },
        pages: 2,
        crop: isText,
    },
    // options: the shared fixture's text-option slides; each case box (named after its parity crop) gets a crop, its label does not.
    options: {
        populate: presentation => {
            populateTextOptionsFixture(presentation);
            return presentation;
        },
        pages: TEXT_OPTION_PAGES,
        crop: object => object.style.objectName.startsWith("text-"),
    },
    // tableOptions: the shared fixture's table-option slide; every table gets a crop.
    tableOptions: {
        populate: presentation => {
            populateTableOptionsFixture(presentation);
            return presentation;
        },
        pages: 1,
        crop: object => object.kind === "table",
    },
};
