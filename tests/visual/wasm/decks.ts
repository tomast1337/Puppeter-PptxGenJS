// The WASM visual decks: compare.ts scores them against LibreOffice through toPdf() (the HTML path),
// tests/wasm.test.ts checks that the HTML and model paths give the same PDF bytes for each.
import type pptxgen from "pptxgenjs";
import type { PuppeteerGen } from "../../../packages/pptxgenjs/src/node";
import { populateShapeDeck, populateTableDeck, populateTextDeck, SHAPE_PAGES, TABLE_PAGES, TEXT_PAGES } from "./deck";
import { EFFECT_PAGES, populateEffectDeck } from "./effect-deck";
import { EMOJI_PAGES, populateEmojiDeck } from "./emoji-deck";
import { IMAGE_PAGES, populateImageDeck } from "./image-deck";
import { LAYOUT_PAGES, populateLayoutDeck } from "./layout-deck";

export type Populate = <T extends pptxgen | PuppeteerGen>(presentation: T) => T;
export type SlideObject = ReturnType<PuppeteerGen["getModel"]>["slides"][number]["objects"][number];
const isText = (object: SlideObject) => object.kind === "text";
// emoji: Noto Color Emoji / Noto Sans CJK fallback (issue #14), installed in the pinned image.
// `crop` picks the objects that get a crop each: text boxes, for the shapes deck every shape
// (with or without text), so labels do not dilute the geometry scores, for the images deck every
// picture and for the tables deck every table.
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
    // effects: every shadowed or glowing object; the slide titles sit above y = 0.5in (48px).
    effects: { populate: populateEffectDeck, pages: EFFECT_PAGES, crop: object => object.style.geometry.y > 48 },
};
