/**
 * Chromium-only declarations derived from values the pdfdeck HTML profile states once (docs/HTML_PROFILE.md,
 * "Print workarounds"), set in the page before printing so they stay out of the document.
 *
 * It runs in the page through `page.evaluate`, so it is self-contained: no imports and no module-level
 * bindings, and its constants live in its body. Tests call it with a jsdom document.
 */
export function applyPrintWorkarounds(root: ParentNode = document): void {
    // Lengths are read from the raw `style` attribute: the CSSOM serializes them to 6 significant digits.
    const LINE_HEIGHT = /(?:^|; )line-height: ([^;]+)px;/;
    const number = (element: Element, value: string | undefined, what: string): number => {
        const parsed = Number(value);
        if (value !== undefined && Number.isFinite(parsed)) return parsed;
        const object = element.closest("[data-object-name]")?.getAttribute("data-object-name") ?? "unnamed object";
        throw new Error(`Cannot print '${object}': its .${element.classList[0]} has no ${what} (pdfdeck HTML profile)`);
    };
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
}
