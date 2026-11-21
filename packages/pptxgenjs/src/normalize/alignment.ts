import type { NormalizedTextBox, NormalizedTextParagraph } from "@pdflapas/model";
import { ALIGN_H, ALIGN_V } from "#src/enums";

type ParagraphAlign = NormalizedTextParagraph["align"];
type VerticalAlign = NormalizedTextBox["verticalAlign"];

/** Where a `valign` is read: PptxGenJS 4.0.1 turns it into an anchor differently in each (WRITTEN_ANCHOR). */
export type VerticalAlignSource = "textBox" | "tableCell" | "slideNumber";

// The anchors a <a:bodyPr> or <a:tcPr> can hold, as the model names them.
const ANCHORS: Readonly<Record<string, VerticalAlign>> = Object.freeze({ t: "top", ctr: "middle", b: "bottom" });
const FIRST_LETTER_ANCHORS: Readonly<Record<string, string>> = Object.freeze({ t: "t", m: "ctr", b: "b" });
const CELL_C = /^c$/i;
const CELL_M = /^m$/i;

// The anchor PptxGenJS 4.0.1 writes for a valign; one that is not in ANCHORS is none (a text box) or invalid XML.
const WRITTEN_ANCHOR: Readonly<Record<VerticalAlignSource, (valign: string) => string>> = Object.freeze({
    // genXmlTextBody step 2: the lower-cased first letter.
    textBox: valign => FIRST_LETTER_ANCHORS[valign.charAt(0).toLowerCase()] ?? "",
    // genXmlTable: this replace chain, then the result as it is.
    tableCell: valign => valign.replace(CELL_C, "ctr").replace(CELL_M, "ctr").replace("center", "ctr").replace("middle", "ctr").replace("top", "t").replace("btm", "b").replace("bottom", "b"),
    // genXmlSlideNumber (slide.ts, _slideNumberProps.valign).
    slideNumber: valign => valign.replace("top", "t").replace("middle", "ctr").replace("bottom", "b"),
});

/**
 * A text run's, text box's or table cell's `align`. PptxGenJS 4.0.1
 * genXmlParagraphProps writes an `algn` for these four values and none for a falsy one; any other value would reach the
 * slide's CSS as it is, so it is refused.
 */
// eslint-disable-next-line pdflapas/no-nullable-return -- phase 2 (#425)
export function paragraphAlign(align: unknown): ParagraphAlign | undefined {
    if (!align) {
        return undefined;
    }

    if (typeof align === "string" && Object.hasOwn(ALIGN_H, align)) {
        return align as ParagraphAlign;
    } // hasOwn: one of ALIGN_H's keys, which equal its values

    throw new TypeError(`Text option \`align\` is ${JSON.stringify(align)}; use one of ${Object.values(ALIGN_H).join(", ")}`);
}

/**
 * A `valign` as the model's value, read as PptxGenJS 4.0.1 reads it at `source`; falsy is unset. A value it writes no
 * valid anchor for is refused: it would otherwise reach the slide's CSS as it is.
 */
// eslint-disable-next-line pdflapas/no-nullable-return -- phase 2 (#425)
export function verticalAlign(valign: unknown, source: VerticalAlignSource): VerticalAlign | undefined {
    if (!valign) {
        return undefined;
    }

    const anchor = typeof valign === "string" ? WRITTEN_ANCHOR[source](valign) : "";

    if (Object.hasOwn(ANCHORS, anchor)) {
        return ANCHORS[anchor];
    }

    throw new TypeError(`Text option \`valign\` is ${JSON.stringify(valign)}; use one of ${Object.values(ALIGN_V).join(", ")}`);
}
