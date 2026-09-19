import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
});

export async function resolveImageSource(source: string, cwd = process.cwd()): Promise<string> {
    if (/^data:/i.test(source) || /^https?:\/\//i.test(source)) return source;

    const path = source.startsWith("file:") ? fileURLToPath(source) : resolve(cwd, source);
    const file = Bun.file(path);
    if (!await file.exists()) throw new Error(`Image file not found: ${path}`);

    const mime = MIME_TYPES[extname(path).toLowerCase()] ?? (file.type || "application/octet-stream");
    const data = Buffer.from(await file.arrayBuffer()).toString("base64");
    return `data:${mime};base64,${data}`;
}

export async function resolveDocumentImages(document: Document, cwd = process.cwd()): Promise<void> {
    const images = Array.from(document.querySelectorAll<HTMLImageElement>("img[data-source-path]"));
    await Promise.all(images.map(async image => {
        const source = image.dataset.sourcePath;
        if (!source) return;
        image.src = await resolveImageSource(source, cwd);
        delete image.dataset.sourcePath;
    }));
}
