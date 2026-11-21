// Common page sizes and layouts for presentation/document generation
import type { PageSize, PageSizeInput } from "@pdflapas/model";
import { CUSTOM_PAGE_SIZE_NAME, inches } from "@pdflapas/model";
import { PPTX_DEFAULTS } from "./defaults";

export type { PageSize, PageSizeInput } from "@pdflapas/model";

export type PageLayout = {
    landscape: PageSize;
    portrait: PageSize;
};

/** A page size from its width and height in inches. */
export function pageSize(width: number, height: number, name: string): PageSize {
    return { width: inches(width), height: inches(height), name };
}

/** A caller's page size, checked and branded: width and height in inches greater than zero, name optional. */
export function checkedPageSize(caller: string, input: Partial<PageSizeInput> | undefined): PageSize {
    // Number(): PptxGenJS callers in plain JavaScript may pass numeric strings, which PptxGenJS multiplies as numbers.
    const width = Number(input?.width);
    const height = Number(input?.height);

    if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) {
        throw new Error(`${caller} needs { name, width, height } with width and height in inches greater than zero, got ${JSON.stringify(input)}`);
    }

    return pageSize(width, height, typeof input?.name === "string" && input.name ? input.name : CUSTOM_PAGE_SIZE_NAME);
}

// Common page sizes (dimensions in inches)
export const PAGE_SIZES = {
    // Standard presentation sizes
    SCREEN_4X3: {
        landscape: pageSize(10, 7.5, "Screen 4:3 Landscape"),
        portrait: pageSize(7.5, 10, "Screen 4:3 Portrait"),
    },
    SCREEN_16X9: {
        landscape: pageSize(10, 5.625, "Screen 16:9 Landscape"),
        portrait: pageSize(5.625, 10, "Screen 16:9 Portrait"),
    },
    SCREEN_16X10: {
        landscape: pageSize(10, 6.25, "Screen 16:10 Landscape"),
        portrait: pageSize(6.25, 10, "Screen 16:10 Portrait"),
    },

    // Letter size
    LETTER: {
        landscape: pageSize(11, 8.5, "Letter Landscape"),
        portrait: pageSize(8.5, 11, "Letter Portrait"),
    },

    // Legal size
    LEGAL: {
        landscape: pageSize(14, 8.5, "Legal Landscape"),
        portrait: pageSize(8.5, 14, "Legal Portrait"),
    },

    // A4 size
    A4: {
        landscape: pageSize(11.69, 8.27, "A4 Landscape"),
        portrait: pageSize(8.27, 11.69, "A4 Portrait"),
    },

    // A3 size
    A3: {
        landscape: pageSize(16.54, 11.69, "A3 Landscape"),
        portrait: pageSize(11.69, 16.54, "A3 Portrait"),
    },

    // Tabloid/Ledger
    TABLOID: {
        landscape: pageSize(17, 11, "Tabloid Landscape"),
        portrait: pageSize(11, 17, "Tabloid Portrait"),
    },
} as const;

export type PageSizeName = keyof typeof PAGE_SIZES;
export type Orientation = "landscape" | "portrait";

// Default layout (16:9 landscape)
export const DEFAULT_PAGE_SIZE = PAGE_SIZES.SCREEN_16X9.landscape;

const { LAYOUT_WIDE } = PPTX_DEFAULTS.presentation.layouts;

/** The page size of each built-in `pres.layout` name (sizes in PPTX_DEFAULTS.presentation.layouts); three are PAGE_SIZES screens. */
export const PPTX_LAYOUT_PAGE_SIZES: Readonly<Record<keyof typeof PPTX_DEFAULTS.presentation.layouts, PageSize>> = Object.freeze({
    LAYOUT_4x3: PAGE_SIZES.SCREEN_4X3.landscape,
    LAYOUT_16x9: PAGE_SIZES.SCREEN_16X9.landscape,
    LAYOUT_16x10: PAGE_SIZES.SCREEN_16X10.landscape,
    LAYOUT_WIDE: Object.freeze(pageSize(LAYOUT_WIDE.width, LAYOUT_WIDE.height, "Screen Wide Landscape")),
});

// The name of a page size given only by its dimensions (`defineLayout()` without a name, an `@page` rule).
export { CUSTOM_PAGE_SIZE_NAME } from "@pdflapas/model";
