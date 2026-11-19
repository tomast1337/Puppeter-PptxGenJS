// linebreak 1.1.0 (UAX #14, the line breaker PDFKit uses) ships no declarations; this is the part the renderer calls.
declare module "linebreak" {
    export interface Break {
        /** The UTF-16 index the next line may start at. */
        readonly position: number;
        /** A mandatory break (after a line feed or paragraph separator). */
        readonly required: boolean;
    }

    export default class LineBreaker {
        constructor(text: string);
        nextBreak(): Break | null;
    }
}
