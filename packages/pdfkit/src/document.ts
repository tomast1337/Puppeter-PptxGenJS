// One render: parses the profile HTML once, writes one PDFKit page per slide container and collects what the
// renderer could not draw and the faces it had no font for.
import { CSS_PX_PER_INCH, htmlDocument, inchesToPoints, type MissingFont, PDF_PRODUCER, POINTS_PER_INCH, profileMetaPrefix } from "@pdflapas/model";
import PDFDocument from "pdfkit";
import { attribute, children, descendants, type Element, hasClass, parseDocument, textContent } from "./dom";
import type { Face } from "./fonts";
import { drawSlide } from "./slide";
import { createShaper } from "./text/shaper";

export interface RenderResult {
    readonly pdf: Uint8Array;
    readonly warnings: string[];
    readonly missingFonts: MissingFont[];
}

const SLIDE_ID = /^slide-(\d+)$/;
/**
 * A fixed creation date (the Unix epoch): PDFKit always writes one, in the Info dictionary and the XMP metadata, and
 * derives the file ID from it, so the date of the render would make every PDF differ. Fixed, the same HTML gives the same bytes.
 */
const FIXED_DATE = new Date(0);

/** The document properties of a version 2 document (docs/HTML_PROFILE.md "Document properties"). */
function documentInfo(head: Element | undefined, prefix: string): PDFKit.DocumentInfo {
    if (!head) return {};
    const meta = (name: string) => children(head).find(element => element.tagName === "meta" && attribute(element, "name") === name && attribute(element, "content"));
    const title = children(head).find(element => element.tagName === "title");
    const author = meta("author");
    const subject = meta("description");
    const company = meta(`${prefix}company`);
    const revision = meta(`${prefix}revision`);
    return {
        ...(title ? { Title: textContent(title).trim().replace(/\s+/g, " ") } : {}),
        ...(author ? { Author: attribute(author, "content") } : {}),
        ...(subject ? { Subject: attribute(subject, "content") } : {}),
        // `as`: ISO 32000-1 14.3.3 allows other keys in the Info dictionary; PDFKit writes them, its types list the standard ones.
        ...((company ? { Company: attribute(company, "content") } : {}) as PDFKit.DocumentInfo),
        ...((revision ? { Revision: attribute(revision, "content") } : {}) as PDFKit.DocumentInfo),
    };
}

async function collect(doc: PDFKit.PDFDocument): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    const done = new Promise<void>((resolve, reject) => {
        doc.on("data", (chunk: Uint8Array) => chunks.push(chunk));
        doc.on("end", () => resolve());
        doc.on("error", reject);
    });
    doc.end();
    await done;
    const pdf = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
        pdf.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return pdf;
}

export async function renderHtml(html: string, faces: readonly Face[]): Promise<RenderResult> {
    const { pageSize } = htmlDocument(html);
    const root = parseDocument(html).find(element => element.tagName === "html");
    const [head, body] = [root && children(root).find(element => element.tagName === "head"), root && children(root).find(element => element.tagName === "body")];
    const prefix = profileMetaPrefix(name => (head ? children(head).find(element => element.tagName === "meta" && attribute(element, "name") === name) : undefined)?.attrs.find(attr => attr.name === "content")?.value);
    const slides = body ? children(body).filter(element => hasClass(element, "slide-container")) : [];
    const size = [inchesToPoints(pageSize.width), inchesToPoints(pageSize.height)];
    const doc = new PDFDocument({
        autoFirstPage: false,
        size,
        margin: 0,
        // `as`: PDFKit 0.20 takes `font: null` to skip its default Helvetica, a standard font its browser build does not
        // ship (every face here comes from the caller); @types/pdfkit 0.17 predates it.
        font: null as unknown as string,
        info: { Creator: PDF_PRODUCER, Producer: PDF_PRODUCER, CreationDate: FIXED_DATE, ...(prefix === "pdflapas-" ? documentInfo(head, prefix) : {}) },
    });

    const warnings = new Set<string>();
    const missing = new Map<string, { objects: Set<string>; used: string | undefined }>();
    const shaper = createShaper(faces);
    const registered = new Set<string>();
    const numbers = slides.map((slide, index) => Number(SLIDE_ID.exec(attribute(slide, "id") ?? "")?.[1] ?? index + 1));
    for (const element of descendants(slides)) {
        const target = attribute(element, "data-slide");
        if (target !== undefined && !numbers.includes(Number(target))) warnings.add(`a link to slide ${target}, which has no page, is not drawn`);
    }
    slides.forEach((slide, index) => {
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
    });
    return {
        pdf: await collect(doc),
        warnings: [...warnings],
        missingFonts: [...missing].map(([face, { objects, used }]) => ({ face, objects: [...objects].sort(), ...(used ? { usedFace: used } : {}) })),
    };
}
