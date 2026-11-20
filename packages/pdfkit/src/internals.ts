// The PDFKit internals the renderer needs past its public API: the current transform, the page's content stream and
// resources (to move drawn content under an effect, or into a transparency group), and objects built by hand (an
// effect's raw mask, a form XObject). pdfkit is pinned to an exact version in package.json, so these fields cannot
// move under the renderer.
import { apply, invert, type Matrix } from "./path";

interface PdfReference {
    write(data: Uint8Array): void;
    end(data?: Uint8Array): void;
}

interface PdfkitInternals {
    readonly _ctm: number[];
    readonly page: {
        readonly width: number;
        readonly height: number;
        readonly content: { readonly buffer: Uint8Array[] };
        readonly resources: PdfReference;
        readonly xobjects: Record<string, unknown>;
    };
    ref(data: Record<string, unknown>): PdfReference;
    addContent(data: string): void;
}

export function internals(doc: PDFKit.PDFDocument): PdfkitInternals {
    return doc as unknown as PdfkitInternals; // `as`: the fields above exist on every PDFKit 0.20 document
}

export function currentTransform(doc: PDFKit.PDFDocument): Matrix {
    const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = internals(doc)._ctm;
    return [a, b, c, d, e, f];
}

/**
 * Runs `draw` into a transparency group painted with `opacity`, so overlapping fills and strokes inside fade as one
 * (SVG's and CSS's `opacity`; pdf-core's `push_opacity`). The drawn content moves out of the page into a form
 * XObject that shares the page's resources.
 */
export function opacityGroup(doc: PDFKit.PDFDocument, opacity: number, draw: () => void): void {
    if (opacity >= 1) {
        draw();
        return;
    }
    const pdf = internals(doc);
    const content = pdf.page.content.buffer;
    const start = content.length;
    draw();
    const drawn = content.splice(start);
    const inverse = invert(currentTransform(doc));
    // Nothing drawn, or a degenerate transform that shows nothing.
    if (!drawn.length || !inverse) return;
    // The group's box: the whole page, in the user space the group is painted in.
    const corners = [apply(inverse, 0, 0), apply(inverse, pdf.page.width, 0), apply(inverse, 0, pdf.page.height), apply(inverse, pdf.page.width, pdf.page.height)];
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    const form = pdf.ref({ Type: "XObject", Subtype: "Form", BBox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], Group: { Type: "Group", S: "Transparency" }, Resources: pdf.page.resources });
    for (const chunk of drawn) form.write(chunk);
    form.end();
    // Names only grow on a page, so the count names a new one.
    const name = `FG${Object.keys(pdf.page.xobjects).length + 1}`;
    pdf.page.xobjects[name] = form;
    doc.save();
    // A group XObject is painted with the fill alpha (ISO 32000-1 11.6.4.4).
    doc.fillOpacity(opacity);
    pdf.addContent(`/${name} Do`);
    doc.restore();
}
