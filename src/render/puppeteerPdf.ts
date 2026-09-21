import puppeteer from "puppeteer";
import { inchesToPixels } from "../utils";
import type { HtmlPresentationDocument, PresentationRenderer } from "./document";

export class PuppeteerPdfRenderer implements PresentationRenderer {
    async render({ html, pageSize }: HtmlPresentationDocument): Promise<Uint8Array> {
        const browser = await puppeteer.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        try {
            const page = await browser.newPage();
            await page.setViewport({
                width: Math.round(inchesToPixels(pageSize.width)),
                height: Math.round(inchesToPixels(pageSize.height)),
            });
            await page.setContent(html, { waitUntil: "networkidle0" });
            const failedImages = await page.evaluate(async () => {
                await document.fonts.ready;
                await Promise.all(
                    Array.from(document.images, image =>
                        image.complete
                            ? Promise.resolve()
                            : new Promise<void>(resolve => {
                                  image.addEventListener("load", () => resolve(), { once: true });
                                  image.addEventListener("error", () => resolve(), { once: true });
                              }),
                    ),
                );

                // LibreOffice's PDF export drops animated GIFs, so it cannot be
                // used as the visual oracle here. Freeze through Chromium's
                // static bitmap decoder to match PowerPoint's PDF first frame.
                const gifs = Array.from(document.images).filter(image => image.src.startsWith("data:image/gif"));
                if (gifs.length) {
                    if (typeof createImageBitmap !== "function") {
                        throw new Error("This Chromium build cannot freeze animated GIF images");
                    }
                    await Promise.all(
                        gifs.map(async image => {
                            const frame = await createImageBitmap(await (await fetch(image.src)).blob());
                            const canvas = document.createElement("canvas");
                            canvas.width = frame.width;
                            canvas.height = frame.height;
                            canvas.getContext("2d")?.drawImage(frame, 0, 0);
                            image.src = canvas.toDataURL("image/png");
                            frame.close();
                        }),
                    );
                    await Promise.all(
                        gifs.map(image =>
                            image.complete
                                ? Promise.resolve()
                                : new Promise<void>(resolve => {
                                      image.addEventListener("load", () => resolve(), { once: true });
                                      image.addEventListener("error", () => resolve(), { once: true });
                                  }),
                        ),
                    );
                }

                // PowerPoint scales the decoded image surface into its declared
                // blip rectangle. Explicitly transform from natural pixels so
                // SVG preserveAspectRatio rules cannot override that geometry.
                document.querySelectorAll<HTMLImageElement>(".slide-image-content").forEach(image => {
                    if (!image.naturalWidth || !image.naturalHeight) return;
                    const computed = getComputedStyle(image);
                    const targetWidth = parseFloat(computed.width);
                    const targetHeight = parseFloat(computed.height);
                    if (!targetWidth || !targetHeight) return;
                    image.style.width = `${image.naturalWidth}px`;
                    image.style.height = `${image.naturalHeight}px`;
                    image.style.transformOrigin = "top left";
                    image.style.transform = `scale(${targetWidth / image.naturalWidth}, ${targetHeight / image.naturalHeight})`;
                });

                document.querySelectorAll<HTMLElement>('.slide-text[data-text-fit="shrink"]').forEach(box => {
                    const content = box.querySelector<HTMLElement>(".text-content");
                    if (!content) return;
                    const boxStyle = getComputedStyle(box);
                    const availableWidth = box.clientWidth - parseFloat(boxStyle.paddingLeft) - parseFloat(boxStyle.paddingRight);
                    const availableHeight = box.clientHeight - parseFloat(boxStyle.paddingTop) - parseFloat(boxStyle.paddingBottom);
                    for (
                        let iteration = 0;
                        iteration < 20 && (content.scrollWidth > availableWidth + 0.5 || content.scrollHeight > availableHeight + 0.5);
                        iteration++
                    ) {
                        content.querySelectorAll<HTMLElement>(".text-run, .text-bullet").forEach(run => {
                            run.style.fontSize = `${parseFloat(getComputedStyle(run).fontSize) * 0.95}px`;
                        });
                        content.querySelectorAll<HTMLElement>(".text-paragraph").forEach(paragraph => {
                            const lineHeight = paragraph.style.lineHeight;
                            if (lineHeight.endsWith("px")) paragraph.style.lineHeight = `${parseFloat(lineHeight) * 0.95}px`;
                        });
                    }
                });
                return Array.from(document.images)
                    .filter(image => image.naturalWidth === 0 || image.naturalHeight === 0)
                    .map(image => image.alt || image.closest<HTMLElement>("[data-object-name]")?.dataset.objectName || "unnamed image");
            });
            if (failedImages.length) throw new Error(`Image failed to decode: ${failedImages.join(", ")}`);

            return page.pdf({
                width: `${pageSize.width}in`,
                height: `${pageSize.height}in`,
                printBackground: true,
                margin: { top: 0, right: 0, bottom: 0, left: 0 },
            });
        } finally {
            await browser.close();
        }
    }
}
