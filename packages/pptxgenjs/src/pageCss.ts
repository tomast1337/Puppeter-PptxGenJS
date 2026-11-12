import type { PageSize } from "./pageLayouts";
import { inchesToPixels } from "./units";

/**
 * Generates CSS for a slide page with specific dimensions
 */
export function generatePageCSS(pageSize: PageSize): string {
    const widthPx = inchesToPixels(pageSize.width);
    const heightPx = inchesToPixels(pageSize.height);

    return `
@page {
    size: ${pageSize.width}in ${pageSize.height}in;
    margin: 0;
}

body {
    margin: 0;
    padding: 0;
    font-family: Arial, Helvetica, sans-serif;
}

.slide-container {
    width: ${widthPx}px;
    height: ${heightPx}px;
    position: relative;
    page-break-after: always;
    background: white;
    overflow: hidden;
}

.slide-container:last-child {
    page-break-after: auto;
}

.slide-element {
    position: absolute;
    box-sizing: border-box;
}

.slide-text {
    display: flex;
    align-items: center;
    overflow: hidden;
    word-wrap: break-word;
}

.slide-shape {
    border-style: solid;
}

.slide-table {
    border-collapse: collapse;
}

.slide-table td,
.slide-table th {
    border: 1px solid #ddd;
    padding: 8px;
}

@media print {
    body {
        margin: 0;
        padding: 0;
    }
    
    .slide-container {
        page-break-after: always;
        break-after: page;
    }
    
    .slide-container:last-child {
        page-break-after: auto;
        break-after: auto;
    }
}
    `.trim();
}
