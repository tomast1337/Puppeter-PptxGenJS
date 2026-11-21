// Where a line may wrap: UAX #14 (linebreak, the breaker PDFKit itself uses) with Chromium's overrides on top, the
// rules pdf-core applies through parley's CHROMIUM_LINE_BREAK_OVERRIDE (crates/pdf-core/src/text/layout.rs), so all
// three renderers wrap a line at the same place.
import LineBreaker from "linebreak";

const ASCII_END = 0x80;
const PRINTABLE_START = 0x21;
const ASCII_ALPHANUMERIC = /^[\da-z]$/i;

/** Allow (`true`) or forbid (`false`) a break between two printable ASCII characters, or defer to UAX #14 (absent). */
function chromiumTable(): ReadonlyMap<number, boolean> {
    const table = new Map<number, boolean>();
    const range = (from: string, to = from): number[] => Array.from({ length: to.charCodeAt(0) - from.charCodeAt(0) + 1 }, (_, i) => from.charCodeAt(0) + i);
    const all = range("!", "\u007f");
    const set = (before: number[], after: number[], allow: boolean) => {
        for (const b of before) {
            for (const a of after) {
                table.set(b * ASCII_END + a, allow);
            }
        }
    };

    // Blink's ASCII pair table, row for row as parley's `AsciiLineBreakTableBuilder::chromium()` writes it (later rules win).
    set(all, all, false);
    for (const after of ["(", "<", "[", "{"]) {
        set(all, range(after), true);
    }

    set(range("-"), all, true);
    set(range("?"), all, true);
    set(range("-"), range("$"), false);
    set(all, range("!"), false);
    set(range("?"), range('"'), false);
    set(range("?"), range("'"), false);
    for (const after of [")", ",", ".", "/"]) {
        set(all, range(after), false);
    }

    set(range("-"), range("0", "9"), false);
    for (const after of [":", ";", "?", "]", "}"]) {
        set(all, range(after), false);
    }

    for (const before of [range("$"), range("'"), range("("), range("/"), range("0", "9"), range("<"), range("@"), range("A", "Z"), range("["), range("^", "`"), range("a", "z"), range("{"), range("\u007f")]) {
        set(before, all, false);
    }

    return table;
}

/** Built once: a module constant, never written after this. */
const CHROMIUM_TABLE = chromiumTable();

/** The UTF-16 indices inside `text` where a line may start, ascending, without 0 and `text.length`. */
export function breakOpportunities(text: string): number[] {
    const uax14 = new Set<number>();
    const breaker = new LineBreaker(text);

    for (let next = breaker.nextBreak(); next; next = breaker.nextBreak()) {
        uax14.add(next.position);
    }

    const chars = Array.from(text);
    const opportunities: number[] = [];
    let index = 0;

    for (let i = 0; i + 1 < chars.length; i++) {
        const before = chars[i] ?? "";

        index += before.length;
        const [beforeBefore, after] = [chars[i - 1], chars[i + 1] ?? ""];
        // Chromium's verdict on a break between `before` and `after`, or UAX #14's where Chromium has none.
        let breaks: boolean;

        if (before === " " && after !== " ") {
            // Chromium always breaks after a run of spaces, even where UAX #14 (LB13) does not.
            breaks = true;
        } else if (before === "-" && after >= "0" && after <= "9") {
            // A "-" before a digit is a minus sign unless it follows a letter or digit ("AAAA-2222").
            breaks = beforeBefore !== undefined && ASCII_ALPHANUMERIC.test(beforeBefore);
        } else {
            const [b, a] = [before.codePointAt(0) ?? 0, after.codePointAt(0) ?? 0];
            const ascii = !(b < PRINTABLE_START || a < PRINTABLE_START || b >= ASCII_END || a >= ASCII_END);

            breaks = (ascii ? CHROMIUM_TABLE.get(b * ASCII_END + a) : undefined) ?? uax14.has(index);
        }

        if (breaks) {
            opportunities.push(index);
        }
    }

    return opportunities;
}
