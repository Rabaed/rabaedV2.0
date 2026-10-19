import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolvePerson, signIn, webUrlFromEnv } from "./demo-session.ts";

// pnpm screens <route>... --as <person> [--setup <file>] [--folder <name>] [--out <dir>] [--phone] [--publish] (RP-531)
//
// Full-page screenshots of the running app for a PR (CODING_STANDARDS.md › UI): every
// route at 1366 and 1920 wide, in English and Arabic, signed in as a demo person.
//
//   pnpm screens /work-items/<id> --as hafiz
//
// Routes are given without the locale (`/work-items/<id>`, not `/en/work-items/<id>`);
// each is opened at `WEB_URL/<locale><route>` (WEB_URL from `.env`, so any lane works).
// The sign-in is `pnpm demo:session`'s: the password is read from `.env.demo` inside the
// script and never printed. Shots go to `.screens/<folder>/<route>-<width>-<locale>.png`
// (git-ignored); the folder is the branch's issue key by default.
//
// --setup <file>: a module (e.g. `setup.mjs`) whose default export runs before the shots,
// with API calls made from inside the signed-in page (so `laneN.localhost` and the session
// cookie just work); a failed call (4xx/5xx) stops the run with its status and body:
//
//   export default async (api) => {
//     const { body } = await api.request("POST", "/projects/<id>/work-items", { … });
//     await api.transition(body.id, "send_for_review"); // adds idempotencyKey and confirmed: true
//     return { id: body.id };                          // fills {id} in the routes
//   };
//
// --phone: a phone instead (RP-630): 375 × 812, touch, as a phone's browser says it is.
//
// --publish: commits the PNGs under <folder>/ to `screens-<branch>` on origin (an orphan
// branch the first time, "not for merging"; later runs add to it), without touching this
// checkout, and prints a markdown table of their raw URLs for the PR body.

const root = fileURLToPath(new URL("..", import.meta.url));

export const WIDTHS = [1366, 1920] as const;
export const LOCALES = ["en", "ar"] as const;
const LOCALE_NAMES: Record<(typeof LOCALES)[number], string> = { en: "English", ar: "Arabic" };
/** Viewport height: shots are full-page, so it only decides what is "above the fold" while the page loads. */
const HEIGHT = 900;
/** `--phone`'s one size (RP-630): the design's phone frame. */
export const PHONE = { width: 375, height: 812 } as const;

export type ScreensArgs = { routes: string[]; email: string; short: string; setup?: string; folder: string; out: string; publish: boolean; phone: boolean };

/** Reads the command line. `at` gives the repository root and current branch for the defaults. Throws a plain message on bad input. */
export function parseArgs(argv: string[], at: { root: string; branch: string }): ScreensArgs {
  const routes: string[] = [];
  const values: Record<"as" | "setup" | "folder" | "out", string | undefined> = { as: undefined, setup: undefined, folder: undefined, out: undefined };
  let publish = false;
  let phone = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--publish") {
      publish = true;
      continue;
    }
    if (arg === "--phone") {
      phone = true;
      continue;
    }
    const option = /^--(as|setup|folder|out)(?:=(.*))?$/.exec(arg);
    if (option) {
      const name = option[1] as keyof typeof values;
      const value = option[2] ?? argv[++i];
      if (!value || (option[2] === undefined && value.startsWith("--"))) throw new Error(`--${name} needs a value.`);
      values[name] = value;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option ${arg}.`);
    } else {
      if (!arg.startsWith("/")) throw new Error(`Routes start with /: got "${arg}".`);
      if (/^\/(en|ar)(\/|$)/.test(arg)) throw new Error(`Give routes without the locale (each is shot in both): got "${arg}".`);
      routes.push(arg);
    }
  }
  if (routes.length === 0) throw new Error("Give at least one route, such as /work-items/<id>.");
  if (!values.as) throw new Error("Name the demo person with --as: an email or a short name such as hafiz.");
  const { email, short } = resolvePerson(values.as);
  const folder = values.folder ?? (/^RP-\d+/.exec(at.branch)?.[0] ?? at.branch.replace(/[^A-Za-z0-9._-]/g, "-"));
  if (!/^[A-Za-z0-9._-]+$/.test(folder) || folder.startsWith(".")) throw new Error(`--folder must be a plain name (letters, digits, . _ -): got "${folder}".`);
  return { routes, email, short, setup: values.setup, folder, out: resolve(values.out ?? resolve(at.root, ".screens", folder)), publish, phone };
}

/** `route` with each `{name}` replaced by the setup's value for it. */
export function fillRoute(route: string, values: Record<string, string>): string {
  return route.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`Route ${route} has {${name}}, but the setup returned no "${name}".`);
    return encodeURIComponent(value);
  });
}

/** The file a route's shot is saved as: its path as a name, then width and locale. */
export function shotName(route: string, width: number, locale: string): string {
  const name = route.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "home";
  return `${name}-${width}-${locale}.png`;
}

export type Shot = { route: string; width: number; locale: (typeof LOCALES)[number]; file: string };

const widthsOf = (phone: boolean): readonly number[] => (phone ? [PHONE.width] : WIDTHS);

/** Every shot to take, locale by locale, then width (the phone's one with `phone`). Refuses two routes that would be saved as the same file. */
export function plannedShots(routes: string[], { phone = false }: { phone?: boolean } = {}): Shot[] {
  const byName = new Map<string, string>();
  for (const route of routes) {
    const name = shotName(route, 0, "");
    const other = byName.get(name);
    if (other !== undefined && other !== route) throw new Error(`Routes ${other} and ${route} would be saved as the same file: shoot them in separate runs.`);
    byName.set(name, route);
  }
  return [...new Set(routes)].flatMap((route) => LOCALES.flatMap((locale) => widthsOf(phone).map((width) => ({ route, width, locale, file: shotName(route, width, locale) }))));
}

/** The branch the shots are published to: one level, so its raw URLs never mistake a part of it for the path. */
export const screensBranch = (branch: string) => `screens-${branch.replace(/\//g, "-")}`;

/** `owner/repo` from a GitHub remote URL, https or ssh. */
export function repoSlug(remote: string): string {
  const match = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(remote.trim());
  // Without any user:token@ part, so a credential in the remote is never printed.
  if (!match) throw new Error(`origin is not a GitHub repository (${remote.trim().replace(/\/\/[^@/]*@/, "//")}), so there is no raw URL to link.`);
  return `${match[1]}/${match[2]}`;
}

/** The raw URL of `path` at `ref`: the published commit, so GitHub's raw cache never shows an older image at the same path. */
export const rawUrl = (repo: string, ref: string, path: string) => `https://raw.githubusercontent.com/${repo}/${ref}/${path}`;

/** The PR body's table: one row per route, one column per locale and width. */
export function markdownTable(shots: Shot[], urlOf: (file: string) => string): string {
  const widths = [...new Set(shots.map((shot) => shot.width))];
  const columns = LOCALES.flatMap((locale) => widths.map((width) => ({ locale, width })));
  const routes = [...new Set(shots.map((shot) => shot.route))];
  const cell = (route: string, locale: string, width: number) => {
    const shot = shots.find((s) => s.route === route && s.locale === locale && s.width === width);
    return shot ? `![](${urlOf(shot.file)})` : "";
  };
  return [
    `| Page | ${columns.map((c) => `${LOCALE_NAMES[c.locale]} ${c.width}`).join(" | ")} |`,
    `|---|${columns.map(() => "---").join("|")}|`,
    ...routes.map((route) => `| \`${route}\` | ${columns.map((c) => cell(route, c.locale, c.width)).join(" | ")} |`),
  ].join("\n");
}

// stderr is kept (not shown) so push hints stay out of the table's output; a failure's message still carries it.
const git = (args: string[], env?: NodeJS.ProcessEnv) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] }).trim();

/** The API a setup module gets: requests made from inside the signed-in page, to the web app's /api/v1 proxy. */
export type SetupApi = {
  request(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
  /** Takes a Transition, confirmed and with a fresh idempotencyKey, as every Transition must be (ADR 0017). */
  transition(id: string, transition: string, extra?: Record<string, unknown>): Promise<{ status: number; body: unknown }>;
};

/** The one Playwright Page method setupApi uses, so a test can stand in for the page. */
export type EvaluatingPage = Pick<import("playwright").Page, "evaluate">;

export function setupApi(page: EvaluatingPage): SetupApi {
  const request: SetupApi["request"] = async (method, path, body) => {
    const result = await page.evaluate(
      async ({ method, path, body }) => {
        const res = await fetch(`/api/v1${path}`, {
          method,
          headers: body === undefined ? {} : { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        return { status: res.status, text };
      },
      { method, path, body },
    );
    if (result.status >= 400) throw new Error(`Setup: ${method} ${path} failed with ${result.status}: ${result.text}`);
    try {
      return { status: result.status, body: result.text ? (JSON.parse(result.text) as unknown) : null };
    } catch {
      return { status: result.status, body: result.text };
    }
  };
  return {
    request,
    transition: (id, transition, extra = {}) =>
      request("POST", `/work-items/${id}/transitions`, { transition, confirmed: true, idempotencyKey: crypto.randomUUID(), ...extra }),
  };
}

/** Playwright, as @rabaed/ui depends on it: the repo's own copy, so the root needs no dependency of its own. */
function loadPlaywright(): typeof import("playwright") {
  return createRequire(resolve(root, "packages/ui/package.json"))("playwright") as typeof import("playwright");
}

async function shoot(args: ScreensArgs, webUrl: string): Promise<Shot[]> {
  const storageState = await signIn(args.email, webUrl);
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    let placeholders: Record<string, string> = {};
    if (args.setup) {
      const context = await browser.newContext({ storageState });
      const page = await context.newPage();
      await page.goto(`${webUrl}/en`);
      const setup = (await import(pathToFileURL(resolve(process.cwd(), args.setup)).href)) as { default: (api: SetupApi) => Promise<Record<string, string> | void> };
      placeholders = (await setup.default(setupApi(page))) ?? {};
      await context.close();
    }
    const routes = args.routes.map((route) => fillRoute(route, placeholders));
    const shots = plannedShots(routes, { phone: args.phone });
    mkdirSync(args.out, { recursive: true });
    for (const width of widthsOf(args.phone)) {
      const context = await browser.newContext({
        storageState,
        ...(args.phone ? { viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width, height: HEIGHT } }),
      });
      const page = await context.newPage();
      for (const shot of shots.filter((s) => s.width === width)) {
        const response = await page.goto(`${webUrl}/${shot.locale}${shot.route}`, { waitUntil: "networkidle" });
        if (!response || response.status() >= 400) throw new Error(`${shot.locale}${shot.route} answered ${response?.status() ?? "nothing"}.`);
        // A lost session redirects to the sign-in page with a 200: that is not the page asked for.
        if (new URL(page.url()).pathname.includes("/sign-in")) throw new Error(`${shot.locale}${shot.route} sent ${args.email} to the sign-in page: the session did not hold.`);
        // Next's dev-mode indicator ("N" in a corner) is not part of the page.
        await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        await page.screenshot({ path: join(args.out, shot.file), fullPage: true });
        console.log(join(args.out, shot.file));
      }
      await context.close();
    }
    return shots;
  } finally {
    await browser.close();
  }
}

/** Commits the shots under <folder>/ on top of origin's screens-<branch> (or as its first, orphan commit) with a throwaway index, and pushes it. */
function publish(args: ScreensArgs, shots: Shot[], branch: string): string {
  const target = screensBranch(branch);
  const repo = repoSlug(git(["remote", "get-url", "origin"]));
  // No such branch yet: this is its first, orphan commit. A network or auth failure stops here, not later as a rejected push.
  const parent = git(["ls-remote", "--heads", "origin", target]) ? fetchTip(target) : undefined;
  const scratch = mkdtempSync(join(tmpdir(), "rabaed-screens-"));
  let commit: string;
  try {
    const env = { GIT_INDEX_FILE: join(scratch, "index") };
    if (parent) git(["read-tree", parent], env);
    else git(["read-tree", "--empty"], env);
    for (const shot of shots) {
      const blob = git(["hash-object", "-w", join(args.out, shot.file)]);
      git(["update-index", "--add", "--cacheinfo", `100644,${blob},${args.folder}/${shot.file}`], env);
    }
    const tree = git(["write-tree"], env);
    commit = git(["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", `${branch} screenshots: ${args.folder}/ (not for merging)`]);
    git(["push", "--quiet", "origin", `${commit}:refs/heads/${target}`]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return markdownTable(shots, (file) => rawUrl(repo, commit, `${args.folder}/${file}`));
}

/** The tip of origin's `branch`, fetched into the object store only (no FETCH_HEAD, no local branch). */
function fetchTip(branch: string): string {
  const ref = `refs/screens-publish/${branch}`;
  git(["fetch", "--quiet", "--no-write-fetch-head", "origin", `+refs/heads/${branch}:${ref}`]);
  const tip = git(["rev-parse", ref]);
  git(["update-ref", "-d", ref]);
  return tip;
}

async function main() {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "HEAD") throw new Error("This checkout is on no branch: check out the PR's branch first.");
  const args = parseArgs(process.argv.slice(2), { root, branch });
  const shots = await shoot(args, webUrlFromEnv());
  if (args.publish) console.log(`\n${publish(args, shots, branch)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
