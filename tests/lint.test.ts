import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { ESLint } from "eslint";

const ROOT = resolve(import.meta.dir, "..");

test("each lint rule reports its one violation in the fixture", async () => {
    // ignore: false lints the fixture, which `bun run lint` skips.
    const eslint = new ESLint({ cwd: ROOT, ignore: false });
    const [result] = await eslint.lintFiles(["tests/lintFixture/violations.ts"]);
    const errors = result?.messages.map(message => `${message.line} ${message.ruleId}`);

    expect(errors).toEqual(["4 curly", "12 @stylistic/brace-style", "21 @stylistic/padding-line-between-statements", "25 pdflapas/no-for-each", "29 pdflapas/no-reduce", "33 pdflapas/no-array-chain", "36 pdflapas/no-nullable-return", "40 @typescript-eslint/consistent-type-definitions"]);
});
