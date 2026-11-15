/** A PptxGenJS API method or property PuppeteerGen keeps for API compatibility but cannot render yet. */
export class UnsupportedFeatureError extends Error {
    readonly code = "UNSUPPORTED_FEATURE";
    readonly feature: string;

    /** `feature` is a method name (`addMedia`, shown as `addMedia()`) or, with `kind` "property", a property (`slide.hidden = true`). */
    constructor(feature: string, workaround: string, kind: "method" | "property" = "method") {
        super(`${kind === "method" ? `${feature}()` : feature} is not supported by PuppeteerGen yet. ${workaround}`);
        this.name = "UnsupportedFeatureError";
        this.feature = feature;
    }
}
