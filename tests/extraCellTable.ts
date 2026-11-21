import type PptxGenJS from "pptxgenjs";

/**
 * The #286 table: a 3-cell header row then three 5-cell rows, Arial 7pt, rowH 0.18in, margin 0, at y 0.5in, sized by
 * `colW: [1, 1, 1]` or `w: 3`. PowerPoint's PDF export draws only the first 3 cells of each row and keeps every row at
 * 0.18in: row tops at EXTRA_CELL_ROW_TOPS_IN.
 *
 * Not in the shared visual fixture (tests/visual/fixture.ts): LibreOffice, its reference, mis-imports this table. In the
 * fixture's slide 46 it drew the table at the slide's top-left corner over the title, with only two rows and a blank
 * filled box (crop RMSE 0.2826 against 0.08), and raised the table-sizing-spans crop beside it from 0.0319 to 0.0408.
 * The row tops are checked against the PowerPoint numbers instead (tests/table.test.ts, tests/wasm.test.ts).
 */
export function extraCellTable(size: Pick<PptxGenJS.TableProps, "colW" | "w">): { rows: PptxGenJS.TableRow[]; options: PptxGenJS.TableProps } {
    const border = { type: "solid", pt: 0.5, color: "000000" } as const;
    const cells = (texts: string[]) => texts.map(text => ({ text, options: { border } }));
    const data = ["Alpha", "Beta", "Gamma", "Delta past the grid", "Epsilon past the grid"];

    return {
        rows: [cells(["Name", "Value", "Note"]), cells(data), cells(data), cells(data)],
        options: { x: 0.5, y: 0.5, ...size, rowH: 0.18, margin: 0, fontFace: "Arial", fontSize: 7 },
    };
}

/** The row tops PowerPoint's PDF export draws for extraCellTable(), in inches from the slide top. */
export const EXTRA_CELL_ROW_TOPS_IN = [0.5, 0.68, 0.86, 1.04] as const;
