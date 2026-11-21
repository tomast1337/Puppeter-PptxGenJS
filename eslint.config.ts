// ESLint enforces the AGENTS.md rules bun fmt cannot: "Structured flow", "Errors are values inside" and
// "Layout the formatter does not do". bun fmt owns every other layout question, so no formatting rule is
// enabled here. No rule needs type information, so the plain parser keeps `bun run lint` fast.
import stylistic from "@stylistic/eslint-plugin";
import type { ESLint, Linter, Rule } from "eslint";
import tseslint from "typescript-eslint";

const SOURCES = ["packages/*/src/**/*.{ts,tsx}", "scripts/**/*.ts", "tests/**/*.{ts,tsx}", "examples/**/*.ts"];

// A function, method or function type, whose return type annotation the nullable-return rule reads.
const FUNCTION = ":matches(FunctionDeclaration, FunctionExpression, ArrowFunctionExpression, TSDeclareFunction, TSEmptyBodyFunctionExpression, TSMethodSignature, TSFunctionType)";

// Each syntax rule is its own rule, not one `no-restricted-syntax` list, so a folder not yet converted can
// skip one of them and keep the others.
const SYNTAX_RULES = {
    "no-for-each": {
        selector: "CallExpression[callee.property.name='forEach']",
        message: "Use a for...of loop instead of forEach (AGENTS.md, Structured flow).",
    },
    "no-reduce": {
        selector: "CallExpression[callee.property.name=/^reduce(Right)?$/]",
        message: "Use a for...of loop instead of reduce (AGENTS.md, Structured flow).",
    },
    "no-array-chain": {
        selector: "CallExpression[callee.property.name=/^(map|filter|flatMap)$/][callee.object.type='CallExpression'][callee.object.callee.property.name=/^(map|filter|flatMap)$/]",
        message: "Write one loop that pushes into the result instead of chaining map/filter/flatMap (AGENTS.md, Structured flow).",
    },
    // The return type itself, or the value of the Promise it returns; not unions nested deeper (a callback's parameter).
    "no-nullable-return": {
        selector: `${FUNCTION} > TSTypeAnnotation.returnType > TSUnionType > :matches(TSUndefinedKeyword, TSNullKeyword), ${FUNCTION} > TSTypeAnnotation.returnType > TSTypeReference[typeName.name='Promise'] > TSTypeParameterInstantiation > TSUnionType > :matches(TSUndefinedKeyword, TSNullKeyword)`,
        message: "Return a tagged union that names each outcome, not T | undefined or T | null (AGENTS.md, Errors are values inside).",
    },
} as const;

const pdflapasRules: Record<string, Rule.RuleModule> = {};

for (const [name, { selector, message }] of Object.entries(SYNTAX_RULES)) {
    pdflapasRules[name] = {
        meta: { type: "suggestion", schema: [] },
        create: context => ({ [selector]: (node: Rule.Node) => context.report({ node, message }) }),
    };
}

const pdflapas: ESLint.Plugin = { rules: pdflapasRules };

const RULES: Linter.RulesRecord = {
    curly: ["error", "all"],
    "@stylistic/brace-style": ["error", "1tbs", { allowSingleLine: false }],
    "@stylistic/padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "*", next: "return" },
        { blankLine: "always", prev: ["if", "for", "while", "do", "switch", "try", "block"], next: "*" },
        { blankLine: "always", prev: ["const", "let", "var"], next: "*" },
        { blankLine: "any", prev: ["const", "let", "var"], next: ["const", "let", "var"] },
    ],
    "pdflapas/no-for-each": "error",
    "pdflapas/no-reduce": "error",
    "pdflapas/no-array-chain": "error",
    "pdflapas/no-nullable-return": "error",
};

export default [
    {
        ignores: [
            "**/dist/**",
            // Generated: written by scripts/generate-preset-shapes.ts and by wasm-bindgen.
            "packages/pptxgenjs/src/generatedPresetShapes.ts",
            "packages/wasm/src/pdf_wasm.js",
            "packages/wasm/src/pdf_wasm.d.ts",
            // One violation per rule, linted on purpose by tests/lint.test.ts.
            "tests/lintFixture/**",
        ],
    },
    {
        files: SOURCES,
        languageOptions: { parser: tseslint.parser },
        linterOptions: { reportUnusedDisableDirectives: "error" },
        plugins: { "@stylistic": stylistic, pdflapas },
        rules: RULES,
    },
] satisfies Linter.Config[];
