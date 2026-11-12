import { afterAll, expect, test } from "bun:test";
import { closeBrowser, withBrowser } from "../packages/puppeteer/src/browser";

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
