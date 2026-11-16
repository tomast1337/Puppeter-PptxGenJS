/**
 * The Puppeteer launch options a `PuppeteerPdfRenderer` accepts, with Puppeteer's meaning
 * (https://pptr.dev/api/puppeteer.launchoptions).
 */
// shortcut: a subset of puppeteer's LaunchOptions, declared here because importing that type puts puppeteer's
// Node typings into the public declarations; add a field when a caller needs it.
export interface PuppeteerLaunchOptions {
    readonly executablePath?: string;
    readonly args?: readonly string[];
    readonly headless?: boolean | "shell";
    readonly timeout?: number;
    readonly protocolTimeout?: number;
    readonly userDataDir?: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
}

/** The options every `PuppeteerPdfRenderer` launches Chromium with unless it is given its own. */
export const DEFAULT_LAUNCH_OPTIONS: PuppeteerLaunchOptions = {
    // chrome-headless-shell starts faster than full headless Chrome.
    headless: "shell",
    // Chromium's sandbox refuses to start as root, the usual user in a container, so the renderer has always
    // launched without it. Pass `launchOptions: { args: [] }` to keep the sandbox where the user allows it.
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
};
