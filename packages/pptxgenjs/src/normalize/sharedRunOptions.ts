import type PptxGenJS from "pptxgenjs";

/**
 * What PptxGenJS 4.0.1 writes onto the run options objects of a deck's text boxes and table cells, by object.
 * It keeps the caller's own object as a run's options (genXmlTextBody STEP 3; for a text-box run without options, the
 * `{}` addTextDefinition stores on the run) and writes onto it: the box's color (addTextDefinition cleanOpts), the
 * box's bullet on its first run (STEP 4 A), `breakLine` (STEP 4 C, 5) and every box option the run leaves falsy (STEP
 * 6 B, C). A run that shares the object in a later box reads those writes, so it keeps the first box's size, color and
 * spacing. PdfLapas never writes onto the caller's objects: each presentation keeps this record and passes it to
 * normalizeText, which reads it for a box's runs and adds what PptxGenJS writes there.
 */
export type SharedRunOptions = WeakMap<object, Readonly<Record<string, unknown>>>;

/**
 * The options PptxGenJS reads for a run whose options object is `key`, holding the caller's `own`: each option the
 * caller leaves falsy takes what an earlier box wrote there. PptxGenJS writes at write time, after every call, so a
 * value the caller sets between two boxes stays, and one it clears takes the earlier box's. A fresh copy, which the
 * box may write onto.
 */
export function sharedRunOptions(shared: SharedRunOptions | undefined, key: object, own: PptxGenJS.TextPropsOptions): PptxGenJS.TextPropsOptions {
    const options: Record<string, unknown> = { ...own };

    for (const [name, value] of Object.entries(shared?.get(key) ?? {})) {
        if (!options[name]) {
            options[name] = value;
        }
    }

    // `as`: every name comes from a run's options, the caller's or those PptxGenJS wrote.
    return options as PptxGenJS.TextPropsOptions;
}

/**
 * Adds to the record what a box wrote onto `key`'s options: each option that differs between `start` and `state`.
 * shortcut: a write that clears an option (STEP 5's `breakLine: false` on a bullet run that starts a paragraph) only
 * fills a falsy one in later boxes; replay writes in order if a deck shares such a run's options.
 */
export function recordSharedRun(shared: SharedRunOptions, key: object, start: PptxGenJS.TextPropsOptions, state: PptxGenJS.TextPropsOptions): void {
    const before: Record<string, unknown> = { ...start };
    const writes = Object.entries(state).filter(([name, value]) => value !== before[name]);

    if (writes.length > 0) {
        shared.set(key, { ...shared.get(key), ...Object.fromEntries(writes) });
    }
}
