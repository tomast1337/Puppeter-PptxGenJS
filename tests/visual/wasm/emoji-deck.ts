// Emoji and CJK fallback deck. Needs Noto Color Emoji and Noto Sans CJK, which the pinned
// visual image (tests/visual/Dockerfile) installs.
import type PptxGenJS from "pptxgenjs";
import type { PuppeteerGen } from "../../../packages/pptxgenjs/src/node";

export const EMOJI_PAGES = 3;

type Box = { text: string | PptxGenJS.TextProps[]; x: number; y: number; w?: number; h?: number; fontSize?: number; bold?: boolean; lang?: string };

// Spread per call: PptxGenJS mutates the options object it is given.
const title = { x: 0.5, y: 0.2, w: 9, h: 0.5, fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0 } as const;

function boxes(slide: PptxGenJS.Slide, items: Box[]): void {
    for (const { text, x, y, w = 2.9, h = 1.1, fontSize = 20, bold, lang } of items) {
        slide.addText(text, { x, y, w, h, fontFace: "Arial", fontSize, bold, lang, color: "363636", fill: { color: "F2F2F2" }, margin: 6, valign: "middle" });
    }
}

export function populateEmojiDeck<T extends PptxGenJS | PuppeteerGen>(presentation: T): T {
    const emoji = presentation.addSlide();
    emoji.addText("Emoji fallback", { ...title });
    boxes(emoji as PptxGenJS.Slide, [
        { text: "Ship it 🚀 today", x: 0.4, y: 0.9 },
        { text: "Text ❤ vs emoji ❤️", x: 3.55, y: 0.9 },
        { text: "Tone 👍 👍🏽", x: 6.7, y: 0.9 },
        { text: "ZWJ 👩‍💻 👨‍👩‍👧", x: 0.4, y: 2.2 },
        { text: "Flags 🇧🇷 🇯🇵", x: 3.55, y: 2.2 },
        { text: "Keycap 1️⃣ 2️⃣", x: 6.7, y: 2.2 },
        { text: "🎉🚀", x: 0.4, y: 3.5, h: 1.7, fontSize: 54 },
        { text: "Rocket🚀launch🚀sequence🚀ready", x: 3.55, y: 3.5, w: 1.9, h: 1.7 },
        {
            text: [
                { text: "Bold ", options: { bold: true } },
                { text: "🔥 hot", options: { bold: true } },
                { text: " plain 🔥", options: {} },
            ],
            x: 6.7,
            y: 3.5,
            h: 1.7,
        },
    ]);

    const cjk = presentation.addSlide();
    cjk.addText("CJK fallback", { ...title });
    boxes(cjk as PptxGenJS.Slide, [
        { text: "日本語とEnglishの混在テキストです。", x: 0.4, y: 0.9, w: 4.4, h: 1.2 },
        { text: "한국어 텍스트 줄바꿈 테스트입니다", x: 5.2, y: 0.9, w: 4.4, h: 1.2 },
        { text: "中文换行测试，这是一个比较长的句子，用来检查窄文本框中的断行。", x: 0.4, y: 2.4, w: 2.2, h: 2.8 },
        { text: "日本語の文章を狭い箱で折り返す。句読点、括弧「」の禁則処理。", x: 3.0, y: 2.4, w: 2.2, h: 2.8 },
        { text: "Mixed 中文 English 한국어 日本語 text wraps here", x: 5.6, y: 2.4, w: 4.0, h: 2.8 },
    ]);

    // The same Han in an Arial run: the run's lang picks the regional Noto Sans CJK face (#289), whose 骨 直 次 化 角
    // differ; a lang without a fontconfig rule (ko-KR) falls to the default JP face like en-US. Han only: LibreOffice
    // widens a space between Latin and Han, which would shift a lang label's Han against both backends.
    const han = "骨直次化角今令";
    const regional = presentation.addSlide();
    regional.addText("CJK by lang", { ...title });
    boxes(regional as PptxGenJS.Slide, [
        { text: han, lang: "zh-CN", x: 0.4, y: 0.9, w: 4.4, h: 1.2, fontSize: 28 },
        { text: han, lang: "zh-TW", x: 5.2, y: 0.9, w: 4.4, h: 1.2, fontSize: 28 },
        { text: han, lang: "ja", x: 0.4, y: 2.4, w: 4.4, h: 1.2, fontSize: 28 },
        { text: han, lang: "ko", x: 5.2, y: 2.4, w: 4.4, h: 1.2, fontSize: 28 },
        { text: han, lang: "ko-KR", x: 0.4, y: 3.9, w: 4.4, h: 1.2, fontSize: 28 },
        { text: han, lang: "zh-HK", x: 5.2, y: 3.9, w: 4.4, h: 1.2, fontSize: 28 },
    ]);
    return presentation;
}
