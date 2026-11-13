import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const TYPES = resolve(import.meta.dir, "../packages/model/src/types.ts");
const PROFILE = resolve(import.meta.dir, "../docs/HTML_PROFILE.md");
const STATUSES = new Set(["profile", "gap", "not drawable"]);

/**
 * Every field of the model, read from the type declarations rather than from a sample deck: a sample only
 * shows the fields it happens to set, so a new optional field could slip through. The walk starts at
 * `NormalizedPresentation` and follows every property type, so a field in a new nested interface is found
 * too. Keys are `Owner.field`; an anonymous object is named by its path (`NormalizedTextParagraph.lineBox`),
 * a union variant by its discriminant (`NormalizedSlideObject<text>`), an array element by `[]`.
 */
function modelFields(): Set<string> {
    const program = ts.createProgram([TYPES], { strict: true, noEmit: true });
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(TYPES);
    const module = source && checker.getSymbolAtLocation(source);
    const root = module && checker.getExportsOfModule(module).find(symbol => symbol.name === "NormalizedPresentation");
    if (!root) throw new Error(`NormalizedPresentation is not exported from ${TYPES}`);
    const fields = new Set<string>();
    const visited = new Set<string>();

    const discriminant = (type: ts.Type): string | undefined => {
        const property = type.getProperty("kind") ?? type.getProperty("type");
        if (!property) return undefined;
        const value = checker.getTypeOfSymbol(property);
        const literals = value.isUnion() ? value.types : [value];
        return literals.map(literal => (literal.isStringLiteral() ? literal.value : "?")).join("|");
    };

    const visit = (input: ts.Type, path: string): void => {
        const type = checker.getNonNullableType(input);
        if (checker.isArrayType(type) || checker.isTupleType(type)) {
            for (const element of checker.getTypeArguments(type as ts.TypeReference)) visit(element, `${path}[]`);
            return;
        }
        if (type.isUnion()) {
            // Only object variants carry fields; literal unions such as `"left" | "center"` are leaves.
            const name = type.aliasSymbol?.name ?? path;
            for (const variant of type.types) if (variant.flags & ts.TypeFlags.Object) visit(variant, `${name}<${discriminant(variant)}>`);
            return;
        }
        if (!(type.flags & ts.TypeFlags.Object)) return;
        const symbolName = type.aliasSymbol?.name ?? type.getSymbol()?.name;
        const owner = symbolName && !symbolName.startsWith("__") ? symbolName : path;
        if (visited.has(owner)) return;
        visited.add(owner);
        for (const property of type.getProperties()) {
            const field = `${owner}.${property.name}`;
            fields.add(field);
            visit(checker.getTypeOfSymbol(property), field);
        }
    };

    visit(checker.getDeclaredTypeOfSymbol(root), "NormalizedPresentation");
    return fields;
}

/**
 * The mapping table of docs/HTML_PROFILE.md, read from the doc itself so the doc and the check cannot drift:
 * rows of `| \`Owner.field\` | status | HTML |` from "## Field mapping" to the end of the file.
 */
function profileRows(): Map<string, string> {
    const text = readFileSync(PROFILE, "utf8");
    const start = text.indexOf("\n## Field mapping\n");
    if (start < 0) throw new Error("docs/HTML_PROFILE.md has no '## Field mapping' section");
    const rows = new Map<string, string>();
    for (const line of text.slice(start).split("\n")) {
        const match = line.match(/^\|\s*`([\w<>|\\?[\].]+)`\s*\|\s*([^|]+?)\s*\|/);
        if (!match?.[1] || !match[2]) continue;
        // Markdown tables escape a pipe inside a code span as `\|`.
        const field = match[1].replaceAll("\\|", "|");
        if (rows.has(field)) throw new Error(`docs/HTML_PROFILE.md classifies ${field} twice`);
        rows.set(field, match[2]);
    }
    return rows;
}

describe("HTML profile", () => {
    const fields = modelFields();
    const rows = profileRows();

    test("walks the whole model", () => {
        // Guards the walker itself: a few fields from different depths and unions.
        for (const field of [
            "PageSize.name",
            "NormalizedSlideObject<text>.shape",
            "NormalizedTextRun.glow",
            "NormalizedTextParagraph.lineBox.baseline",
            "NormalizedTextParagraph.tabStops[].alignment",
            "NormalizedImageSizing<contain|cover>.x",
            "NormalizedShapeGeometry<path>.faces[].fillModifier",
            "NormalizedChartValueAxis.gridLineCap",
        ]) {
            expect(fields).toContain(field);
        }
    });

    test("classifies every model field in docs/HTML_PROFILE.md", () => {
        const missing = [...fields].filter(field => !rows.has(field));
        // A new model field must get a row: profile (where it lives in the HTML), gap (lossy, with a ref) or not drawable.
        expect(missing).toEqual([]);
    });

    test("has no rows for fields the model no longer has", () => {
        expect([...rows.keys()].filter(field => !fields.has(field))).toEqual([]);
    });

    test("uses only the three statuses", () => {
        expect([...rows].filter(([, status]) => !STATUSES.has(status))).toEqual([]);
    });
});
