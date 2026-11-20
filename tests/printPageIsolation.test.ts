import { afterAll, expect, test } from "bun:test";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { closeBrowser } from "../packages/puppeteer/src/browser";
import { PuppeteerPdfRenderer } from "../packages/puppeteer/src/puppeteerPdf";

afterAll(closeBrowser);

const GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

/** The PDF hex string withDocumentInfo writes for `text` (UTF-16BE with a byte order mark). */
function hex(text: string): string {
    return `<FEFF${Array.from(text, character => character.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")).join("")}>`;
}

test("the print page requests nothing from the network and runs no script, and still prints", async () => {
    const requests: string[] = [];
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request) {
            requests.push(new URL(request.url).pathname);
            return new Response("<html><body>internal</body></html>", { headers: { "content-type": "text/html" } });
        },
    });
    try {
        const origin = `http://127.0.0.1:${server.port}`;
        const presentation = new PuppeteerGen();
        presentation.title = "Kept";
        const slide = presentation.addSlide();
        slide.addText("Text", { x: 1, y: 1, w: 4, h: 1 });
        // A GIF still freezes to its first frame with scripts off: that step runs through the DevTools protocol.
        slide.addImage({ data: GIF, x: 1, y: 2, w: 1, h: 1 });
        const document = await presentation.toHtml();
        const untrusted = [
            `<svg width="10" height="10"><image href="${origin}/image.png" width="10" height="10"></image></svg>`,
            `<iframe src="${origin}/frame"></iframe>`,
            `<link rel="stylesheet" href="${origin}/style.css">`,
            `<div style="background: url('${origin}/background.png'); width: 10px; height: 10px;"></div>`,
            `<script>fetch("${origin}/script"); document.title = "Changed";</script>`,
            `<svg width="1" height="1" onload="document.title = 'Changed'"></svg>`,
        ].join("");
        const html = document.html.replace("</body>", `${untrusted}</body>`);
        expect(html).not.toBe(document.html);

        const pdf = new TextDecoder("latin1").decode(await new PuppeteerPdfRenderer().render({ ...document, html }));
        expect(pdf.startsWith("%PDF-")).toBe(true);
        expect(requests).toEqual([]);
        expect(pdf).not.toContain(hex("Changed"));
        expect(pdf).toContain(hex("Kept"));

        // An <img> naming a host is blocked like the rest, and fails as any image that does not decode.
        await expect(new PuppeteerPdfRenderer().render({ ...document, html: document.html.replace("</body>", `<img alt="Remote" src="${origin}/img.png"></body>`) })).rejects.toThrow("Image failed to decode: Remote");
        expect(requests).toEqual([]);
    } finally {
        await server.stop(true);
    }
});
