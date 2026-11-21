// Text box layout: breaks each paragraph into lines and places every piece of text on them. The line boxes are the
// profile's, not the fonts': every line is `line-height` tall with its baseline `data-line-baseline` below its top (the
// last line at `data-mark-baseline`, a line before a soft break at `data-break-baseline`), as pdf-core's `stack_lines`
// draws them, so only the breaks and the x positions are measured here.
import { type Face, faceFor } from "#src/fonts";
import { breakOpportunities } from "#src/lineBreak";
import type { Bullet, Run, TextBox } from "./read";
import { type Features, features, type Shaper } from "./shaper";

/** A piece of one run in one face, on one line. `x` is from the content box's left edge. */
export type Fragment = {
    readonly run: Run;
    readonly face: Face;
    readonly text: string;
    readonly size: number;
    readonly features: Features;
    readonly x: number;
    readonly width: number;
};

export type Line = {
    readonly fragments: readonly Fragment[];
    /** Line top and baseline, from the content box's top before the vertical anchor. */
    readonly top: number;
    readonly height: number;
    readonly baseline: number;
};

export type PlacedBullet = {
    readonly bullet: Bullet;
    readonly face: Face;
    readonly size: number;
    readonly x: number;
    readonly baseline: number;
};

export type BoxLayout = {
    readonly lines: readonly Line[];
    readonly bullets: readonly PlacedBullet[];
    readonly width: number;
    readonly height: number;
};

/** Characters that take part in breaking but draw nothing: U+200B (an empty run's text) and U+2060 (the profile's no-break). */
const INVISIBLE = /[​⁠]/g;
const TAB = "\t";
/** Slack for float noise when a line's measured width equals its box. */
const FIT_EPSILON = 0.01;
/** A tab that ends text on a stop sits on it: positions this many px before a stop count as on it (pdf-core's ON_STOP). */
const ON_STOP = 0.01;

/** A measured piece before it is placed: one run, one face, no break opportunity inside. */
type Piece = {
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
};

/** A word: the pieces between two break opportunities. */
type Word = Piece[];

/** The width of `word` up to its last ink: its trailing spaces hang. */
function wordInkWidth(word: Word): number {
    const last = word.findLastIndex(piece => piece.inkWidth > 0 || piece.tab);
    let sum = 0;

    for (const [index, piece] of word.slice(0, last + 1).entries()) {
        sum += index === last ? piece.inkWidth : piece.width;
    }

    return sum;
}

type LineDraft = {
    pieces: { piece: Piece; x: number }[];
    width: number;
    inkWidth: number;
};

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

        for (const [index, run] of paragraph.runs.entries()) {
            if (index === 0 || run.softBreakBefore) {
                chunks.push([]);
            }

            chunks.at(-1)?.push(run);
        }

        if (!chunks.length) {
            chunks.push([]);
        }

        const firstLine = lines.length;

        for (const [chunkIndex, chunk] of chunks.entries()) {
            const chunkLine = lines.length - firstLine;
            // A line's left edge from the text area's left edge (tab stops count from there), and its width.
            const start = (line: number) => (chunkLine + line === 0 ? firstStart : paragraph.indent);
            const available = (line: number) => innerWidth - start(line);
            // The words of the chunk (the pieces between two break opportunities), measured at `scale`.
            const text = chunk.map(run => run.text).join("");
            const cuts = new Set(breakOpportunities(text));
            const words: Word[] = [[]];
            let offset = 0;

            for (const run of chunk) {
                const size = run.size * scale;
                const runFeatures = features(run.kerning, run.letterSpacing);
                // Cut the run at the chunk's opportunities and at its tabs, which are measured where they land.
                const segments: { text: string; startsWord: boolean }[] = [];
                let segmentStart = 0;

                for (let index = 1; index <= run.text.length; index++) {
                    if (index === run.text.length || cuts.has(offset + index) || run.text.charAt(index) === TAB || run.text.charAt(index - 1) === TAB) {
                        segments.push({ text: run.text.slice(segmentStart, index), startsWord: segmentStart === 0 ? cuts.has(offset) : true });
                        segmentStart = index;
                    }
                }

                // The run's previous piece: the run is shaped as one, as Chromium and pdf-core shape it, so a kern pair across
                // a break opportunity (Arial's "A " or " T") moves the next piece; it is added to the previous piece's width.
                let previous: { word: Word; index: number } | undefined;

                for (const segment of segments) {
                    if (segment.startsWord && words.at(-1)?.length) {
                        words.push([]);
                    }

                    const word = words.at(-1);

                    if (!word) {
                        continue;
                    }

                    const tabFace = segment.text === TAB ? shaper.chain(run.face).faces[0] : undefined;

                    if (tabFace) {
                        word.push({ run, face: tabFace, text: "", size, features: runFeatures, width: 0, inkWidth: 0, tab: true, spaces: 0 });
                        previous = undefined;
                        continue;
                    }

                    // Split the segment into maximal pieces each drawn in one face of the run's chain.
                    const chain = shaper.chain(run.face);

                    if (!chain.found) {
                        missing(run);
                    }

                    const faceRuns: { face: Face; text: string }[] = [];

                    for (const char of segment.text.replace(INVISIBLE, "")) {
                        const face = faceFor(chain, char.codePointAt(0) ?? 0) ?? chain.faces[0];

                        if (!face) {
                            continue;
                        }

                        const last = faceRuns.at(-1);

                        if (last?.face === face) {
                            faceRuns[faceRuns.length - 1] = { face, text: last.text + char };
                        } else {
                            faceRuns.push({ face, text: char });
                        }
                    }

                    for (const piece of faceRuns) {
                        const pieceWidth = shaper.width(piece.face, piece.text, size, runFeatures, run.letterSpacing);
                        const trimmed = piece.text.trimEnd();
                        const inkWidth = trimmed.length === piece.text.length ? pieceWidth : shaper.width(piece.face, trimmed, size, runFeatures, run.letterSpacing);
                        const before = previous && previous.word[previous.index];

                        if (previous && before?.face === piece.face) {
                            const pair = shaper.kern(piece.face, Array.from(before.text).at(-1) ?? "", Array.from(piece.text)[0] ?? "", size, runFeatures);

                            if (pair) {
                                previous.word[previous.index] = { ...before, width: before.width + pair };
                            }
                        }

                        word.push({ run, face: piece.face, text: piece.text, size, features: runFeatures, width: pieceWidth, inkWidth, tab: false, spaces: piece.text.length - trimmed.length });
                        previous = { word, index: word.length - 1 };
                    }
                }

                offset += run.text.length;
            }

            // Greedy line filling, as browsers and PowerPoint wrap: `available(i)` is line i's width (the first line can differ).
            const drafts: LineDraft[] = [{ pieces: [], width: 0, inkWidth: 0 }];
            // For each tab of the chunk, the width of the text it aligns (to the next tab, or the chunk's end less its
            // trailing spaces) and how far into it the first '.' is, for right, center and decimal stops.
            // shortcut: pdf-core aligns the text up to the line's end and re-breaks a line the widened tab overflows; here the
            // text runs to the next tab even when it wraps. Measure per line if a deck aligns wrapping text on a stop.
            const tabSegments = new Map<Piece, { width: number; dot?: number }>();
            const pieces = words.flat();

            for (const [index, tab] of pieces.entries()) {
                if (!tab.tab) {
                    continue;
                }

                let segmentWidth = 0;
                let dot: number | undefined;

                for (let next = index + 1; next < pieces.length; next++) {
                    const piece = pieces[next];

                    if (!piece || piece.tab) {
                        break;
                    }

                    const at = piece.text.indexOf(".");

                    if (dot === undefined && at >= 0) {
                        dot = segmentWidth + shaper.width(piece.face, piece.text.slice(0, at), piece.size, piece.features, piece.run.letterSpacing);
                    }

                    segmentWidth += next === pieces.length - 1 ? piece.inkWidth : piece.width;
                }

                tabSegments.set(tab, { width: segmentWidth, ...(dot === undefined ? {} : { dot }) });
            }

            const place = (word: Word) => {
                const line = drafts.at(-1);

                if (!line) {
                    return;
                }

                for (const piece of word) {
                    let advance = piece.width;

                    if (piece.tab) {
                        // The width of a tab at `pos` that brings its text to its stop: left starts it there, right ends it,
                        // center centres it, decimal puts its '.' there. The stop is the first explicit one past `pos`, else
                        // the next multiple of the tab size, as pdf-core's `next_stop`.
                        const pos = start(drafts.length - 1) + line.width;
                        const segment = tabSegments.get(piece);
                        const past = pos + ON_STOP;
                        const stop = paragraph.tabStops.find(candidate => candidate.position > past) ?? (paragraph.tabSize > 0 ? { position: (Math.floor(past / paragraph.tabSize) + 1) * paragraph.tabSize, alignment: "left" as const } : undefined);

                        advance = 0;
                        if (stop) {
                            const aligned = segment?.width ?? 0;
                            const lead = stop.alignment === "right" ? aligned : stop.alignment === "center" ? aligned / 2 : stop.alignment === "decimal" ? (segment?.dot ?? aligned) : 0;

                            advance = Math.max(0, stop.position - pos - lead);
                        }
                    }

                    line.pieces.push({ piece: { ...piece, width: advance, inkWidth: piece.tab ? advance : piece.inkWidth }, x: line.width });
                    line.inkWidth = line.width + (piece.tab ? advance : piece.inkWidth);
                    line.width += advance;
                }
            };

            for (const word of words) {
                const line = drafts.at(-1);

                if (!line) {
                    break;
                }

                const limit = available(drafts.length - 1);

                if (!box.wrap || line.width + wordInkWidth(word) <= limit + FIT_EPSILON || word.some(piece => piece.tab)) {
                    place(word);
                    continue;
                }

                if (line.pieces.length) {
                    drafts.push({ pieces: [], width: 0, inkWidth: 0 });
                }

                if (wordInkWidth(word) <= available(drafts.length - 1) + FIT_EPSILON) {
                    place(word);
                    continue;
                }

                // A word wider than a line splits at characters (`overflow-wrap: break-word`), each part filling a line.
                const partWidth = available(drafts.length - 1);
                const parts: Word[] = [[]];
                let x = 0;

                for (const piece of word) {
                    for (const char of Array.from(piece.text)) {
                        const charWidth = shaper.width(piece.face, char, piece.size, piece.features, piece.run.letterSpacing);

                        if (x + charWidth > partWidth + FIT_EPSILON && parts.at(-1)?.length) {
                            parts.push([]);
                            x = 0;
                        }

                        const part = parts.at(-1);
                        const last = part?.at(-1);

                        if (last && last.run === piece.run && last.face === piece.face) {
                            part?.splice(-1, 1, { ...last, text: last.text + char, width: last.width + charWidth, inkWidth: char === " " ? last.inkWidth : last.width + charWidth, spaces: char === " " ? last.spaces + 1 : 0 });
                        } else {
                            part?.push({ ...piece, text: char, width: charWidth, inkWidth: char === " " ? 0 : charWidth, spaces: char === " " ? 1 : 0 });
                        }

                        x += charWidth;
                    }
                }

                for (const [index, part] of parts.entries()) {
                    if (index > 0) {
                        drafts.push({ pieces: [], width: 0, inkWidth: 0 });
                    }

                    place(part);
                }
            }

            for (const [index, draft] of drafts.entries()) {
                const lastOfChunk = index === drafts.length - 1;
                const lastOfParagraph = lastOfChunk && chunkIndex === chunks.length - 1;
                const baseline = (lastOfParagraph ? paragraph.markBaseline : lastOfChunk ? paragraph.breakBaseline : paragraph.baseline) * scale;
                const lineAvailable = available(index);
                const alignOffset = paragraph.align === "center" ? (lineAvailable - draft.inkWidth) / 2 : paragraph.align === "right" ? lineAvailable - draft.inkWidth : 0;
                const left = start(index) + alignOffset;
                const justify = paragraph.align === "justify" && !lastOfChunk;
                let spaces = 0;

                for (const { piece } of draft.pieces.slice(0, -1)) {
                    spaces += piece.spaces;
                }

                const extra = justify && spaces > 0 ? (lineAvailable - draft.inkWidth) / spaces : 0;
                let spacesBefore = 0;
                // A right-to-left line mirrors its words in the span they fill, so the first ends at its right edge.
                const right = left + draft.inkWidth + extra * spaces;
                const fragments: Fragment[] = [];

                for (const { piece, x } of draft.pieces) {
                    const ltrX = left + x + extra * spacesBefore;

                    if (piece.text) {
                        fragments.push({ run: piece.run, face: piece.face, text: piece.text, size: piece.size, features: piece.features, x: paragraph.rtl ? left + right - ltrX - piece.width : ltrX, width: piece.width });
                    }

                    spacesBefore += piece.spaces;
                }

                lines.push({ fragments, top: y, height: lineHeight, baseline: y + baseline });
                width = Math.max(width, left + draft.inkWidth);
                y += lineHeight;
            }
        }

        // The marker sits on the first line's baseline (a raised mark or break baseline moves it too).
        const face = paragraph.bullet ? shaper.chain(paragraph.bullet.face).faces[0] : undefined;
        const first = lines[firstLine];

        if (paragraph.bullet && face && first) {
            bullets.push({ bullet: paragraph.bullet, face, size: paragraph.bullet.size * scale, x: paragraph.indent + paragraph.textIndent, baseline: first.baseline });
        }

        y += paragraph.spaceAfter;
    }

    return { lines, bullets, width, height: y };
}
