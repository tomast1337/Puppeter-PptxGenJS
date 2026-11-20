// Chinese lines around punctuation, ASCII quotes, digits and Latin words, with the line breaks PowerPoint's PDF export
// of the same synthetic deck gave: SimSun 10pt (every Han character and full-width mark 1em, every ASCII character
// 0.5em, no kerning), margin 0, top anchored, `lang` zh-CN or zh-TW on every run. Each string has one boundary "|"
// (not drawn) between two characters, and three boxes end the line just before, between and just after them; both
// languages break alike (target/powerpoint.ts, `hangingMarks` and `breaksAroundQuotes`).
import { PPTX_DEFAULTS } from "../packages/pptxgenjs/src/defaults";
import type { PuppeteerGen } from "../packages/pptxgenjs/src/node";

const SIZE_PT = 10;

export interface ChineseBreakCase {
    readonly label: string;
    readonly lang: "zh-CN" | "zh-TW";
    readonly text: string;
    /** The box's width, in em of SIZE_PT. */
    readonly widthEm: number;
    /** PowerPoint's lines, each as its number of characters other than spaces. */
    readonly lines: readonly number[];
}

// zh-CN text, zh-TW text, the three box widths (em), and PowerPoint's line lengths in each box. The last string's
// "——" breaks between the dashes and not before them in PowerPoint, which the target does not do (`hangingMarks`).
const CASES: readonly (readonly [string, string, readonly number[], readonly (readonly number[])[]])[] = [
    [
        "本次会议负责人|（示例）说明",
        "本次會議負責人|（示例）說明",
        [6, 7, 8],
        [
            [6, 6, 1],
            [7, 6],
            [7, 6],
        ],
    ],
    [
        "根据有关规定|《示例办法》执行",
        "根據有關規定|《示例辦法》執行",
        [5, 6, 7],
        [
            [5, 5, 4],
            [6, 6, 2],
            [6, 7, 1],
        ],
    ],
    [
        "他刚才又说|「这是示例」",
        "他剛才又說|「這是示例」",
        [4, 5, 6],
        [
            [4, 4, 3],
            [5, 6],
            [5, 6],
        ],
    ],
    [
        "他刚才又说|“这是示例”",
        "他剛才又說|“這是示例”",
        [4, 5, 6],
        [
            [4, 4, 3],
            [5, 6],
            [5, 6],
        ],
    ],
    [
        "参见示例条款（第一|）规定",
        "參見示例條款（第一|）規定",
        [8, 9, 10],
        [
            [8, 4],
            [10, 2],
            [10, 2],
        ],
    ],
    [
        "根据有关《示例办法|》执行",
        "根據有關《示例辦法|》執行",
        [8, 9, 10],
        [
            [8, 4],
            [10, 2],
            [10, 2],
        ],
    ],
    [
        "他说「这是示例|」然后",
        "他說「這是示例|」然後",
        [6, 7, 8],
        [
            [6, 4],
            [8, 2],
            [8, 2],
        ],
    ],
    [
        "他说“这是示例|”然后",
        "他說“這是示例|”然後",
        [6, 7, 8],
        [
            [6, 4],
            [8, 2],
            [8, 2],
        ],
    ],
    [
        "这是示例文字内容|，其他地区",
        "這是示例文字內容|，其他地區",
        [7, 8, 9],
        [
            [7, 6],
            [9, 4],
            [9, 4],
        ],
    ],
    [
        "示例项目包括甲|、税务项目",
        "示例項目包括甲|、稅務項目",
        [6, 7, 8],
        [
            [6, 6],
            [8, 4],
            [8, 4],
        ],
    ],
    [
        "这是示例的文字|。下一句话",
        "這是示例的文字|。下一句話",
        [6, 7, 8],
        [
            [6, 6],
            [8, 4],
            [8, 4],
        ],
    ],
    [
        "参见示例（第一）|。后续内容",
        "參見示例（第一）|。後續內容",
        [7, 8, 9],
        [
            [6, 7],
            [9, 4],
            [9, 4],
        ],
    ],
    [
        "他说「这是示例。|」后来",
        "他說「這是示例。|」後來",
        [7, 8, 9],
        [
            [6, 5],
            [9, 2],
            [9, 2],
        ],
    ],
    [
        '他刚才又说|"示例项目"很好',
        '他剛才又說|"示例项目"很好',
        [4, 5, 5.5],
        [
            [4, 4, 4, 1],
            [5, 6, 2],
            [6, 6, 1],
        ],
    ],
    [
        '他说"示例项目|"很好',
        '他說"示例项目|"很好',
        [5.5, 6.5, 7],
        [
            [6, 4],
            [7, 3],
            [8, 2],
        ],
    ],
    [
        "根据法规第|123(4)节规定",
        "根據法規第|123(4)節規定",
        [4, 5, 5.5],
        [
            [4, 7, 3],
            [5, 8, 1],
            [5, 8, 1],
        ],
    ],
    [
        "根据法规第123|(4)节规定",
        "根據法規第123|(4)節規定",
        [6, 6.5, 7],
        [
            [5, 9],
            [5, 9],
            [5, 9],
        ],
    ],
    [
        "根据法规第123(4)|节规定",
        "根據法規第123(4)|節規定",
        [7.5, 8, 9],
        [
            [11, 3],
            [11, 3],
            [12, 2],
        ],
    ],
    [
        "这是示例第|45条规定",
        "這是示例第|45條規定",
        [4, 5, 5.5],
        [
            [4, 5, 1],
            [5, 5],
            [5, 5],
        ],
    ],
    [
        "这是示例第45|条规定",
        "這是示例第45|條規定",
        [5.5, 6, 7],
        [
            [5, 5],
            [7, 3],
            [8, 2],
        ],
    ],
    [
        "共计约100|%的示例",
        "共計約100|%的示例",
        [4, 4.5, 5],
        [
            [3, 6, 1],
            [3, 6, 1],
            [7, 3],
        ],
    ],
    [
        "共计约100%|的示例",
        "共計約100%|的示例",
        [4.5, 5, 6],
        [
            [3, 6, 1],
            [7, 3],
            [8, 2],
        ],
    ],
    [
        "可以使用|Excel表格处理",
        "可以使用|Excel表格處理",
        [3, 4, 4.5],
        [
            [3, 1, 5, 3, 1],
            [4, 6, 3],
            [4, 7, 2],
        ],
    ],
    [
        "可以使用Excel|表格处理",
        "可以使用Excel|表格處理",
        [6, 6.5, 7.5],
        [
            [4, 8, 1],
            [9, 4],
            [10, 3],
        ],
    ],
    [
        "可以使用Ex|cel表格处理",
        "可以使用Ex|cel表格處理",
        [4.5, 5, 5.5],
        [
            [4, 7, 2],
            [4, 7, 2],
            [4, 8, 1],
        ],
    ],
    [
        "可以使用 |Excel 表格处理",
        "可以使用 |Excel 表格處理",
        [4, 4.5, 5],
        [
            [4, 6, 3],
            [4, 6, 3],
            [4, 7, 2],
        ],
    ],
    [
        "示例文字内容|……后续",
        "示例文字內容|……後續",
        [5, 6, 7],
        [
            [5, 5],
            [5, 5],
            [5, 5],
        ],
    ],
    [
        "示例说明内容|——后续",
        "示例說明內容|——後續",
        [5, 6, 7],
        [
            [5, 5],
            [5, 5],
            [7, 3],
        ],
    ],
    [
        "示例的说明内容|：如下",
        "示例的說明內容|：如下",
        [6, 7, 8],
        [
            [6, 4],
            [8, 2],
            [8, 2],
        ],
    ],
    [
        "这是真的吗|？是的",
        "這是真的嗎|？是的",
        [4, 5, 6],
        [
            [4, 4],
            [6, 2],
            [6, 2],
        ],
    ],
];

/** The measured boxes: CASES in zh-CN, then in zh-TW. */
export function chineseBreakCases(): ChineseBreakCase[] {
    return (["zh-CN", "zh-TW"] as const).flatMap((lang, language) =>
        CASES.flatMap((entry, index) => {
            const [before = "", after = ""] = entry[language === 0 ? 0 : 1].split("|");
            return entry[2].map((widthEm, box) => ({ label: `${lang} ${index + 1}${"abc"[box] ?? ""}`, lang, text: `${before}${after}`, widthEm, lines: entry[3][box] ?? [] }));
        }),
    );
}

/** Each case in a box of its own slide, SimSun 10pt, margin 0, top anchored, as in the measured deck. */
export function chineseBreakDeck(presentation: PuppeteerGen, cases: readonly ChineseBreakCase[]): PuppeteerGen {
    for (const { lang, text, widthEm } of cases) {
        presentation.addSlide().addText(text, { x: 0.4, y: 0.2, w: (widthEm * SIZE_PT) / PPTX_DEFAULTS.units.pointsPerInch, h: 1, margin: 0, valign: "top", fontFace: "SimSun", fontSize: SIZE_PT, lang });
    }
    return presentation;
}
