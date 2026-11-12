/** A PptxGenJS API method PuppeteerGen keeps for API compatibility but cannot render yet. */
export class UnsupportedFeatureError extends Error {
    readonly code = "UNSUPPORTED_FEATURE";
    readonly feature: string;

    constructor(feature: string, workaround: string) {
        super(`${feature}() is not supported by PuppeteerGen yet. ${workaround}`);
        this.name = "UnsupportedFeatureError";
        this.feature = feature;
    }
}
