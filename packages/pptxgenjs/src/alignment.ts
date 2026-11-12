/**
 * Converts PptxGenJS alignment to CSS text-align
 */
export function alignToCSS(align?: string): string {
    switch (align?.toLowerCase()) {
        case "left":
            return "left";
        case "center":
            return "center";
        case "right":
            return "right";
        case "justify":
            return "justify";
        default:
            return "left";
    }
}

/**
 * Converts PptxGenJS vertical alignment to CSS align-items
 */
export function valignToCSS(valign?: string): string {
    switch (valign?.toLowerCase()) {
        case "top":
            return "flex-start";
        case "middle":
        case "center":
            return "center";
        case "bottom":
            return "flex-end";
        default:
            return "flex-start";
    }
}
