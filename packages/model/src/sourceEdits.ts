/** A change to an HTML source string: replace `[start, end)` with `text` (an insert when `start === end`). */
export type SourceEdit = {
    readonly start: number;
    readonly end: number;
    readonly text: string;
};

/**
 * `source` with every edit applied, offsets read against the original string. One forward pass: re-slicing the
 * whole string per edit made the print step quadratic in deck size (issue #151). Throws when two edits overlap
 * or start at the same offset, since their order would be ambiguous, or when an edit lies outside `source`.
 */
export function applySourceEdits(source: string, edits: readonly SourceEdit[]): string {
    const parts: string[] = [];
    let cursor = 0;
    let previous = -1;

    for (const edit of edits.toSorted((a, b) => a.start - b.start)) {
        if (edit.start < cursor || edit.start === previous || edit.end < edit.start || edit.end > source.length) {
            throw new Error(`Cannot apply source edit [${edit.start}, ${edit.end}): it overlaps another edit, shares its start with one, or lies outside the ${source.length}-character source`);
        }

        parts.push(source.slice(cursor, edit.start), edit.text);
        cursor = edit.end;
        previous = edit.start;
    }

    parts.push(source.slice(cursor));

    return parts.join("");
}
