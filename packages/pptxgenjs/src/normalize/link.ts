import type PptxGenJS from "pptxgenjs";
import { LINK_URL_SCHEME, type NormalizedTextLink } from "@pdflapas/model";

/** The model link of a text run, shape or image `hyperlink` option: its `url`, else a jump to its 1-based `slide`. */
export function normalizeHyperlink(hyperlink: PptxGenJS.HyperlinkProps | undefined): NormalizedTextLink | undefined {
    if (!hyperlink) return undefined;
    const { url, slide, tooltip } = hyperlink;
    if (url) {
        if (!LINK_URL_SCHEME.test(url)) throw new Error(`hyperlink url '${url}' is not supported: use an http:, https: or mailto: URL`);
        return { href: url, tooltip };
    }
    if (slide !== undefined) {
        if (!Number.isInteger(slide) || slide < 1) throw new Error(`hyperlink slide '${slide}' is not a slide number: use an integer from 1`);
        return { href: `#slide-${slide}`, tooltip, slide };
    }
    throw new Error("hyperlink requires either url or slide");
}
