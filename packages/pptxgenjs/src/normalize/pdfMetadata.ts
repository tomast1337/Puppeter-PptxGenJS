import type { PresentationMetadata } from "@pdflapas/model";

/**
 * PDF document properties PptxGenJS has no field for, so a PdfLapas extension (`PuppeteerGenOptions.pdfMetadata`)
 * rather than `pres.*` properties. Unset, Creator and Producer are `PDF_PRODUCER` and the PDF has no dates.
 */
export interface PdfMetadataOptions {
    /** The PDF /Creator: the application the document was made with. */
    creator?: string;
    /** The PDF /Producer: the software that wrote the PDF. */
    producer?: string;
    /** The PDF /Keywords, written as given. */
    keywords?: string;
    /** The PDF /CreationDate, written in UTC to the second. Without `modificationDate`, it is also the /ModDate. */
    creationDate?: Date;
    /** The PDF /ModDate, written in UTC to the second. Without `creationDate`, it is also the /CreationDate. */
    modificationDate?: Date;
}

const STRING_KEYS = ["creator", "producer", "keywords"] as const;
const DATE_KEYS = ["creationDate", "modificationDate"] as const;
const KNOWN_KEYS: ReadonlySet<string> = new Set([...STRING_KEYS, ...DATE_KEYS]);
/** A PDF date has a four-digit year (ISO 32000-1, 7.9.4), and toISOString() writes other years with a sign. */
const MAX_PDF_YEAR = 9999;

/** The `pdfMetadata` option, checked, as model metadata: dates as UTC ISO strings, empty strings left out. */
export function normalizePdfMetadata(input: unknown): PresentationMetadata {
    if (input === undefined) return {};
    if (typeof input !== "object" || input === null || Array.isArray(input)) throw new TypeError(`PuppeteerGen option \`pdfMetadata\` must be an object, got ${describe(input)}`);
    const options: Record<string, unknown> = { ...input };
    const unknown = Object.keys(options).find(key => !KNOWN_KEYS.has(key));
    if (unknown !== undefined) throw new TypeError(`PuppeteerGen option \`pdfMetadata.${unknown}\` is not a PDF property PdfLapas writes; use one of ${[...KNOWN_KEYS].join(", ")}`);
    const strings = STRING_KEYS.flatMap(key => {
        const value = options[key];
        if (value === undefined || value === "") return [];
        if (typeof value !== "string") throw new TypeError(`PuppeteerGen option \`pdfMetadata.${key}\` must be a string, got ${describe(value)}`);
        return [[key, value]];
    });
    const dates = DATE_KEYS.flatMap(key => {
        const value = options[key];
        return value === undefined ? [] : [[key, isoDate(key, value)]];
    });
    return Object.fromEntries([...strings, ...dates]);
}

function isoDate(key: string, value: unknown): string {
    if (!(value instanceof Date)) throw new TypeError(`PuppeteerGen option \`pdfMetadata.${key}\` must be a Date, got ${describe(value)}`);
    const year = value.getUTCFullYear();
    if (Number.isNaN(year)) throw new RangeError(`PuppeteerGen option \`pdfMetadata.${key}\` is an Invalid Date; pass a Date built from a valid time, such as new Date("2026-11-19T12:00:00Z")`);
    if (year < 0 || year > MAX_PDF_YEAR) throw new RangeError(`PuppeteerGen option \`pdfMetadata.${key}\` is in the year ${year}; a PDF date needs a year from 0 to ${MAX_PDF_YEAR}`);
    return value.toISOString();
}

function describe(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "an array";
    return typeof value;
}
