// Publishes the @pdflapas/* packages to npm from the maintainer's machine, with their npm login and 2FA.
// Publishing is local by decision: CI (release.yml) only dry-runs. See CONTRIBUTING.md, "Releases".
//
//   bun run publish:npm                      dry run: checks, builds, packs, verifies, `npm publish --dry-run`
//   bun run publish:npm --yes [--otp=123456] [--tag=next]   publishes for real
//
// Private packages are never published. A version that is already
// on npm is skipped, so a run that failed half-way can be resumed.
import { mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const PROJECT_ROOT = resolve(import.meta.dir, "..");
const PACKAGES_DIR = resolve(PROJECT_ROOT, "packages");
const RELEASE_DIR = resolve(PROJECT_ROOT, "release");
const REMOTE = "origin";
const MAIN_BRANCH = "main";
const SCOPE = "@pdflapas/";
const DEFAULT_DIST_TAG = "latest";
const WASM_PACKAGE = "@pdflapas/wasm";
const WASM_BINARY = "pdf_wasm_bg.wasm";
const WASM_SOURCE_DIR = resolve(PACKAGES_DIR, "wasm/src");
/** npm and bun pack every file under this directory of the tarball. */
const TARBALL_ROOT = "package/";
const SHA256_HEX = /^[0-9a-f]{64}$/;
const DEPENDENCY_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;

export interface Manifest {
    readonly name: string;
    readonly version: string;
    readonly private?: boolean;
    readonly main?: string;
    readonly types?: string;
    readonly exports?: unknown;
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly peerDependencies?: Readonly<Record<string, string>>;
    readonly optionalDependencies?: Readonly<Record<string, string>>;
}

export interface WorkspacePackage {
    readonly directory: string;
    readonly manifest: Manifest;
}

interface PlannedPackage {
    readonly manifest: Manifest;
    readonly tarball: string;
    readonly sha256: string;
    readonly published: boolean;
}

export interface PublishOptions {
    readonly yes: boolean;
    readonly otp?: string;
    readonly tag?: string;
}

// ---- Pure checks (tests/publish.test.ts) ----

export function parseOptions(argv: string[]): PublishOptions {
    const { values } = parseArgs({
        args: argv,
        options: { yes: { type: "boolean", default: false }, otp: { type: "string" }, tag: { type: "string" } },
        strict: true,
        allowPositionals: false,
    });
    if (values.otp !== undefined && !/^\d{6,8}$/.test(values.otp)) throw new Error(`--otp must be the 6-8 digit code from your authenticator, got "${values.otp}"`);
    if (values.tag !== undefined && !/^[a-z][a-z0-9._-]*$/i.test(values.tag)) throw new Error(`--tag must be an npm dist-tag name such as "next", got "${values.tag}"`);
    return { yes: values.yes, otp: values.otp, tag: values.tag };
}

export function parseManifest(text: string, where: string): Manifest {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || !("name" in value) || !("version" in value) || typeof value.name !== "string" || typeof value.version !== "string") {
        throw new Error(`${where} is not a package manifest with a string name and version`);
    }
    // Checked above: the fields this script reads are a name and version; the rest is read defensively.
    return value as Manifest;
}

/** The one version every publishable package shares; the Release workflow checks the same against the tag. */
export function releaseVersion(manifests: readonly Manifest[]): string {
    const versions = new Set(manifests.map(manifest => manifest.version));
    const [version] = versions;
    if (versions.size !== 1 || version === undefined) {
        const listed = manifests.map(manifest => `${manifest.name}@${manifest.version}`).join(", ");
        throw new Error(`Every published package must have the same version, found ${listed}. Bump them together (CONTRIBUTING.md, "Releases").`);
    }
    return version;
}

/** The dist-tag to publish under: npm's default, unless the version is a prerelease, which must never become `latest` by accident. */
export function distTag(version: string, tag: string | undefined): string {
    if (tag !== undefined) return tag;
    if (version.includes("-")) throw new Error(`${version} is a prerelease: pass --tag (for example --tag=next) so it does not become "${DEFAULT_DIST_TAG}"`);
    return DEFAULT_DIST_TAG;
}

export function workspaceDependencies(manifest: Manifest): [string, string][] {
    return DEPENDENCY_FIELDS.flatMap(field => Object.entries(manifest[field] ?? {})).filter(([name]) => name.startsWith(SCOPE));
}

/** Publish batches from the manifests' @pdflapas/* dependencies: each batch depends only on earlier ones. */
export function publishOrder(manifests: readonly Manifest[]): Manifest[][] {
    const names = new Set(manifests.map(manifest => manifest.name));
    for (const manifest of manifests) {
        const unknown = workspaceDependencies(manifest).filter(([name]) => !names.has(name));
        if (unknown.length) throw new Error(`${manifest.name} depends on ${unknown.map(([name]) => name).join(", ")}, which is not published by this script (private or missing)`);
    }
    const done = new Set<string>();
    const batches: Manifest[][] = [];
    let remaining = [...manifests];
    while (remaining.length) {
        const ready = remaining.filter(manifest => workspaceDependencies(manifest).every(([name]) => done.has(name)));
        if (!ready.length) throw new Error(`Dependency cycle between ${remaining.map(manifest => manifest.name).join(", ")}`);
        ready.sort((a, b) => a.name.localeCompare(b.name));
        for (const manifest of ready) done.add(manifest.name);
        batches.push(ready);
        remaining = remaining.filter(manifest => !done.has(manifest.name));
    }
    return batches;
}

/** Every file path `main`, `types` and `exports` name, as a tarball entry. */
export function entryPointFiles(manifest: Manifest): string[] {
    const targets = (value: unknown): string[] => {
        if (typeof value === "string") return [value];
        if (typeof value === "object" && value !== null) return Object.values(value).flatMap(targets);
        return [];
    };
    const paths = [manifest.main, manifest.types, ...targets(manifest.exports)].filter(path => path !== undefined);
    return [...new Set(paths.map(path => `${TARBALL_ROOT}${path.replace(/^\.\//, "")}`))];
}

/** What is wrong with a packed tarball: its manifest, its entry points and, for @pdflapas/wasm, the binary. */
export function tarballProblems(source: Manifest, packedManifestText: string, files: readonly string[], packedWasmSha256: string | undefined, committedWasmSha256: string): string[] {
    const packed = parseManifest(packedManifestText, `${source.name}'s packed package.json`);
    const problems: string[] = [];
    if (packed.name !== source.name || packed.version !== source.version) problems.push(`packed as ${packed.name}@${packed.version}, expected ${source.name}@${source.version}`);
    if (packedManifestText.includes("workspace:")) problems.push(`its package.json still has a workspace: specifier`);
    for (const [name, version] of workspaceDependencies(packed)) {
        if (version !== source.version) problems.push(`depends on ${name}@${version}, expected exactly ${source.version}`);
    }
    for (const file of entryPointFiles(packed)) {
        if (!files.includes(file)) problems.push(`is missing ${file}, which its package.json points at (was it built?)`);
    }
    if (source.name === WASM_PACKAGE && packedWasmSha256 !== committedWasmSha256) {
        problems.push(`carries ${packedWasmSha256 === undefined ? "no" : `a different (${packedWasmSha256})`} dist/${WASM_BINARY}, expected sha256 ${committedWasmSha256}`);
    }
    return problems.map(problem => `${source.name} ${problem}`);
}

export function parseCommittedHash(text: string): string {
    const [hash] = text.trim().split(/\s+/);
    if (hash === undefined || !SHA256_HEX.test(hash)) throw new Error(`packages/wasm/src/${WASM_BINARY}.sha256 does not start with a sha256 hex digest`);
    return hash;
}

export function tarballName(manifest: Manifest): string {
    return `${manifest.name.replace(/^@/, "").replace("/", "-")}-${manifest.version}.tgz`;
}

// ---- Commands ----

interface Captured {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
}

async function capture(command: string[], cwd = PROJECT_ROOT): Promise<Captured> {
    const child = Bun.spawn(command, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { exitCode, stdout, stderr };
}

async function output(command: string[], cwd = PROJECT_ROOT): Promise<string> {
    const result = await capture(command, cwd);
    if (result.exitCode !== 0) throw new Error(`${command.join(" ")} failed with exit code ${result.exitCode}:\n${result.stderr}`);
    return result.stdout.trimEnd();
}

/** Runs with the terminal attached, so npm can prompt for a one-time password. */
async function run(command: string[], cwd = PROJECT_ROOT): Promise<void> {
    const child = Bun.spawn(command, { cwd, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    const exitCode = await child.exited;
    if (exitCode !== 0) throw new Error(`${command.join(" ")} failed with exit code ${exitCode}`);
}

async function extractBytes(tarball: string, entry: string): Promise<Uint8Array> {
    const child = Bun.spawn(["tar", "-xzOf", tarball, entry], { stdin: "ignore", stdout: "pipe", stderr: "inherit" });
    const [bytes, exitCode] = await Promise.all([new Response(child.stdout).bytes(), child.exited]);
    if (exitCode !== 0) throw new Error(`Could not extract ${entry} from ${tarball} (tar exit code ${exitCode})`);
    return bytes;
}

function sha256(bytes: Uint8Array): string {
    return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

// ---- Steps (exported so a scratch driver can exercise pack, verify and the dry run off main) ----

export async function readPackages(): Promise<WorkspacePackage[]> {
    const entries = await readdir(PACKAGES_DIR, { withFileTypes: true });
    const packages = await Promise.all(
        entries
            .filter(entry => entry.isDirectory())
            .map(async entry => {
                const directory = join(PACKAGES_DIR, entry.name);
                return { directory, manifest: parseManifest(await Bun.file(join(directory, "package.json")).text(), `packages/${entry.name}/package.json`) };
            }),
    );
    return packages.filter(({ manifest }) => manifest.private !== true);
}

async function checkGit(version: string): Promise<void> {
    const status = await output(["git", "status", "--porcelain"]);
    if (status) throw new Error(`The working tree is not clean; commit or stash these first:\n${status}`);
    const branch = await output(["git", "rev-parse", "--abbrev-ref", "HEAD"]);
    if (branch !== MAIN_BRANCH) throw new Error(`HEAD is on "${branch}"; publish from ${MAIN_BRANCH}: git switch ${MAIN_BRANCH} && git pull --ff-only`);
    await output(["git", "fetch", REMOTE, MAIN_BRANCH]);
    const [head, remoteHead] = await Promise.all([output(["git", "rev-parse", "HEAD"]), output(["git", "rev-parse", `${REMOTE}/${MAIN_BRANCH}`])]);
    if (head !== remoteHead) throw new Error(`HEAD (${head}) is not ${REMOTE}/${MAIN_BRANCH} (${remoteHead}); run git pull --ff-only, or push nothing local to ${MAIN_BRANCH} (it is protected)`);
    const tag = `v${version}`;
    const tagsAtHead = (await output(["git", "tag", "--points-at", "HEAD"])).split("\n");
    if (!tagsAtHead.includes(tag)) throw new Error(`HEAD has no ${tag} tag; tag the merged release commit and push the tag: git tag -a ${tag} -m ${tag} && git push ${REMOTE} ${tag}`);
    if (!(await output(["git", "ls-remote", "--tags", REMOTE, `refs/tags/${tag}`]))) throw new Error(`${tag} is not on ${REMOTE}; push it so the Release workflow builds the GitHub release: git push ${REMOTE} ${tag}`);
}

/** The built binary must be the one whose hash is committed (`sha256sum -c pdf_wasm_bg.wasm.sha256`). */
export async function checkWasmBinary(): Promise<string> {
    const committed = parseCommittedHash(await Bun.file(join(WASM_SOURCE_DIR, `${WASM_BINARY}.sha256`)).text());
    const binary = Bun.file(join(WASM_SOURCE_DIR, WASM_BINARY));
    if (!(await binary.exists())) throw new Error(`packages/wasm/src/${WASM_BINARY} is not built; run bun run build:wasm`);
    const actual = sha256(await binary.bytes());
    if (actual !== committed) throw new Error(`packages/wasm/src/${WASM_BINARY} has sha256 ${actual}, the committed hash is ${committed}; rebuild it with bun run build:wasm (or build:wasm:docker)`);
    return committed;
}

async function checkNpmLogin(): Promise<void> {
    const result = await capture(["npm", "whoami"]);
    if (result.exitCode !== 0) throw new Error(`npm whoami failed, so npm cannot publish as you; run npm login first.\n${result.stderr}`);
    console.log(`npm user: ${result.stdout.trim()}`);
}

export async function packAndVerify(pkg: WorkspacePackage, committedWasmSha256: string): Promise<string> {
    // Built by test:package, so skip each package's prepack build.
    await output([process.execPath, "pm", "pack", "--ignore-scripts", "--quiet", "--destination", RELEASE_DIR], pkg.directory);
    const tarball = join(RELEASE_DIR, tarballName(pkg.manifest));
    const files = (await output(["tar", "-tzf", tarball])).split("\n");
    const packedManifest = await output(["tar", "-xzOf", tarball, `${TARBALL_ROOT}package.json`]);
    const wasmEntry = `${TARBALL_ROOT}dist/${WASM_BINARY}`;
    const packedWasmSha256 = files.includes(wasmEntry) ? sha256(await extractBytes(tarball, wasmEntry)) : undefined;
    const problems = tarballProblems(pkg.manifest, packedManifest, files, packedWasmSha256, committedWasmSha256);
    if (problems.length) throw new Error(`${tarball} failed verification:\n  ${problems.join("\n  ")}`);
    return tarball;
}

/** Whether name@version is on npm: a 404 means no; any other failure stops the run. */
export async function isPublished(manifest: Manifest): Promise<boolean> {
    const spec = `${manifest.name}@${manifest.version}`;
    const result = await capture(["npm", "view", spec, "version"]);
    if (result.exitCode === 0) return result.stdout.trim() === manifest.version;
    if (result.stderr.includes("E404")) return false;
    throw new Error(`npm view ${spec} failed; check your network and registry:\n${result.stderr}`);
}

export async function publish(tarball: string, tag: string, options: PublishOptions): Promise<void> {
    // No --provenance: npm attests only from a CI provider; the GitHub release keeps the attested tarballs.
    await run(["npm", "publish", tarball, "--access", "public", "--tag", tag, ...(options.otp ? [`--otp=${options.otp}`] : []), ...(options.yes ? [] : ["--dry-run"])]);
}

function printPlan(plan: readonly PlannedPackage[], tag: string, options: PublishOptions): void {
    console.log(`\n${options.yes ? "Publishing" : "Dry run (pass --yes to publish)"} under dist-tag "${tag}":`);
    for (const { manifest, tarball, sha256, published } of plan) {
        console.log(`  ${manifest.name}@${manifest.version}  ${tarball}  sha256 ${sha256}  ${published ? "already published, skipped" : "to publish"}`);
    }
    console.log("");
}

async function main(): Promise<void> {
    const options = parseOptions(Bun.argv.slice(2));
    const packages = await readPackages();
    const version = releaseVersion(packages.map(pkg => pkg.manifest));
    const tag = distTag(version, options.tag);
    const order = publishOrder(packages.map(pkg => pkg.manifest)).flat();

    await checkGit(version);
    const committedWasmSha256 = await checkWasmBinary();
    if (options.yes) await checkNpmLogin();

    // test:package runs `bun run build` first, then installs the packed packages in clean consumers.
    await run([process.execPath, "run", "test:package"]);

    await rm(RELEASE_DIR, { recursive: true, force: true });
    await mkdir(RELEASE_DIR);
    const plan: PlannedPackage[] = [];
    for (const manifest of order) {
        const pkg = packages.find(candidate => candidate.manifest.name === manifest.name);
        if (!pkg) throw new Error(`${manifest.name} vanished from packages/`);
        const tarball = await packAndVerify(pkg, committedWasmSha256);
        plan.push({ manifest, tarball, sha256: sha256(await Bun.file(tarball).bytes()), published: await isPublished(manifest) });
    }
    printPlan(plan, tag, options);

    for (const { manifest, tarball, published } of plan) {
        if (!published) await publish(tarball, tag, options);
        else console.log(`${manifest.name}@${manifest.version} is already on npm, skipped`);
    }
    const done = options.yes ? "published" : "dry-run passed";
    console.log(`\n${plan.map(({ manifest, published }) => `${manifest.name}@${manifest.version}: ${published ? "already published" : done}`).join("\n")}`);
    if (!options.yes) console.log("\nNothing was published. Run bun run publish:npm --yes to publish.");
}

if (import.meta.main) {
    try {
        await main();
    } catch (error) {
        console.error(`\npublish:npm stopped: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
