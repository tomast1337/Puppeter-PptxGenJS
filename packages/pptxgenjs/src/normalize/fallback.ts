import type { FontMetricsLookup } from "#src/defaults";
import { RENDERING_TARGETS, type RenderingTarget } from "#src/target/index";

/** A stretch of a run's text and the faces a character its face lacks is drawn in, first to last. */
export interface FallbackSegment {
    readonly text: string;
    readonly fallbackFaces: readonly string[];
}

// Han, kana, bopomofo and Hangul, the CJK symbols, punctuation and compatibility blocks, and the full- and half-width
// forms: what PowerPoint draws from the East Asian faces it links to the run's face (eastAsianFallback).
const EAST_ASIAN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo}\p{Script=Hangul}　-㏿︰-﹏＀-￯]/u;
// An emoji: a pictograph, or a flag of two regional indicators.
const PICTOGRAPHIC = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u;
// A variation selector or keycap mark stays with its emoji, as a renderer draws them.
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Whether `character` is one PowerPoint draws from its East Asian faces when the run's face lacks it. */
export function isEastAsian(character: string): boolean {
    return EAST_ASIAN.test(character);
}

/** The target's East Asian faces for a run in `fontFace` (eastAsianFallback). */
function eastAsianFaces(fontFace: string, target: RenderingTarget): readonly string[] {
    const { byFace, otherFaces } = RENDERING_TARGETS[target].eastAsianFallback;
    const face = fontFace.toLowerCase();
    // Own keys only: a face named like an Object.prototype member is just another face.
    return (Object.hasOwn(byFace, face) ? byFace[face] : undefined) ?? otherFaces;
}

/** The target's chain for a run in `fontFace`: `fallbackFaces`, then its East Asian faces, without `fontFace`. */
export function fallbackChain(fontFace: string, target: RenderingTarget): readonly string[] {
    const face = fontFace.toLowerCase();
    return [...RENDERING_TARGETS[target].fallbackFaces, ...eastAsianFaces(fontFace, target)].filter((value, index, all) => value.toLowerCase() !== face && all.indexOf(value) === index);
}

/**
 * `text` cut where PowerPoint draws a character the run's face lacks in another face than the chain's first that has
 * it, each stretch with its chain reordered so a renderer that takes the first face with the character does the same.
 * Measured against PowerPoint's PDF export of a synthetic deck (RENDERING_TARGETS.powerpoint.eastAsianFallback): an
 * East Asian character keeps the face the one before it was drawn in while that face has it; a space, a character of
 * the run's face or any other character ends that. An emoji takes `emojiFace` when it has it.
 * One stretch with the plain chain when every character takes the chain's first, or a face's characters are unknown.
 * shortcut: the stretch ends at each run, where PowerPoint carries it into a run of identical options, and goes on
 * across a line break, where PowerPoint starts over (a wrapped "这是这是这是" starts its second line's 是 in MS
 * Gothic); join such runs, and cut at the line, when a deck shows it. An emoji the run's face has (☺ in Arial) stays
 * in that face, where PowerPoint draws it from `emojiFace`; that needs a run face override in the model, worth it
 * when a deck shows one.
 */
export function fallbackSegments(text: string, fontFace: string, bold: boolean, italic: boolean, target: RenderingTarget, fontMetrics: FontMetricsLookup): FallbackSegment[] {
    const chain = fallbackChain(fontFace, target);
    const { emojiFace } = RENDERING_TARGETS[target];
    const lookup = fontMetrics.glyphAdvances;
    const own = chain.length ? lookup?.(fontFace, bold, italic) : undefined;
    if (!lookup || !own) return [{ text, fallbackFaces: chain }];
    // Each face's characters, looked up once for the run.
    const characters = new Map<string, ReadonlyMap<number, number> | undefined>();
    const has = (face: string, codePoint: number) => {
        if (!characters.has(face)) characters.set(face, lookup(face, bold, italic)?.advances);
        return characters.get(face)?.has(codePoint) ?? false;
    };
    const eastAsian = eastAsianFaces(fontFace, target).filter(face => chain.includes(face));
    const segments: { text: string; first: string | undefined }[] = [];
    let held: string | undefined;
    for (const { segment } of GRAPHEMES.segment(text)) {
        const codePoint = segment.codePointAt(0) ?? 0;
        const missing = !own.advances.has(codePoint);
        const natural = missing ? chain.find(face => has(face, codePoint)) : undefined;
        const emoji = missing && emojiFace !== undefined && PICTOGRAPHIC.test(segment) && has(emojiFace, codePoint);
        const sticky = missing && !emoji && isEastAsian(segment);
        const first = emoji ? emojiFace : sticky ? ((held && has(held, codePoint) ? held : eastAsian.find(face => has(face, codePoint))) ?? natural) : natural;
        held = sticky ? first : undefined;
        // The chain's own first needs no stretch of its own.
        const key = first === natural ? undefined : first;
        const last = segments.at(-1);
        if (last && last.first === key) last.text += segment;
        else segments.push({ text: segment, first: key });
    }
    if (segments.every(({ first }) => first === undefined)) return [{ text, fallbackFaces: chain }];
    return segments.map(({ text: piece, first }) => ({ text: piece, fallbackFaces: first === undefined ? chain : [first, ...chain.filter(face => face !== first)] }));
}
