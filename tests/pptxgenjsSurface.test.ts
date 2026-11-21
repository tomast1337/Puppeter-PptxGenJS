import { describe, expect, test } from "bun:test";
import pptxgen from "pptxgenjs";
import { API_COMPATIBILITY, type ApiEntry } from "../packages/pptxgenjs/src/compatibility";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { UnsupportedFeatureError } from "../packages/pptxgenjs/src/UnsupportedFeatureError";

/** Every property and method name an object exposes through its prototype chain, without `constructor` and PptxGenJS's `_` private state. */
function memberNames(object: object): string[] {
    const names = new Set<string>();

    for (let current: object | null = object; current && current !== Object.prototype; current = Object.getPrototypeOf(current)) {
        for (const name of Object.getOwnPropertyNames(current)) {
            if (!name.startsWith("_") && name !== "constructor") {
                names.add(name);
            }
        }
    }

    return [...names].sort();
}

function namesWith(table: Readonly<Record<string, ApiEntry>>, statuses: readonly ApiEntry["status"][]): string[] {
    return Object.entries(table)
        .filter(([, entry]) => statuses.includes(entry.status))
        .map(([name]) => name)
        .sort();
}

function referenceSurface() {
    const presentation = new pptxgen();

    return { presentation, slide: presentation.addSlide() };
}

// One call per unsupported or partial member: each must throw UnsupportedFeatureError.
const PROBES: Record<"presentation" | "slide", Record<string, (pres: PuppeteerGen) => unknown>> = {
    presentation: {
        defineSlideMaster: pres => pres.defineSlideMaster({ title: "MASTER" }),
    },
    slide: {
        addMedia: pres => pres.addSlide().addMedia({ type: "video", path: "movie.mp4", x: 0, y: 0, w: 1, h: 1 }),
    },
};

describe("the pptxgenjs 4.0.1 runtime surface", () => {
    for (const surface of ["presentation", "slide"] as const) {
        const table = API_COMPATIBILITY[surface];

        test(`classifies every public ${surface} member, and only members the runtime has`, () => {
            const runtime = memberNames(referenceSurface()[surface]);

            expect(runtime.filter(name => !Object.hasOwn(table, name))).toEqual([]);
            expect(Object.keys(table).filter(name => !runtime.includes(name))).toEqual([]);
        });

        test(`PuppeteerGen's ${surface} has every implemented, partial and unsupported member`, () => {
            const pres = new PuppeteerGen();
            const ours = surface === "presentation" ? pres : pres.addSlide();
            const expected = namesWith(table, ["implemented", "partial", "unsupported"]);

            expect(expected.filter(name => !(name in ours))).toEqual([]);
        });

        test(`each unsupported or partial ${surface} member throws UnsupportedFeatureError`, () => {
            expect(Object.keys(PROBES[surface]).sort()).toEqual(namesWith(table, ["partial", "unsupported"]));
            for (const [name, probe] of Object.entries(PROBES[surface])) {
                expect({
                    name,
                    error: (() => {
                        try {
                            probe(new PuppeteerGen());
                        } catch (error) {
                            return error instanceof UnsupportedFeatureError;
                        }

                        return "did not throw";
                    })(),
                }).toEqual({ name, error: true });
            }
        });
    }
});
