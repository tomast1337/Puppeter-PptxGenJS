// How the PowerPoint target breaks Chinese lines where UAX #14 (Chromium, pdf-core) does not: a closing mark that
// hangs past the line's end (RENDERING_TARGETS.hangingMarks) and the breaks around quotes next to Han characters
// (RENDERING_TARGETS.breaksAroundQuotes). Measurements in target/powerpoint.ts.
import type { GlyphAdvances } from "#src/defaults";
import type { NormalizedTextRun } from "@pdflapas/model";

/** U+3000 IDEOGRAPHIC SPACE: preserved white space that hangs at a line's end in Chromium and pdf-core (parley). */
const IDEOGRAPHIC_SPACE = "\u3000";
/** U+200B ZERO WIDTH SPACE: a line break opportunity, drawn as nothing by Chromium and pdf-core. */
const ZERO_WIDTH_SPACE = "\u200b";
const HAN = /\p{Script=Han}/u;
/** The points before a left double quote after a Han character, and on either side of an ASCII quote between Han characters. */
const QUOTE_BREAK = /(?<=\p{Script=Han})(?=\u201c|"\p{Script=Han})|(?<=\p{Script=Han}")(?=\p{Script=Han})/gu;
/** The first character from which a mark is taken to be 1em wide when its face's advances are not known. */
const FULL_WIDTH_FROM = 0x2000;

/** Whether PowerPoint breaks a run in `language` by its Chinese rules: measured with zh-CN and zh-TW. */
export function chineseLineBreak(language: string): boolean {
    return /^zh(?:-|$)/i.test(language);
}

/** A stretch of a run's text; `hangs`: a single mark that hangs past the line's end when the line ends after it. */
export interface HangingSegment {
    readonly text: string;
    readonly hangs: boolean;
}

/**
 * `text` cut around each of `marks` that is followed by a Han character or ends the line (`next`, the character after
 * `text`, undefined at the paragraph's end or a soft break): PowerPoint keeps such a mark on its line, past the right
 * edge, where it would otherwise start the next line.
 */
export function hangingSegments(text: string, next: string | undefined, marks: string): HangingSegment[] {
    const characters = [...text];
    const segments: HangingSegment[] = [];
    let plain = "";
    characters.forEach((character, index) => {
        const after = characters[index + 1] ?? next;
        if (!marks.includes(character) || (after !== undefined && !HAN.test(after))) {
            plain += character;
            return;
        }
        if (plain) segments.push({ text: plain, hangs: false });
        segments.push({ text: character, hangs: true });
        plain = "";
    });
    if (plain || !segments.length) segments.push({ text: plain, hangs: false });
    return segments;
}

/**
 * The runs that draw `mark`, a run of one hanging mark: the mark with no advance, then a U+3000 as wide as the mark
 * was laid out, which Chromium and pdf-core hang at a line's end as preserved white space, so the line fits when the
 * text before the mark does. `mark` unchanged when the advances are not known: those of `font`, else 1em from
 * U+2000 (CJK faces draw full-width marks and U+3000 1em wide).
 * shortcut: a narrow mark (ASCII ")") hangs only with its face's advances (resolveGlyphAdvances); take its width
 * from the renderer's font when a deck shows one without.
 */
export function hangingMarkRuns(mark: NormalizedTextRun, font: GlyphAdvances | undefined): NormalizedTextRun[] {
    const advance = (character: string) => {
        const codePoint = character.codePointAt(0) ?? 0;
        const units = font?.advances.get(codePoint);
        if (units !== undefined && font) return (units * mark.fontSize) / font.unitsPerEm;
        return codePoint >= FULL_WIDTH_FROM ? mark.fontSize : undefined;
    };
    const markAdvance = advance(mark.text);
    const spaceAdvance = advance(IDEOGRAPHIC_SPACE);
    if (markAdvance === undefined || spaceAdvance === undefined) return [mark];
    // A one-character run keeps its advance grid spacing in characterSpacing (normalize/text.ts runSpacing).
    const laidOut = markAdvance + mark.characterSpacing;
    return [
        { ...mark, characterSpacing: -markAdvance },
        { ...mark, text: IDEOGRAPHIC_SPACE, characterSpacing: laidOut - spaceAdvance, softBreakBefore: false },
    ];
}

/**
 * `text` with a ZERO_WIDTH_SPACE at each QUOTE_BREAK point, `previous` and `next` being the characters around it.
 */
export function breakAroundQuotes(text: string, previous: string, next: string): string {
    const joined = `${previous}${text}${next}`.replace(QUOTE_BREAK, ZERO_WIDTH_SPACE);
    return joined.slice(previous.length, joined.length - next.length);
}
