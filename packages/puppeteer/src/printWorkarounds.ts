/**
 * Chromium-only declarations derived from values the pdfdeck HTML profile states once (docs/HTML_PROFILE.md,
 * "Renderer workarounds"), set in the page before printing so they stay out of the document.
 *
 * It runs in the page through `page.evaluate`, so it is self-contained: no imports and no module-level
 * bindings, and its constants live in its body. Tests call it with a jsdom document.
 */
export function applyPrintWorkarounds(root: ParentNode = document): void {
    // Lengths are read from the raw `style` attribute: the CSSOM serializes them to 6 significant digits.
    const LINE_HEIGHT = /(?:^|; )line-height: ([^;]+)px;/;
    const LEFT = /(?:^|; )left: ([^;]+)px;/;
    const TOP = /(?:^|; )top: ([^;]+)px;/;
    const ROTATE = /rotate\(([^)]+)deg\)/;
    const BORDER_WIDTH = /(?:^|; )border-(?:top|right|bottom|left): ([^ ;]+)px /g;
    const number = (element: Element, value: string | undefined, what: string): number => {
        const parsed = Number(value);
        if (value !== undefined && Number.isFinite(parsed)) return parsed;
        const object = element.closest("[data-object-name]")?.getAttribute("data-object-name") ?? "unnamed object";
        throw new Error(`Cannot print '${object}': its ${element.classList[0] ? `.${element.classList[0]}` : `<${element.localName}>`} has no ${what} (pdfdeck HTML profile)`);
    };
    // 1e-4 px is far below Chromium's 1/64 px layout unit; it drops float noise from inch conversions.
    const fraction = (value: number) => Math.round((value - Math.round(value)) * 1e4) / 1e4;
    const local = (value: number) => Number(value.toFixed(4)) || 0;
    const px = (element: Element, pattern: RegExp, property: string) => number(element, element.getAttribute("style")?.match(pattern)?.[1], `'${property}: <number>px' in its style attribute`);

    // Line box: the paragraph's 0px-font strut (stylesheet) puts the baseline in the middle of `line-height`;
    // moving the paragraph puts it at data-line-baseline, where LibreOffice puts it.
    // shortcut: vertical text keeps the centred baseline; shift along the block axis once it is measured.
    root.querySelectorAll<HTMLElement>('[data-text-direction="horizontal"] > .text-content > .text-paragraph').forEach(paragraph => {
        const height = px(paragraph, LINE_HEIGHT, "line-height");
        const baseline = number(paragraph, paragraph.dataset.lineBaseline, "numeric data-line-baseline");
        paragraph.style.position = "relative";
        paragraph.style.top = `${baseline - height / 2}px`;
    });

    root.querySelectorAll<SVGSVGElement>("svg.shape-svg").forEach(svg => {
        // Print snap: Chromium paints an SVG root from a whole CSS px. In print it rounds the object's offset
        // on its page half up (-10.5 -> -10) and moves the drawing by the difference, in page space even
        // under the object's rotation or flip. Measured from the PDF matrices (issue #42), also on later A4
        // pages, whose 793.92px height puts them at fractional document offsets. Translate the drawing back,
        // in the SVG's own pre-transform space. Print only: on screen the snap step is 1 / devicePixelRatio.
        const object = svg.parentElement;
        if (!object) return;
        const dx = fraction(px(object, LEFT, "left"));
        const dy = fraction(px(object, TOP, "top"));
        if (dx || dy) {
            // Undo the object's `rotate() scaleX() scaleY()` on the page-space offset.
            const box = object.getAttribute("style") ?? "";
            const angle = (Number(box.match(ROTATE)?.[1] ?? 0) * Math.PI) / 180;
            const x = local((dx * Math.cos(angle) + dy * Math.sin(angle)) * (box.includes("scaleX(-1)") ? -1 : 1));
            const y = local((dy * Math.cos(angle) - dx * Math.sin(angle)) * (box.includes("scaleY(-1)") ? -1 : 1));
            svg.style.transform = `translate(${x}px, ${y}px)`;
        }

        // Dash rewrite: Chromium's PDF keeps a zero-length dash, which poppler paints as a hairline in every
        // gap. Draw a pattern that starts with a gap (startDashAt) as the same pattern shifted by an offset.
        svg.querySelectorAll("[stroke-dasharray]").forEach(stroked => {
            const [first, gap = 0, ...rest] = (stroked.getAttribute("stroke-dasharray") ?? "").split(" ").map(Number);
            const last = rest.at(-1);
            if (first !== 0 || last === undefined) return;
            const pattern = [...rest.slice(0, -1), last + gap];
            stroked.setAttribute("stroke-dasharray", pattern.join(" "));
            stroked.setAttribute("stroke-dashoffset", String(pattern.reduce((sum, part) => sum + part, 0) - gap));
        });
    });

    // Table offset: DrawingML centres table borders on the grid; Chromium collapses the outer half into the
    // table box, so offset the grid by half the widest stroke. A hidden border is written 0px wide.
    root.querySelectorAll<HTMLTableElement>("table.slide-table").forEach(table => {
        let widest = 0;
        table.querySelectorAll("td").forEach(cell => {
            for (const [, width] of (cell.getAttribute("style") ?? "").matchAll(BORDER_WIDTH)) widest = Math.max(widest, number(cell, width, "numeric border width"));
        });
        if (!widest) return;
        table.style.position = "relative";
        table.style.left = `${-widest / 2}px`;
        table.style.top = `${-widest / 2}px`;
    });
}
