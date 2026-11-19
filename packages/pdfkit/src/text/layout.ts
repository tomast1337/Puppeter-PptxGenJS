// Text box layout: breaks each paragraph into lines and places every piece of text on them. The line boxes are the
// profile's, not the fonts': every line is `line-height` tall with its baseline `data-line-baseline` below its top (the
// last line at `data-mark-baseline`, a line before a soft break at `data-break-baseline`), as pdf-core's `stack_lines`
// draws them, so only the breaks and the x positions are measured here.
import { type Face, faceFor } from "#src/fonts";
import { breakOpportunities } from "#src/lineBreak";
import type { Bullet, Paragraph, Run, TextBox } from "./read";
import { type Features, features, type Shaper } from "./shaper";

/** A piece of one run in one face, on one line. `x` is from the content box's left edge. */
export interface Fragment {
    readonly run: Run;
    readonly face: Face;
    readonly text: string;
    readonly size: number;
    readonly features: Features;
    readonly x: number;
    readonly width: number;
}

export interface Line {
    readonly fragments: readonly Fragment[];
    /** Line top and baseline, from the content box's top before the vertical anchor. */
    readonly top: number;
    readonly height: number;
    readonly baseline: number;
}

export interface PlacedBullet {
    readonly bullet: Bullet;
    readonly face: Face;
    readonly size: number;
    readonly x: number;
    readonly baseline: number;
}

export interface BoxLayout {
    readonly lines: readonly Line[];
    readonly bullets: readonly PlacedBullet[];
    readonly width: number;
    readonly height: number;
}

/** Characters that take part in breaking but draw nothing: U+200B (an empty run's text) and U+2060 (the profile's no-break). */
const INVISIBLE = /[​⁠]/g;
const TAB = "\t";
/** Slack for float noise when a line's measured width equals its box. */
const FIT_EPSILON = 0.01;

/** A measured piece before it is placed: one run, one face, no break opportunity inside. */
interface Piece {
    readonly run: Run;
    readonly face: Face;
    readonly text: string;
    readonly size: number;
    readonly features: Features;
    readonly width: number;
    /** Width without trailing spaces, which hang past the line end in `pre-wrap`. */
    readonly inkWidth: number;
    readonly tab: boolean;
    readonly spaces: number;
}

/** A word: the pieces between two break opportunities. */
type Word = Piece[];

/** Splits `text` into maximal pieces each drawn in one face of the run's chain. */
function faceRuns(text: string, run: Run, shaper: Shaper, missing: (run: Run) => void): { face: Face; text: string }[] {
    const chain = shaper.chain(run.face);
    if (!chain.found) missing(run);
    const out: { face: Face; text: string }[] = [];
    for (const char of text) {
        const face = faceFor(chain, char.codePointAt(0) ?? 0) ?? chain.faces[0];
        if (!face) continue;
        const last = out.at(-1);
        if (last?.face === face) out[out.length - 1] = { face, text: last.text + char };
        else out.push({ face, text: char });
    }
    return out;
}

function trailingSpaces(text: string): number {
    return text.length - text.trimEnd().length;
}

/** The words of one soft-break chunk of runs, measured at `scale`. */
function words(runs: readonly Run[], scale: number, shaper: Shaper, missing: (run: Run) => void): Word[] {
    const text = runs.map(run => run.text).join("");
    const cuts = new Set(breakOpportunities(text));
    const result: Word[] = [[]];
    let offset = 0;
    for (const run of runs) {
        const size = run.size * scale;
        const runFeatures = features(run.kerning, run.letterSpacing);
        // Cut the run at the chunk's opportunities and at its tabs, which are measured where they land.
        const segments: { text: string; startsWord: boolean }[] = [];
        let start = 0;
        for (let index = 1; index <= run.text.length; index++) {
            if (index === run.text.length || cuts.has(offset + index) || run.text.charAt(index) === TAB || run.text.charAt(index - 1) === TAB) {
                segments.push({ text: run.text.slice(start, index), startsWord: start === 0 ? cuts.has(offset) : true });
                start = index;
            }
        }
        for (const segment of segments) {
            if (segment.startsWord && result.at(-1)?.length) result.push([]);
            const word = result.at(-1);
            if (!word) continue;
            const tabFace = segment.text === TAB ? shaper.chain(run.face).faces[0] : undefined;
            if (tabFace) {
                word.push({ run, face: tabFace, text: "", size, features: runFeatures, width: 0, inkWidth: 0, tab: true, spaces: 0 });
                continue;
            }
            for (const piece of faceRuns(segment.text.replace(INVISIBLE, ""), run, shaper, missing)) {
                const width = shaper.width(piece.face, piece.text, size, runFeatures, run.letterSpacing);
                const trimmed = piece.text.trimEnd();
                const inkWidth = trimmed.length === piece.text.length ? width : shaper.width(piece.face, trimmed, size, runFeatures, run.letterSpacing);
                word.push({ run, face: piece.face, text: piece.text, size, features: runFeatures, width, inkWidth, tab: false, spaces: trailingSpaces(piece.text) });
            }
        }
        offset += run.text.length;
    }
    return result;
}

/** Splits a word wider than a line at characters (`overflow-wrap: break-word`), filling `available` per part. */
function breakWord(word: Word, available: number, shaper: Shaper): Word[] {
    const parts: Word[] = [[]];
    let x = 0;
    for (const piece of word) {
        for (const char of Array.from(piece.text)) {
            const width = shaper.width(piece.face, char, piece.size, piece.features, piece.run.letterSpacing);
            if (x + width > available + FIT_EPSILON && parts.at(-1)?.length) {
                parts.push([]);
                x = 0;
            }
            const part = parts.at(-1);
            const last = part?.at(-1);
            if (last && last.run === piece.run && last.face === piece.face) part?.splice(-1, 1, { ...last, text: last.text + char, width: last.width + width, inkWidth: char === " " ? last.inkWidth : last.width + width, spaces: char === " " ? last.spaces + 1 : 0 });
            else part?.push({ ...piece, text: char, width, inkWidth: char === " " ? 0 : width, spaces: char === " " ? 1 : 0 });
            x += width;
        }
    }
    return parts;
}

function wordWidth(word: Word): number {
    return word.reduce((sum, piece) => sum + piece.width, 0);
}

/** The width of `word` up to its last ink: its trailing spaces hang. */
function wordInkWidth(word: Word): number {
    const last = word.findLastIndex(piece => piece.inkWidth > 0 || piece.tab);
    return word.slice(0, last + 1).reduce((sum, piece, index) => sum + (index === last ? piece.inkWidth : piece.width), 0);
}

interface LineDraft {
    pieces: { piece: Piece; x: number }[];
    width: number;
    inkWidth: number;
}

/** Greedy line filling, as browsers and PowerPoint wrap. `starts[i]` is line i's left edge (the first line can differ). */
function fillLines(chunk: Word[], available: (line: number) => number, wrap: boolean, tabSize: number, shaper: Shaper): LineDraft[] {
    const lines: LineDraft[] = [{ pieces: [], width: 0, inkWidth: 0 }];
    const place = (word: Word) => {
        const line = lines.at(-1);
        if (!line) return;
        for (const piece of word) {
            const width = piece.tab ? (tabSize > 0 ? (Math.floor(line.width / tabSize + FIT_EPSILON) + 1) * tabSize - line.width : 0) : piece.width;
            line.pieces.push({ piece: { ...piece, width, inkWidth: piece.tab ? width : piece.inkWidth }, x: line.width });
            line.inkWidth = line.width + (piece.tab ? width : piece.inkWidth);
            line.width += width;
        }
    };
    for (const word of chunk) {
        const line = lines.at(-1);
        if (!line) break;
        const limit = available(lines.length - 1);
        if (!wrap || line.width + wordInkWidth(word) <= limit + FIT_EPSILON || word.some(piece => piece.tab)) {
            place(word);
            continue;
        }
        if (line.pieces.length) lines.push({ pieces: [], width: 0, inkWidth: 0 });
        if (wordInkWidth(word) <= available(lines.length - 1) + FIT_EPSILON) {
            place(word);
            continue;
        }
        breakWord(word, available(lines.length - 1), shaper).forEach((part, index) => {
            if (index > 0) lines.push({ pieces: [], width: 0, inkWidth: 0 });
            place(part);
        });
    }
    return lines;
}

function alignOffset(paragraph: Paragraph, available: number, inkWidth: number): number {
    if (paragraph.align === "center") return (available - inkWidth) / 2;
    if (paragraph.align === "right") return available - inkWidth;
    return 0;
}

/** Lays out the box's paragraphs in a content box `innerWidth` wide, every font size and line box scaled by `scale`. */
export function layoutText(box: TextBox, innerWidth: number, scale: number, shaper: Shaper, missing: (run: Run) => void): BoxLayout {
    const lines: Line[] = [];
    const bullets: PlacedBullet[] = [];
    let y = 0;
    let width = 0;
    for (const paragraph of box.paragraphs) {
        y += paragraph.spaceBefore;
        const lineHeight = paragraph.lineHeight * scale;
        const firstStart = paragraph.indent + (paragraph.bullet ? 0 : paragraph.textIndent);
        const chunks: Run[][] = [];
        paragraph.runs.forEach((run, index) => {
            if (index === 0 || run.softBreakBefore) chunks.push([]);
            chunks.at(-1)?.push(run);
        });
        if (!chunks.length) chunks.push([]);
        const firstLine = lines.length;
        chunks.forEach((chunk, chunkIndex) => {
            const chunkLine = lines.length - firstLine;
            const start = (line: number) => (chunkLine + line === 0 ? firstStart : paragraph.indent);
            const available = (line: number) => innerWidth - start(line);
            const drafts = fillLines(words(chunk, scale, shaper, missing), available, box.wrap, paragraph.tabSize, shaper);
            drafts.forEach((draft, index) => {
                const lastOfChunk = index === drafts.length - 1;
                const lastOfParagraph = lastOfChunk && chunkIndex === chunks.length - 1;
                const baseline = (lastOfParagraph ? paragraph.markBaseline : lastOfChunk ? paragraph.breakBaseline : paragraph.baseline) * scale;
                const left = start(index) + alignOffset(paragraph, available(index), draft.inkWidth);
                const justify = paragraph.align === "justify" && !lastOfChunk;
                const spaces = draft.pieces.slice(0, -1).reduce((sum, { piece }) => sum + piece.spaces, 0);
                const extra = justify && spaces > 0 ? (available(index) - draft.inkWidth) / spaces : 0;
                let spacesBefore = 0;
                const fragments = draft.pieces.flatMap(({ piece, x }) => {
                    const fragment: Fragment = { run: piece.run, face: piece.face, text: piece.text, size: piece.size, features: piece.features, x: left + x + extra * spacesBefore, width: piece.width };
                    spacesBefore += piece.spaces;
                    return piece.text ? [fragment] : [];
                });
                lines.push({ fragments, top: y, height: lineHeight, baseline: y + baseline });
                width = Math.max(width, left + draft.inkWidth);
                y += lineHeight;
            });
        });
        // The marker sits on the first line's baseline (a raised mark or break baseline moves it too).
        const face = paragraph.bullet ? shaper.chain(paragraph.bullet.face).faces[0] : undefined;
        const first = lines[firstLine];
        if (paragraph.bullet && face && first) bullets.push({ bullet: paragraph.bullet, face, size: paragraph.bullet.size * scale, x: paragraph.indent + paragraph.textIndent, baseline: first.baseline });
        y += paragraph.spaceAfter;
    }
    return { lines, bullets, width, height: y };
}
