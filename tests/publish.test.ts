import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { distTag, entryPointFiles, type Manifest, parseCommittedHash, parseOptions, publishOrder, releaseVersion, tarballName, tarballProblems } from "../scripts/publish";

const PACKAGES_DIR = resolve(import.meta.dir, "../packages");
const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

const model: Manifest = { name: "@pdflapas/model", version: "1.2.3", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } };
const wasm: Manifest = { name: "@pdflapas/wasm", version: "1.2.3", main: "./dist/browser.js", exports: { ".": { node: "./dist/node.js", default: "./dist/browser.js" } }, dependencies: { "@pdflapas/model": "workspace:*" } };
const files = ["package/package.json", "package/dist/browser.js", "package/dist/node.js", "package/dist/pdf_wasm_bg.wasm"];
const packedWasm = (dependencies: Record<string, string>) => JSON.stringify({ ...wasm, dependencies });

describe("publish:npm", () => {
    test("publishes the workspace's packages in dependency order", async () => {
        // The workspace's manifests, but the private ones.
        const directories = (await readdir(PACKAGES_DIR, { withFileTypes: true })).filter(entry => entry.isDirectory());
        const manifests = await Promise.all(directories.map(entry => Bun.file(join(PACKAGES_DIR, entry.name, "package.json")).json() as Promise<Manifest>));
        const order = publishOrder(manifests.filter(manifest => manifest.private !== true)).map(batch => batch.map(manifest => manifest.name));

        expect(order).toEqual([["@pdflapas/model"], ["@pdflapas/pdfkit", "@pdflapas/puppeteer", "@pdflapas/wasm"], ["@pdflapas/pptxgenjs"], ["@pdflapas/react"]]);
    });

    test("refuses a cycle and a dependency on a package it does not publish", () => {
        const a: Manifest = { name: "@pdflapas/a", version: "1.0.0", dependencies: { "@pdflapas/b": "workspace:*" } };
        const b: Manifest = { name: "@pdflapas/b", version: "1.0.0", peerDependencies: { "@pdflapas/a": "workspace:*" } };

        expect(() => publishOrder([a, b])).toThrow("Dependency cycle");
        expect(() => publishOrder([a])).toThrow("@pdflapas/a depends on @pdflapas/b, which is not published");
    });

    test("requires one shared version", () => {
        expect(releaseVersion([model, wasm])).toBe("1.2.3");
        expect(() => releaseVersion([model, { ...wasm, version: "1.2.4" }])).toThrow("@pdflapas/model@1.2.3, @pdflapas/wasm@1.2.4");
    });

    test("needs an explicit dist-tag for a prerelease", () => {
        expect(distTag("1.2.3", undefined)).toBe("latest");
        expect(distTag("1.3.0-rc.1", "next")).toBe("next");
        expect(() => distTag("1.3.0-rc.1", undefined)).toThrow("pass --tag");
    });

    test("defaults to a dry run and validates its flags", () => {
        expect(parseOptions([])).toEqual({ yes: false, otp: undefined, tag: undefined });
        expect(parseOptions(["--yes", "--otp=123456", "--tag", "next"])).toEqual({ yes: true, otp: "123456", tag: "next" });
        expect(() => parseOptions(["--otp=12"])).toThrow("--otp");
        expect(() => parseOptions(["--tag=a b"])).toThrow("--tag");
        expect(() => parseOptions(["--publish"])).toThrow();
    });

    test("lists every entry point a manifest names, once", () => {
        expect(entryPointFiles(wasm)).toEqual(["package/dist/browser.js", "package/dist/node.js"]);
    });

    test("accepts a tarball with pinned dependencies, its entry points and the committed binary", () => {
        expect(tarballProblems(wasm, packedWasm({ "@pdflapas/model": "1.2.3" }), files, HASH, HASH)).toEqual([]);
    });

    test("rejects workspace specifiers, other versions, missing entry points and a wrong binary", () => {
        expect(tarballProblems(wasm, packedWasm({ "@pdflapas/model": "workspace:*" }), files, HASH, HASH)).toEqual(["@pdflapas/wasm its package.json still has a workspace: specifier", "@pdflapas/wasm depends on @pdflapas/model@workspace:*, expected exactly 1.2.3"]);
        expect(tarballProblems(wasm, packedWasm({ "@pdflapas/model": "^1.2.3" }), files, HASH, HASH)).toEqual(["@pdflapas/wasm depends on @pdflapas/model@^1.2.3, expected exactly 1.2.3"]);
        expect(tarballProblems(wasm, packedWasm({ "@pdflapas/model": "1.2.3" }), ["package/dist/browser.js"], undefined, HASH)).toEqual(["@pdflapas/wasm is missing package/dist/node.js, which its package.json points at (was it built?)", `@pdflapas/wasm carries no dist/pdf_wasm_bg.wasm, expected sha256 ${HASH}`]);
        expect(tarballProblems(wasm, packedWasm({ "@pdflapas/model": "1.2.3" }), files, OTHER_HASH, HASH)).toEqual([`@pdflapas/wasm carries a different (${OTHER_HASH}) dist/pdf_wasm_bg.wasm, expected sha256 ${HASH}`]);
        expect(tarballProblems(model, JSON.stringify({ ...model, version: "1.2.2" }), ["package/dist/index.d.ts", "package/dist/index.js"], undefined, HASH)).toEqual(["@pdflapas/model packed as @pdflapas/model@1.2.2, expected @pdflapas/model@1.2.3"]);
    });

    test("reads the committed wasm hash and names tarballs the way bun pm pack does", async () => {
        expect(parseCommittedHash(`${HASH}  pdf_wasm_bg.wasm\n`)).toBe(HASH);
        expect(() => parseCommittedHash("nope")).toThrow("sha256");
        expect(parseCommittedHash(await Bun.file(join(PACKAGES_DIR, "wasm/src/pdf_wasm_bg.wasm.sha256")).text())).toMatch(/^[0-9a-f]{64}$/);
        expect(tarballName(wasm)).toBe("pdflapas-wasm-1.2.3.tgz");
    });
});
