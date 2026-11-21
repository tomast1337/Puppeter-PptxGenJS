// How the PowerPoint target breaks Han text where UAX #14 (Chromium, pdf-core) does not: by the run's language, a
// closing mark that hangs past the line's end (RENDERING_TARGETS.hangingMarks), and the breaks around punctuation
// next to Han characters (RENDERING_TARGETS.breaksAroundHanPunctuation). Measurements in target/powerpoint.ts.
import type { GlyphAdvances } from "#src/defaults";
import type { NormalizedTextRun } from "@pdflapas/model";

/** U+3000 IDEOGRAPHIC SPACE: preserved white space that hangs at a line's end in Chromium and pdf-core (parley). */
const IDEOGRAPHIC_SPACE = "　";
/** U+200B ZERO WIDTH SPACE: a line break opportunity, drawn as nothing by Chromium and pdf-core. */
const ZERO_WIDTH_SPACE = "​";
/** U+2060 WORD JOINER: no line break opportunity, drawn as nothing. */
const WORD_JOINER = "⁠";
/** The dash a line in a language with hanging marks never starts with after another character. */
const DASH = "—";
/** CJK punctuation: CJK symbols and punctuation, vertical and full-width forms. */
const CJK_PUNCTUATION = "(?=\\p{P})[\\u3000-\\u303f\\ufe30-\\ufe4f\\uff00-\\uff65]";
/** Full-width punctuation: CJK punctuation, and the quotes, dash and ellipsis CJK faces draw 1em wide. */
const WIDE = `(?:${CJK_PUNCTUATION}|[\\u2014\\u2018-\\u201d\\u2026])`;
/** In a language with hanging marks: before "“" or "‘" after Han, between Han and an ASCII quote, between two dashes. */
const HANGING_LANGUAGE_BREAK = /(?<=\p{Script=Han})(?=[“‘"])|(?<=")(?=\p{Script=Han})|(?<=—)(?=—)/gu;
/** In a language with hanging marks: before a dash after anything but a dash. */
const DASH_JOIN = /(?<=[^—])(?=—)/gu;
/**
 * In any other language: on either side of CJK punctuation next to anything but white space (Han, digits, Latin
 * letters, ASCII punctuation, more of it; a break next to a space is there already), on either side of the quotes and
 * dash a CJK face draws 1em wide next to Han, between two dashes, and between Han and an ASCII quote.
 */
const OTHER_LANGUAGE_BREAK = new RegExp(`(?<=\\p{Script=Han})(?=${WIDE}|")|(?<=${WIDE}|")(?=\\p{Script=Han})|(?<=${CJK_PUNCTUATION})(?=\\S)|(?<=\\S)(?=${CJK_PUNCTUATION})|(?<=\\u2014)(?=\\u2014)`, "gu");
/** The first character from which a mark is taken to be 1em wide when its face's advances are not known. */
const FULL_WIDTH_FROM = 0x2000;

/** The marks that hang in a run in `language` (its primary subtag's entry in `marksByLanguage`), or undefined. */
export function languageHangingMarks(language: string, marksByLanguage: Readonly<Record<string, string>>): string | undefined {
    return marksByLanguage[language.split("-")[0]?.toLowerCase() ?? ""];
}

/** A stretch of a run's text; `hangs`: a single mark that hangs past the line's end when the line ends after it. */
export interface HangingSegment {
    readonly text: string;
    readonly hangs: boolean;
}

/**
 * `text` cut around each of `marks` not followed by another of them or a dash (`next`, the character after `text`,
 * undefined at the paragraph's end or a soft break): PowerPoint keeps such a mark on its line, past the right edge,
 * where it would otherwise start the next line.
 */
export function hangingSegments(text: string, next: string | undefined, marks: string): HangingSegment[] {
    const characters = [...text];
    const segments: HangingSegment[] = [];
    let plain = "";

    characters.forEach((character, index) => {
        const after = characters[index + 1] ?? next;

        if (!marks.includes(character) || (after !== undefined && (marks.includes(after) || after === DASH))) {
            plain += character;

            return;
        }

        if (plain) {
            segments.push({ text: plain, hangs: false });
        }

        segments.push({ text: character, hangs: true });
        plain = "";
    });
    if (plain || !segments.length) {
        segments.push({ text: plain, hangs: false });
    }

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

        if (units !== undefined && font) {
            return (units * mark.fontSize) / font.unitsPerEm;
        }

        return codePoint >= FULL_WIDTH_FROM ? mark.fontSize : undefined;
    };
    const markAdvance = advance(mark.text);
    const spaceAdvance = advance(IDEOGRAPHIC_SPACE);

    if (markAdvance === undefined || spaceAdvance === undefined) {
        return [mark];
    }

    // A one-character run keeps its advance grid spacing in characterSpacing (normalize/text.ts runSpacing).
    const laidOut = markAdvance + mark.characterSpacing;

    return [
        { ...mark, characterSpacing: -markAdvance },
        { ...mark, text: IDEOGRAPHIC_SPACE, characterSpacing: laidOut - spaceAdvance, softBreakBefore: false },
    ];
}

/**
 * `text` with PowerPoint's breaks around punctuation next to Han characters, `previous` and `next` being the
 * characters around it: in a language with hanging marks (`hangs`) a ZERO_WIDTH_SPACE at each HANGING_LANGUAGE_BREAK
 * and a WORD_JOINER at each DASH_JOIN, in any other a ZERO_WIDTH_SPACE at each OTHER_LANGUAGE_BREAK.
 */
export function breakAroundHanPunctuation(text: string, previous: string, next: string, hangs: boolean): string {
    const joined = `${previous}${text}${next}`;
    const broken = hangs ? joined.replace(DASH_JOIN, WORD_JOINER).replace(HANGING_LANGUAGE_BREAK, ZERO_WIDTH_SPACE) : joined.replace(OTHER_LANGUAGE_BREAK, ZERO_WIDTH_SPACE);

    return broken.slice(previous.length, broken.length - next.length);
}
