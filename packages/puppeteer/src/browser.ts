import puppeteer, { type Browser } from "puppeteer";
import { DEFAULT_LAUNCH_OPTIONS, type PuppeteerLaunchOptions } from "./launchOptions";

// Back-to-back and concurrent writes share one Chromium, which skips its
// startup cost. Once idle for this long it closes, so scripts still exit
// without calling closeBrowser().
const IDLE_CLOSE_MS = 1000;

interface SharedBrowser {
    browser: Promise<Browser> | undefined;
    active: number;
    idleTimer: ReturnType<typeof setTimeout> | undefined;
}

// One shared Chromium per distinct launch options, so renderers with different options never get each other's
// browser. Global because every renderer in the process shares it; withBrowser creates an entry, the idle timer
// and closeBrowser() close its browser.
const shared = new Map<string, SharedBrowser>();

/** Run `task` with the shared browser for `options`, launching it when needed. */
export async function withBrowser<T>(task: (browser: Browser) => Promise<T>, options: PuppeteerLaunchOptions = DEFAULT_LAUNCH_OPTIONS): Promise<T> {
    const key = JSON.stringify(options);
    let entry = shared.get(key);

    if (!entry) {
        entry = { browser: undefined, active: 0, idleTimer: undefined };
        shared.set(key, entry);
    }

    const current = entry;

    clearTimeout(current.idleTimer);
    current.active++;
    try {
        if (current.browser === undefined) {
            const launching = puppeteer.launch({ ...options, args: options.args && [...options.args] });
            // A browser that fails to launch or later disconnects is launched again by the next task.
            const forget = () => {
                if (current.browser === launching) {
                    current.browser = undefined;
                }
            };

            launching.then(instance => instance.once("disconnected", forget), forget);
            current.browser = launching;
        }

        return await task(await current.browser);
    } finally {
        if (--current.active === 0) {
            current.idleTimer = setTimeout(() => void closeShared(current).catch(() => undefined), IDLE_CLOSE_MS);
        }
    }
}

async function closeShared(entry: SharedBrowser): Promise<void> {
    clearTimeout(entry.idleTimer);
    const closing = entry.browser;

    entry.browser = undefined;
    await (await closing?.catch(() => undefined))?.close();
}

/** Close the shared browsers now instead of after the idle delay. Pending writes using them will fail. */
export async function closeBrowser(): Promise<void> {
    await Promise.all(Array.from(shared.values(), closeShared));
}
