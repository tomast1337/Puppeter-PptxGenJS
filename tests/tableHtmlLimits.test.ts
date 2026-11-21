import { describe, expect, test } from "bun:test";
import { checkTableHtmlLimits, TABLE_HTML_LIMITS } from "../packages/pptxgenjs/src/normalize/table/htmlLimits";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";

const nested = (depth: number, tag = "div") => `<table><tr><td>${`<${tag}>`.repeat(depth)}x${`</${tag}>`.repeat(depth)}</td></tr></table>`;

describe("tableToSlides HTML limits (#359)", () => {
    test("the defaults are named once", () => {
        expect(TABLE_HTML_LIMITS).toEqual({ maxLength: 1024 * 1024, maxDepth: 512 });
    });

    test("rejects deep nesting before parsing, quickly", () => {
        const markup = nested(50_000);
        const start = performance.now();

        expect(() => new PuppeteerGen().tableToSlides(markup)).toThrow("tableToSlides: the HTML string nests elements more than 512 deep; flatten the markup, or raise the limit with the option htmlLimits: { maxDepth }");
        // Parsing this would take minutes; the check is one pass over the tags.
        expect(performance.now() - start).toBeLessThan(1000);
    });

    test("rejects markup over maxLength, and both limits can be raised", () => {
        const markup = `<table><tr><td>${"x".repeat(100)}</td></tr></table>`;

        expect(() => new PuppeteerGen().tableToSlides(markup, { htmlLimits: { maxLength: 50 } })).toThrow(`the HTML string is ${markup.length} characters long, over the limit of 50`);
        const presentation = new PuppeteerGen();

        presentation.tableToSlides(nested(600), { htmlLimits: { maxDepth: 700 } });
        expect(presentation.getModel().slides).toHaveLength(1);
    });

    test("checks the limit options", () => {
        expect(() => new PuppeteerGen().tableToSlides("<table></table>", { htmlLimits: { maxDepth: 0 } })).toThrow("`htmlLimits.maxDepth` must be a positive integer, got 0");
    });

    test("counts the depth the parser builds: void elements, omitted end tags, comments and raw text do not nest", () => {
        const rows = "<tr><td>a<td>b<br><img src=x>".repeat(2000);

        expect(() => checkTableHtmlLimits(`<table>${rows}</table>`, { maxDepth: 8 })).not.toThrow();
        expect(() => checkTableHtmlLimits(`<ul>${"<li><p>item".repeat(2000)}</ul>`, { maxDepth: 8 })).not.toThrow();
        expect(() => checkTableHtmlLimits(`<table><tr><td><style>${"<div>".repeat(100)}</style><!--${"<div>".repeat(100)}--></td></tr></table>`, { maxDepth: 8 })).not.toThrow();
        // An end tag closes what was left open inside its element, as the parser does.
        expect(() => checkTableHtmlLimits(`<table><tr>${"<td><div><span>x</td>".repeat(2000)}</tr></table>`, { maxDepth: 8 })).not.toThrow();
        // An end tag with nothing to close closes nothing.
        expect(() => checkTableHtmlLimits(`${"<div></span>".repeat(20)}`, { maxDepth: 8 })).toThrow("more than 8 deep");
        // Markup without ">" stays linear.
        const start = performance.now();

        expect(() => checkTableHtmlLimits("<a".repeat(200_000))).not.toThrow();
        expect(performance.now() - start).toBeLessThan(1000);
    });
});
