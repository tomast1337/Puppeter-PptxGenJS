import { afterAll, expect, test } from "bun:test";
import { closeBrowser, withBrowser } from "../packages/puppeteer/src/browser";
import { DEFAULT_LAUNCH_OPTIONS } from "../packages/puppeteer/src/launchOptions";
import { PuppeteerPdfRenderer } from "../packages/puppeteer/src/puppeteerPdf";

afterAll(closeBrowser);

test("concurrent and back-to-back writes share one browser", async () => {
    const [first, second] = await Promise.all([withBrowser(async browser => browser), withBrowser(async browser => browser)]);
    expect(second).toBe(first);
    expect(await withBrowser(async browser => browser)).toBe(first);
});

test("closeBrowser closes the shared browser and the next write relaunches", async () => {
    const before = await withBrowser(async browser => browser);
    await closeBrowser();
    expect(before.connected).toBe(false);
    const after = await withBrowser(async browser => browser);
    expect(after).not.toBe(before);
    expect(after.connected).toBe(true);
});

test("a failed task does not poison the shared browser", async () => {
    await expect(withBrowser(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await withBrowser(async browser => browser.connected)).toBe(true);
});

test("each distinct set of launch options gets its own shared browser", async () => {
    const options = { ...DEFAULT_LAUNCH_OPTIONS, args: [...(DEFAULT_LAUNCH_OPTIONS.args ?? []), "--mute-audio"] };
    const defaultBrowser = await withBrowser(async browser => browser);
    const custom = await withBrowser(async browser => browser, options);
    expect(custom).not.toBe(defaultBrowser);
    expect(await withBrowser(async browser => browser, { ...options })).toBe(custom);
    await closeBrowser();
    expect(defaultBrowser.connected).toBe(false);
    expect(custom.connected).toBe(false);
});

test("PuppeteerPdfRenderer launches Chromium with its launch options", async () => {
    // A missing executable proves the options reached puppeteer.launch.
    const renderer = new PuppeteerPdfRenderer({ launchOptions: { executablePath: "/nonexistent/chromium" } });
    const document = { html: "<!DOCTYPE html><html></html>", pageSize: { width: 10, height: 5.625, name: "Custom" } };
    await expect(renderer.render(document)).rejects.toThrow("/nonexistent/chromium");
});
