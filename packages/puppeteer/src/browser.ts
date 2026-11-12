import puppeteer, { type Browser } from "puppeteer";

// Back-to-back and concurrent writes share one Chromium, which skips its
// startup cost. Once idle for this long it closes, so scripts still exit
// without calling closeBrowser().
const IDLE_CLOSE_MS = 1000;

let browser: Promise<Browser> | undefined;
let active = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function launch(): Promise<Browser> {
    const launching = puppeteer.launch({
        // chrome-headless-shell starts faster than full headless Chrome.
        headless: "shell",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const forget = () => {
        if (browser === launching) browser = undefined;
    };
    launching.then(instance => instance.once("disconnected", forget), forget);
    return launching;
}

/** Run `task` with the shared browser, launching it when needed. */
export async function withBrowser<T>(task: (browser: Browser) => Promise<T>): Promise<T> {
    clearTimeout(idleTimer);
    active++;
    try {
        browser ??= launch();
        return await task(await browser);
    } finally {
        if (--active === 0) idleTimer = setTimeout(() => void closeBrowser().catch(() => undefined), IDLE_CLOSE_MS);
    }
}

/** Close the shared browser now instead of after the idle delay. Pending writes using it will fail. */
export async function closeBrowser(): Promise<void> {
    clearTimeout(idleTimer);
    const closing = browser;
    browser = undefined;
    await (await closing?.catch(() => undefined))?.close();
}
