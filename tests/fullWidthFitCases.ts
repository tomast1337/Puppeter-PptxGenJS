// Han next to digits, Latin words and ASCII parentheses, in runs with no `lang` (PptxGenJS writes en-US) and in zh-CN
// and zh-TW, with the line breaks PowerPoint's PDF export of the same synthetic deck gave (normalize/advanceGrid.ts
// `fullWidthStretches`). Margin 0, top anchored. Each string has one boundary "|" between two characters, and three
// boxes end the line just before, between and just after them; a box's width is its text's advances, each rounded to
// PowerPoint's advance grid (Han and full-width marks 1em, drawn in a fallback face), plus BOX_SLACK_PT, so the text
// fits it exactly.
import { type GlyphAdvances, PPTX_DEFAULTS } from "../packages/pptxgenjs/src/defaults";
import type { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { RENDERING_TARGETS } from "../packages/pptxgenjs/src/target";

/** Under one grid step past the text, so the box floored to the grid (`wrapWidthGridPt`) is exactly as wide as it. */
const BOX_SLACK_PT = 0.06;

/** A run set-up of the deck: face, size, alignment and `lang` (undefined: PptxGenJS's en-US). */
export interface FitVariant {
    readonly fontFace: "Arial" | "Times New Roman";
    readonly sizePt: number;
    readonly align: "left" | "justify";
    readonly lang: string | undefined;
}

export const FIT_VARIANTS: readonly FitVariant[] = [
    { fontFace: "Arial", sizePt: 10, align: "left", lang: undefined },
    { fontFace: "Arial", sizePt: 10, align: "justify", lang: undefined },
    { fontFace: "Arial", sizePt: 10, align: "left", lang: "zh-CN" },
    { fontFace: "Arial", sizePt: 10, align: "left", lang: "zh-TW" },
    { fontFace: "Times New Roman", sizePt: 10, align: "left", lang: undefined },
    { fontFace: "Arial", sizePt: 8, align: "left", lang: undefined },
];

/** One box: PowerPoint's lines, each as its number of characters other than spaces. */
export interface FitCase {
    readonly label: string;
    readonly text: string;
    readonly variant: FitVariant;
    /** The characters the box is exactly as wide as. */
    readonly fits: string;
    readonly lines: readonly number[];
}

type Boxes = readonly [readonly number[] | null, readonly number[] | null, readonly number[] | null];

// Each string, then for each FIT_VARIANTS entry PowerPoint's lines in the boxes ending before, between and after the
// boundary's two characters; null for a box the renderers still break otherwise, as where a run with no `lang` keeps
// CJK punctuation with the digits or Latin text next to it.
const CASES: readonly (readonly [string, readonly Boxes[]])[] = [
    [
        "我们完成了1999|，然后继续",
        [
            [[5, 8, 1], null, [10, 4]],
            [[5, 8, 1], null, [10, 4]],
            [
                [5, 8, 1],
                [10, 4],
                [10, 4],
            ],
            [
                [5, 8, 1],
                [10, 4],
                [10, 4],
            ],
            [[5, 8, 1], null, [10, 4]],
            [[5, 8, 1], null, [10, 4]],
        ],
    ],
    [
        "我们完成了Alpha|。然后继续",
        [
            [[5, 9, 1], null, [11, 4]],
            [[5, 9, 1], null, [11, 4]],
            [
                [5, 9, 1],
                [11, 4],
                [11, 4],
            ],
            [
                [5, 9, 1],
                [11, 4],
                [11, 4],
            ],
            [[5, 9, 1], null, [11, 4]],
            [[5, 9, 1], null, [11, 4]],
        ],
    ],
    [
        "包括了Alpha|、Beta和其他",
        [
            [[3, 6, 6, 1], null, [9, 7]],
            [[3, 6, 6, 1], null, [9, 7]],
            [
                [3, 6, 6, 1],
                [9, 7],
                [9, 7],
            ],
            [
                [3, 6, 6, 1],
                [9, 7],
                [9, 7],
            ],
            [[3, 6, 7], null, [9, 7]],
            [[3, 6, 6, 1], null, [9, 7]],
        ],
    ],
    [
        "我们参考了「Alpha|」内容",
        [
            [null, null, [12, 2]],
            [null, null, [12, 2]],
            [
                [5, 9],
                [12, 2],
                [12, 2],
            ],
            [
                [5, 9],
                [12, 2],
                [12, 2],
            ],
            [null, null, [12, 2]],
            [null, null, [12, 2]],
        ],
    ],
    [
        "我们参考了《1999|》内容",
        [
            [null, null, [11, 2]],
            [null, null, [11, 2]],
            [
                [5, 8],
                [11, 2],
                [11, 2],
            ],
            [
                [5, 8],
                [11, 2],
                [11, 2],
            ],
            [null, null, [11, 2]],
            [null, null, [11, 2]],
        ],
    ],
    [
        "我们参考了（Alpha|）内容",
        [
            [null, null, [12, 2]],
            [null, null, [12, 2]],
            [
                [5, 9],
                [12, 2],
                [12, 2],
            ],
            [
                [5, 9],
                [12, 2],
                [12, 2],
            ],
            [null, null, [12, 2]],
            [null, null, [12, 2]],
        ],
    ],
    [
        "我们参考了Alpha|；然后",
        [
            [[5, 8], null, [11, 2]],
            [[5, 8], null, [11, 2]],
            [
                [5, 8],
                [11, 2],
                [11, 2],
            ],
            [
                [5, 8],
                [11, 2],
                [11, 2],
            ],
            [[5, 8], null, [11, 2]],
            [[5, 8], null, [11, 2]],
        ],
    ],
    [
        "我们参考了1999|：然后",
        [
            [[5, 7], null, [10, 2]],
            [[5, 7], null, [10, 2]],
            [
                [5, 7],
                [10, 2],
                [10, 2],
            ],
            [
                [5, 7],
                [10, 2],
                [10, 2],
            ],
            [[5, 7], null, [10, 2]],
            [[5, 7], null, [10, 2]],
        ],
    ],
    [
        "我们参考了“Alpha|”内容",
        [
            [
                [5, 9],
                [5, 9],
                [12, 2],
            ],
            [
                [5, 9],
                [5, 9],
                [12, 2],
            ],
            [
                [5, 9],
                [12, 2],
                [12, 2],
            ],
            [
                [5, 9],
                [12, 2],
                [12, 2],
            ],
            [
                [5, 9],
                [5, 9],
                [12, 2],
            ],
            [
                [5, 9],
                [5, 9],
                [12, 2],
            ],
        ],
    ],
    [
        "我们参考了(1)|，然后",
        [
            [[5, 6], null, [9, 2]],
            [[5, 6], null, [9, 2]],
            [
                [5, 6],
                [9, 2],
                [9, 2],
            ],
            [
                [5, 6],
                [9, 2],
                [9, 2],
            ],
            [[5, 6], null, [9, 2]],
            [[5, 6], null, [9, 2]],
        ],
    ],
    [
        "我们完成了，|Alpha然后",
        [
            [
                [5, 7, 1],
                [6, 7],
                [6, 7],
            ],
            [
                [5, 7, 1],
                [6, 7],
                [6, 7],
            ],
            [
                [6, 7],
                [6, 7],
                [6, 7],
            ],
            [
                [6, 7],
                [6, 7],
                [6, 7],
            ],
            [
                [5, 7, 1],
                [6, 7],
                [6, 7],
            ],
            [
                [5, 7, 1],
                [6, 7],
                [6, 7],
            ],
        ],
    ],
    [
        "我们参考了（Alpha）|Beta内容",
        [
            [null, [12, 6], [12, 6]],
            [null, [12, 6], [12, 6]],
            [
                [12, 6],
                [12, 6],
                [12, 6],
            ],
            [
                [12, 6],
                [12, 6],
                [12, 6],
            ],
            [null, [12, 6], [12, 6]],
            [null, [12, 6], [12, 6]],
        ],
    ],
    [
        "我们完成了1999，|2000年",
        [
            [null, [10, 5], [10, 5]],
            [null, [10, 5], [10, 5]],
            [
                [10, 5],
                [10, 5],
                [10, 5],
            ],
            [
                [10, 5],
                [10, 5],
                [10, 5],
            ],
            [null, [10, 5], [10, 5]],
            [null, [10, 5], [10, 5]],
        ],
    ],
    [
        "我们完成了示例|，然后继续",
        [
            [
                [6, 6],
                [7, 5],
                [8, 4],
            ],
            [
                [6, 6],
                [7, 5],
                [8, 4],
            ],
            [
                [6, 6],
                [8, 4],
                [8, 4],
            ],
            [
                [6, 6],
                [8, 4],
                [8, 4],
            ],
            [
                [6, 6],
                [7, 5],
                [8, 4],
            ],
            [null, [7, 5], [8, 4]],
        ],
    ],
    [
        "根据条款|(ii)将会执行",
        [
            [
                [3, 5, 3, 1],
                [4, 6, 2],
                [4, 7, 1],
            ],
            [
                [3, 5, 3, 1],
                [4, 6, 2],
                [4, 7, 1],
            ],
            [
                [3, 5, 3, 1],
                [4, 6, 2],
                [4, 7, 1],
            ],
            [
                [3, 5, 3, 1],
                [4, 6, 2],
                [4, 7, 1],
            ],
            [
                [3, 5, 3, 1],
                [4, 6, 2],
                [4, 7, 1],
            ],
            [
                [3, 5, 3, 1],
                [4, 6, 2],
                [4, 7, 1],
            ],
        ],
    ],
    [
        "根据条款(ii)|将会执行",
        [
            [
                [4, 7, 1],
                [8, 4],
                [9, 3],
            ],
            [
                [4, 7, 1],
                [8, 4],
                [9, 3],
            ],
            [
                [8, 4],
                [8, 4],
                [9, 3],
            ],
            [
                [8, 4],
                [8, 4],
                [9, 3],
            ],
            [
                [4, 7, 1],
                [8, 4],
                [9, 3],
            ],
            [
                [4, 7, 1],
                [8, 4],
                [9, 3],
            ],
        ],
    ],
    [
        "或者根据|(iv)条款执行",
        [
            [
                [3, 5, 3, 1],
                [4, 6, 2],
                [4, 6, 2],
            ],
            [
                [3, 5, 3, 1],
                [4, 6, 2],
                [4, 6, 2],
            ],
            [
                [3, 5, 3, 1],
                [4, 6, 2],
                [4, 6, 2],
            ],
            [
                [3, 5, 3, 1],
                [4, 6, 2],
                [4, 6, 2],
            ],
            [
                [3, 5, 3, 1],
                [4, 6, 2],
                [4, 6, 2],
            ],
            [
                [3, 5, 3, 1],
                [4, 6, 2],
                [4, 6, 2],
            ],
        ],
    ],
    [
        "或者根据(iv)|条款执行",
        [
            [
                [4, 7, 1],
                [8, 4],
                [9, 3],
            ],
            [
                [4, 7, 1],
                [8, 4],
                [9, 3],
            ],
            [
                [8, 4],
                [8, 4],
                [9, 3],
            ],
            [
                [8, 4],
                [8, 4],
                [9, 3],
            ],
            [
                [4, 7, 1],
                [8, 4],
                [9, 3],
            ],
            [
                [4, 7, 1],
                [8, 4],
                [9, 3],
            ],
        ],
    ],
    [
        "我们在第193|(5)项示例",
        [
            [
                [4, 8, 1],
                [4, 8, 1],
                [4, 9],
            ],
            [
                [4, 8, 1],
                [4, 8, 1],
                [4, 9],
            ],
            [
                [4, 8, 1],
                [4, 8, 1],
                [4, 9],
            ],
            [
                [4, 8, 1],
                [4, 8, 1],
                [4, 9],
            ],
            [
                [4, 8, 1],
                [4, 8, 1],
                [4, 9],
            ],
            [
                [4, 8, 1],
                [4, 8, 1],
                [4, 9],
            ],
        ],
    ],
    [
        "这是示例的|Alpha文字内容",
        [
            [
                [4, 6, 4],
                [5, 7, 2],
                [5, 8, 1],
            ],
            [
                [4, 6, 4],
                [5, 7, 2],
                [5, 8, 1],
            ],
            [
                [4, 6, 4],
                [5, 7, 2],
                [5, 8, 1],
            ],
            [
                [4, 6, 4],
                [5, 7, 2],
                [5, 8, 1],
            ],
            [
                [4, 6, 4],
                [5, 7, 2],
                [5, 8, 1],
            ],
            [
                [4, 6, 4],
                [5, 7, 2],
                [5, 8, 1],
            ],
        ],
    ],
    [
        "这是示例的Alpha|文字内容",
        [
            [
                [5, 9],
                [10, 4],
                [11, 3],
            ],
            [
                [5, 9],
                [10, 4],
                [11, 3],
            ],
            [
                [5, 9],
                [10, 4],
                [11, 3],
            ],
            [
                [5, 9],
                [10, 4],
                [11, 3],
            ],
            [
                [5, 9],
                [10, 4],
                [11, 3],
            ],
            [
                [5, 9],
                [10, 4],
                [11, 3],
            ],
        ],
    ],
    [
        "这是示例的Alpha| Beta文字",
        [
            [
                [5, 11],
                [10, 6],
                [10, 6],
            ],
            [
                [5, 11],
                [10, 6],
                [10, 6],
            ],
            [
                [5, 11],
                [10, 6],
                [10, 6],
            ],
            [
                [5, 11],
                [10, 6],
                [10, 6],
            ],
            [
                [5, 11],
                [10, 6],
                [10, 6],
            ],
            [
                [5, 11],
                [10, 6],
                [10, 6],
            ],
        ],
    ],
    [
        "这是示例的Alpha Beta|文字内容",
        [
            [
                [10, 8],
                [14, 4],
                [15, 3],
            ],
            [
                [10, 8],
                [14, 4],
                [15, 3],
            ],
            [
                [10, 8],
                [14, 4],
                [15, 3],
            ],
            [
                [10, 8],
                [14, 4],
                [15, 3],
            ],
            [
                [10, 8],
                [14, 4],
                [15, 3],
            ],
            [
                [10, 8],
                [14, 4],
                [15, 3],
            ],
        ],
    ],
];

/** The measured boxes, string by string, variant by variant. */
export function fullWidthFitCases(): FitCase[] {
    return CASES.flatMap(([marked, variants], index) => {
        const [before = "", after = ""] = marked.split("|");
        const characters = [...before];
        const ends = [characters.slice(0, -1).join(""), before, `${before}${[...after][0] ?? ""}`];

        return variants.flatMap((boxes, variantIndex) => {
            const variant = FIT_VARIANTS[variantIndex];

            if (!variant) {
                return [];
            }

            return boxes.flatMap((lines, box) => (lines ? [{ label: `${index + 1}${"abc"[box] ?? ""} v${variantIndex + 1}`, text: `${before}${after}`, variant, fits: ends[box] ?? "", lines }] : []));
        });
    });
}

/** `text`'s width at `sizePt` on PowerPoint's advance grid; a character `font` does not map is 1em. */
function gridWidthPt(text: string, sizePt: number, font: GlyphAdvances): number {
    const grid = RENDERING_TARGETS.powerpoint.advanceGridPt ?? 0;

    return [...text].reduce((sum, character) => {
        const units = font.advances.get(character.codePointAt(0) ?? 0);
        const natural = units === undefined ? sizePt : (units * sizePt) / font.unitsPerEm;

        return sum + Math.round(natural / grid) * grid;
    }, 0);
}

/** Each case in a box of its own slide, as in the measured deck; `fonts` gives each face's advances. */
export function fullWidthFitDeck(presentation: PuppeteerGen, cases: readonly FitCase[], fonts: (fontFace: FitVariant["fontFace"]) => GlyphAdvances): PuppeteerGen {
    for (const { text, variant, fits } of cases) {
        const { fontFace, sizePt, align, lang } = variant;
        const widthPt = gridWidthPt(fits, sizePt, fonts(fontFace)) + BOX_SLACK_PT;

        presentation.addSlide().addText(text, { fontFace, fontSize: sizePt, align, ...(lang ? { lang } : {}), x: 0.4, y: 0.2, w: widthPt / PPTX_DEFAULTS.units.pointsPerInch, h: 1.2, margin: 0, valign: "top" });
    }

    return presentation;
}
