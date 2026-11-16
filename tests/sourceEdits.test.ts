import { describe, expect, test } from "bun:test";
import { applySourceEdits, type SourceEdit } from "../packages/model/src/index";

/** The splice loop `printHtml` and `completeProfileHtml` used before issue #151: one full-string copy per edit. */
function spliceOneByOne(source: string, edits: readonly SourceEdit[]): string {
    let out = source;
    for (const edit of edits.toSorted((a, b) => b.start - a.start)) out = `${out.slice(0, edit.start)}${edit.text}${out.slice(edit.end)}`;
    return out;
}

const SOURCE = `<html><head></head><body><span class="text-run" style="color: red;">Hi</span><path d="M0 0"/></body></html>`;

describe("applySourceEdits", () => {
    test("returns the source unchanged without edits", () => {
        expect(applySourceEdits(SOURCE, [])).toBe(SOURCE);
        expect(applySourceEdits("", [])).toBe("");
    });

    test.each<[string, SourceEdit[]]>([
        ["one replacement", [{ start: 45, end: 65, text: `style="color: red; font-weight: 700;"` }]],
        [
            "inserts and replacements given in any order",
            [
                { start: 82, end: 82, text: ` fill="none"` },
                { start: 5, end: 5, text: ` style="zoom: 4;"` },
                { start: 45, end: 65, text: `style="x"` },
            ],
        ],
        [
            "adjacent edits: an insert at the end of a replacement, a replacement right after it",
            [
                { start: 45, end: 65, text: "A" },
                { start: 65, end: 65, text: "B" },
                { start: 66, end: 68, text: "C" },
            ],
        ],
        [
            "edits at both ends and an empty replacement",
            [
                { start: 0, end: 0, text: "<!DOCTYPE html>" },
                { start: 6, end: 19, text: "" },
                { start: SOURCE.length, end: SOURCE.length, text: "\n" },
            ],
        ],
    ])("matches the one-by-one splice: %s", (_, edits) => {
        expect(applySourceEdits(SOURCE, edits)).toBe(spliceOneByOne(SOURCE, edits));
    });

    test("matches the one-by-one splice on many random disjoint edits", () => {
        let seed = 151;
        const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
        const source = SOURCE.repeat(50);
        const edits: SourceEdit[] = [];
        for (let start = 0; start < source.length; start += 1 + Math.floor(random() * 20)) {
            const end = start + Math.floor(random() * 3);
            edits.push({ start, end, text: `<${edits.length}>` });
            start = end;
        }
        expect(applySourceEdits(source, edits.toReversed())).toBe(spliceOneByOne(source, edits));
    });

    test.each<[string, SourceEdit[]]>([
        [
            "overlapping replacements",
            [
                { start: 2, end: 6, text: "a" },
                { start: 4, end: 8, text: "b" },
            ],
        ],
        [
            "an insert inside a replacement",
            [
                { start: 2, end: 6, text: "a" },
                { start: 4, end: 4, text: "b" },
            ],
        ],
        [
            "two edits starting at one offset",
            [
                { start: 4, end: 4, text: "a" },
                { start: 4, end: 6, text: "b" },
            ],
        ],
        ["an edit past the end", [{ start: 4, end: SOURCE.length + 1, text: "a" }]],
        ["an inverted range", [{ start: 6, end: 4, text: "a" }]],
    ])("throws on %s instead of corrupting the output", (_, edits) => {
        expect(() => applySourceEdits(SOURCE, edits)).toThrow(/Cannot apply source edit/);
    });

    test("stays linear: 32,000 edits on a 3.8 MB string", () => {
        const run = `<span class="text-run" style="font-family: &quot;Arial&quot;; font-size: 24px;">text</span>`;
        const source = run.repeat(32_000);
        const edits = Array.from({ length: 32_000 }, (_, index) => ({ start: index * run.length + 5, end: index * run.length + 5, text: " x" }));
        const started = performance.now();
        const out = applySourceEdits(source, edits);
        // The splice loop took about 10 s here; one pass takes a few ms. 1 s leaves room for a slow CI machine.
        expect(performance.now() - started).toBeLessThan(1000);
        expect(out.length).toBe(source.length + 2 * 32_000);
    });
});
