// Text measurement for one document: fontkit shapes each piece exactly as PDFKit will when it draws it (the same
// features object goes to both), so a measured width is the drawn width. Caches live as long as the document.
import { type Face, type FaceChain, type FaceRequest, faceChain } from "#src/fonts";

/** fontkit features: `kern` off for `font-kerning: none`; ligatures off under letter-spacing, as in Chromium. */
export type Features = Readonly<Record<string, boolean>>;

const KERNED: Features = Object.freeze({});
const UNKERNED: Features = Object.freeze({ kern: false });
const SPACED: Features = Object.freeze({ liga: false, clig: false });
const SPACED_UNKERNED: Features = Object.freeze({ kern: false, liga: false, clig: false });

export function features(kerning: boolean, letterSpacing: number): Features {
    if (letterSpacing) {
        return kerning ? SPACED : SPACED_UNKERNED;
    }

    return kerning ? KERNED : UNKERNED;
}

export interface Shaper {
    chain(request: FaceRequest): FaceChain;
    /** The advance of `text` in `face` at `size` px, letter spacing after every character included. */
    width(face: Face, text: string, size: number, features: Features, letterSpacing: number): number;
    /** The kerning between `first` and `second` in `face` at `size` px: what shaping them together moves the second. */
    kern(face: Face, first: string, second: string, size: number, features: Features): number;
}

export function createShaper(faces: readonly Face[]): Shaper {
    const chains = new Map<string, FaceChain>();
    // Advances in em, so one shaping serves every size.
    const advances = new Map<string, number>();

    return {
        chain(request) {
            const key = [request.family, ...request.fallbacks, request.lang ?? "", request.bold, request.italic].join("\u0000");
            let chain = chains.get(key);

            if (!chain) {
                chain = faceChain(faces, request);
                chains.set(key, chain);
            }

            return chain;
        },
        width(face, text, size, featureSet, letterSpacing) {
            const key = `${face.key}\u0000${featureSet === KERNED ? "" : Object.keys(featureSet).join()}\u0000${text}`;
            let em = advances.get(key);

            if (em === undefined) {
                em = face.font.layout(text, { ...featureSet }).advanceWidth / face.font.unitsPerEm;
                advances.set(key, em);
            }

            return em * size + letterSpacing * Array.from(text).length;
        },
        kern(face, first, second, size, featureSet) {
            if (!first || !second || featureSet.kern === false) {
                return 0;
            }

            return this.width(face, first + second, size, featureSet, 0) - this.width(face, first, size, featureSet, 0) - this.width(face, second, size, featureSet, 0);
        },
    };
}
