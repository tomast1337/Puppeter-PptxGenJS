// One render: parses the profile HTML once, writes one PDFKit page per slide container and collects what the
// renderer could not draw and the faces it had no font for.
import { CSS_PX_PER_INCH, htmlDocument, inchesToPoints, type MissingFont, PDF_PRODUCER, POINTS_PER_INCH, profileMetaPrefix } from "@pdflapas/model";
import PDFDocument from "pdfkit";
import { attribute, children, descendants, hasClass, parseDocument, textContent } from "./dom";
import type { Face } from "./fonts";
import { drawSlide } from "./slide";
import { Effects } from "./effect/index";
import { createShaper } from "./text/shaper";

export type RenderResult = {
    readonly pdf: Uint8Array;
    readonly warnings: string[];
    readonly missingFonts: MissingFont[];
};

const SLIDE_ID = /^slide-(\d+)$/;
/**
 * The date PDFKit derives the file ID from when the deck sets none (the Unix epoch): PDFKit dates every document at
 * construction, so the date of the render would make every PDF differ. The Info dictionary then drops it, as the
 * other renderers write no date the deck does not set.
 */
const FIXED_DATE = new Date(0);
/** The profile's date: UTC to the second or millisecond, as `Date.prototype.toISOString()` writes it. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export async function renderHtml(html: string, faces: readonly Face[]): Promise<RenderResult> {
    const { pageSize } = htmlDocument(html);
    const root = parseDocument(html).find(element => element.tagName === "html");
    const [head, body] = [root && children(root).find(element => element.tagName === "head"), root && children(root).find(element => element.tagName === "body")];
    const prefix = profileMetaPrefix(name => (head ? children(head).find(element => element.tagName === "meta" && attribute(element, "name") === name) : undefined)?.attrs.find(attr => attr.name === "content")?.value);
    const slides = body ? children(body).filter(element => hasClass(element, "slide-container")) : [];
    const size = [inchesToPoints(pageSize.width), inchesToPoints(pageSize.height)];
    // The document properties of a version 2 document (docs/HTML_PROFILE.md "Document properties").
    let properties: PDFKit.DocumentInfo = {};

    if (prefix === "pdflapas-" && head) {
        const meta = (name: string) => {
            const element = children(head).find(child => child.tagName === "meta" && attribute(child, "name") === name);

            return element && attribute(element, "content");
        };
        const title = children(head).find(element => element.tagName === "title");
        const text = {
            Author: meta("author"),
            Subject: meta("description"),
            Keywords: meta("keywords"),
            Creator: meta(`${prefix}creator`),
            Producer: meta(`${prefix}producer`),
            Company: meta(`${prefix}company`),
            Revision: meta(`${prefix}revision`),
        };
        const profileDates: (Date | undefined)[] = [];

        for (const value of [meta(`${prefix}creation-date`), meta(`${prefix}modification-date`)]) {
            if (!value) {
                profileDates.push(undefined);
                continue;
            }

            const date = new Date(value);

            if (!ISO_DATE.test(value) || Number.isNaN(date.getTime())) {
                throw new Error(`Cannot write the PDF dates: ${JSON.stringify(value)} is not a UTC date such as 2026-11-19T12:34:56.000Z (Date.prototype.toISOString()).`);
            }

            // PDF dates are to the second (D:YYYYMMDDHHmmSSZ), as in the other renderers.
            profileDates.push(new Date(Math.floor(date.getTime() / 1000) * 1000));
        }

        const [created, modified] = profileDates;
        // A date alone is both, as krilla (one date) writes it in the WASM renderer.
        const dates = created || modified ? { CreationDate: created ?? modified, ModDate: modified ?? created } : {};

        properties = {
            ...(title ? { Title: textContent(title).trim().replace(/\s+/g, " ") } : {}),
            // `as`: ISO 32000-1 14.3.3 allows other keys (Company, Revision) in the Info dictionary; PDFKit writes them, its types list the standard ones.
            ...(Object.fromEntries(Object.entries(text).filter(([, value]) => value)) as PDFKit.DocumentInfo),
            ...dates,
        };
    }

    const info = { Creator: PDF_PRODUCER, Producer: PDF_PRODUCER, ...properties };
    const doc = new PDFDocument({
        autoFirstPage: false,
        size,
        margin: 0,
        // `as`: PDFKit 0.20 takes `font: null` to skip its default Helvetica, a standard font its browser build does not
        // ship (every face here comes from the caller); @types/pdfkit 0.17 predates it.
        font: null as unknown as string,
        info: { CreationDate: FIXED_DATE, ...info },
    });

    // Without a date of the deck's the Info dictionary has none: PDFKit writes the enumerable entries of `doc.info`,
    // and still reads CreationDate for its XMP packet (unwritten in PDF 1.3), so the date stays, hidden from the loop.
    if (!info.CreationDate) {
        Object.defineProperty(doc.info, "CreationDate", { value: FIXED_DATE, enumerable: false });
    }

    const warnings = new Set<string>();
    const missing = new Map<string, { objects: Set<string>; used: string | undefined }>();
    const shaper = createShaper(faces);
    const registered = new Set<string>();
    const effects = new Effects();
    const numbers = slides.map((slide, index) => Number(SLIDE_ID.exec(attribute(slide, "id") ?? "")?.[1] ?? index + 1));

    for (const element of descendants(slides)) {
        const target = attribute(element, "data-slide");

        if (target !== undefined && !numbers.includes(Number(target))) {
            warnings.add(`a link to slide ${target}, which has no page, is not drawn`);
        }
    }

    for (const [index, slide] of slides.entries()) {
        const number = numbers[index] ?? index + 1;

        doc.addPage({ size, margin: 0 });
        doc.addNamedDestination(`slide-${number}`);
        doc.scale(POINTS_PER_INCH / CSS_PX_PER_INCH);
        const report = (what: string) => warnings.add(`slide ${number}: ${what}`);

        drawSlide(
            slide,
            {
                report,
                paint: object => ({
                    doc,
                    shaper,
                    registered,
                    effects,
                    report,
                    missingFace: (face, used) => {
                        const entry = missing.get(face) ?? { objects: new Set<string>(), used };

                        entry.objects.add(`slide ${number} '${object}'`);
                        missing.set(face, entry);
                    },
                }),
            },
            { width: pageSize.width * CSS_PX_PER_INCH, height: pageSize.height * CSS_PX_PER_INCH },
        );
    }

    // The PDF bytes PDFKit streams out once the document ends.
    const chunks: Uint8Array[] = [];
    const done = new Promise<void>((resolve, reject) => {
        doc.on("data", (chunk: Uint8Array) => chunks.push(chunk));
        doc.on("end", () => resolve());
        doc.on("error", reject);
    });

    doc.end();
    await done;
    let byteLength = 0;

    for (const chunk of chunks) {
        byteLength += chunk.byteLength;
    }

    const pdf = new Uint8Array(byteLength);
    let offset = 0;

    for (const chunk of chunks) {
        pdf.set(chunk, offset);
        offset += chunk.byteLength;
    }

    return {
        pdf,
        warnings: [...warnings],
        missingFonts: [...missing].map(([face, { objects, used }]) => ({ face, objects: [...objects].sort(), ...(used ? { usedFace: used } : {}) })),
    };
}
