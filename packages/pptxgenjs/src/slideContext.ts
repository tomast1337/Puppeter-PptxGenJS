import type PptxGenJS from "pptxgenjs";
import type { ComponentRegistry } from "./components/registry";
import type { FontMetricsTable, RenderingTarget } from "./defaults";
import type { PageSize } from "./pageLayouts";
import type { PuppeteerSlide } from "./PuppeteerSlide";

/** What a slide reads from the presentation that owns it. PuppeteerGen.addSlide() creates one per slide; every field is required. */
export interface SlideContext {
    /** The presentation's page size when the slide was added, which its percentage positions resolve against. */
    readonly pageSize: PageSize;
    /** The slide's 0-based position: its slide number and the scope of its object ids. */
    readonly slideIndex: number;
    /** The presentation's registered components, which addComponent() renders once to check them. */
    readonly components: ComponentRegistry;
    /** `pres.theme.bodyFontFace`: the font of text, table cells and chart legends that name none (PowerPoint's `+mn-lt`). */
    readonly bodyFontFace: () => string;
    /** The presentation's rendering target, which text is normalized for. */
    readonly target: RenderingTarget;
    /** The presentation's `fontMetrics` option merged over FONT_WIN_METRICS, which the target may place baselines from. */
    readonly fontMetrics: FontMetricsTable;
    /** The `context.document` of components rendered to check them when they are added; toHtml() does not use it. */
    readonly getDocument: () => Document;
    /** The slide `offset` places after this one, added when it does not exist yet: where autoPage tables continue. */
    readonly continuationSlide: (offset: number) => PuppeteerSlide;
    /** PptxGenJS's `setSlideNumber` callback: every slide's `slideNumber` setter also sets the master's. */
    readonly setMasterSlideNumber: (props: PptxGenJS.SlideNumberProps | null) => void;
}
