// Common page sizes and layouts for presentation/document generation
export interface PageSize {
    width: number;  // in inches
    height: number; // in inches
    name: string;
}

export interface PageLayout {
    landscape: PageSize;
    portrait: PageSize;
}

// Common page sizes (dimensions in inches)
export const PAGE_SIZES = {
    // Standard presentation sizes
    SCREEN_4X3: {
        landscape: { width: 10, height: 7.5, name: "Screen 4:3 Landscape" },
        portrait: { width: 7.5, height: 10, name: "Screen 4:3 Portrait" }
    },
    SCREEN_16X9: {
        landscape: { width: 10, height: 5.625, name: "Screen 16:9 Landscape" },
        portrait: { width: 5.625, height: 10, name: "Screen 16:9 Portrait" }
    },
    SCREEN_16X10: {
        landscape: { width: 10, height: 6.25, name: "Screen 16:10 Landscape" },
        portrait: { width: 6.25, height: 10, name: "Screen 16:10 Portrait" }
    },
    
    // Letter size
    LETTER: {
        landscape: { width: 11, height: 8.5, name: "Letter Landscape" },
        portrait: { width: 8.5, height: 11, name: "Letter Portrait" }
    },
    
    // Legal size
    LEGAL: {
        landscape: { width: 14, height: 8.5, name: "Legal Landscape" },
        portrait: { width: 8.5, height: 14, name: "Legal Portrait" }
    },
    
    // A4 size
    A4: {
        landscape: { width: 11.69, height: 8.27, name: "A4 Landscape" },
        portrait: { width: 8.27, height: 11.69, name: "A4 Portrait" }
    },
    
    // A3 size
    A3: {
        landscape: { width: 16.54, height: 11.69, name: "A3 Landscape" },
        portrait: { width: 11.69, height: 16.54, name: "A3 Portrait" }
    },
    
    // Tabloid/Ledger
    TABLOID: {
        landscape: { width: 17, height: 11, name: "Tabloid Landscape" },
        portrait: { width: 11, height: 17, name: "Tabloid Portrait" }
    }
} as const;

export type PageSizeName = keyof typeof PAGE_SIZES;
export type Orientation = "landscape" | "portrait";

// Default layout (16:9 landscape)
export const DEFAULT_PAGE_SIZE = PAGE_SIZES.SCREEN_16X9.landscape;

