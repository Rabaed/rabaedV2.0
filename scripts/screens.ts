import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolvePerson, signIn, webUrlFromEnv } from "./demo-session.ts";

// pnpm screens [<route>...] --as <person> [--setup <file>] [--steps <file>] [--folder <name>] [--out <dir>] [--phone] [--publish] (RP-531)
// pnpm screens --publish-dir <dir> [--folder <name>]                                                                     (RP-991)
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
// Besides `request` and `transition`, the setup gets `api.upload(id, fieldKey, { fileName,
// contentType, body })` (a file field, as the browser uploads it) and `api.as("hafiz")`: the same
// API signed in as another demo person, for states only someone else can reach (RP-968).
//
// Screens (RP-968): the same module may `export const screens = [...]`, each a route shot in one
// state, with the actions that bring the page there, run in order after it loads and before the
// shot, in both languages and at both widths. Its routes take the setup's {name}s too, and
// command-line routes become optional. A shot is saved as `<screen name>-<width>-<locale>.png`.
//
//   export const screens = [
//     { name: "submit-dialog", route: "/packages/{packageId}", actions: [
//       { click: "button", name: { en: "Submit Package", ar: "تقديم الحزمة" } }, // role + exact accessible name
//       { waitFor: "dialog" },                                                  // role, and a name if you like
//     ] },
//     { name: "bulk", route: "/packages/{packageId}", actions: [
//       { check: "Corridor luminaires – Tower 1" },  // the checkbox of the one row with this text
//     ] },
//   ];
//
// Names are locale-safe by naming both: `{ en, ar }` as each page's screen reader hears it, or one
// string when it reads the same in both (a Document Number, a Subject someone typed). Not message
// keys: a Transition's or Code's name comes from its Workflow, not the app's messages. A row is
// found by its text, which is user data and the same in both languages. Every locator is strict
// (exactly one element, 10 s); a failed action stops the run naming the screen, its language and
// width, the action and its Playwright locator. After the last action the shot waits for the
// requests it started (10 s, then a warning) and its finite animations (2 s). Examples:
// scripts/screens-examples/.
//
// --steps <file> (RP-991): a flow the actions above cannot reach (a wizard, an upload, a step whose
// page needs what the last step made). Its default export drives the signed-in Playwright page and
// names each shot; it runs once per language at each width (and at 375 with --phone), after the
// routes and screens, with the setup's values:
//
//   export default async ({ page, goto, shot, inLocale, values }) => {
//     await goto(`/projects/${values.projectId}/registers/import`);    // as a route: no locale
//     await shot("choose-file");                                       // choose-file-<width>-<locale>.png
//     await page.getByLabel(inLocale({ en: "File", ar: "الملف" })).setInputFiles(values.registerFile);
//     await page.getByRole("button", { name: inLocale({ en: "Next", ar: "التالي" }) }).click();
//     await shot("map-columns");
//   };
//
// `shot(name)` waits, as a screen does, for the requests since the last goto or shot (10 s, then a
// warning) and the finite animations (2 s), and saves the full page. A name is a plain file name,
// used once per run; a second "map-columns", or one that a route or screen already saves, stops the
// run. The table's row is the name with the path it was taken on. The flow also gets `api`, the
// setup's API from its page (with `as()`): it runs once per language and width, so a flow that
// changes data makes its own each time. Example: scripts/screens-examples/packages-submit-flow.ts.
//
// --phone: a phone instead (RP-630): 375 × 812, touch, as a phone's browser says it is.
//
// --publish: commits the PNGs under <folder>/ to `screens-<branch>` on origin (an orphan
// branch the first time, "not for merging"; later runs add to it), without touching this
// checkout, and prints a markdown table of their raw URLs for the PR body.
//
// --publish-dir <dir> (RP-991): publishes PNGs already on disk the same way, shooting nothing (no
// --as, no app running): every `<page>-<width>-<locale>.png` in <dir>, one row per page in the
// order they were saved (oldest first, so a flow's steps keep theirs), under
// <folder>/ (the branch's issue key unless --folder names another). Other files are skipped; a PNG
// named otherwise stops the run, naming it.

const root = fileURLToPath(new URL("..", import.meta.url));

export const WIDTHS = [1366, 1920] as const;
export const LOCALES = ["en", "ar"] as const;
const LOCALE_NAMES: Record<(typeof LOCALES)[number], string> = { en: "English", ar: "Arabic" };
/** Viewport height: shots are full-page, so it only decides what is "above the fold" while the page loads. */
const HEIGHT = 900;
/** `--phone`'s one size (RP-630): the design's phone frame. */
export const PHONE = { width: 375, height: 812 } as const;

export type ScreensArgs = {
  routes: string[];
  email: string;
  short: string;
  setup?: string;
  steps?: string;
  /** --publish-dir: publish the PNGs already in this folder; nothing is shot. */
  publishDir?: string;
  folder: string;
  out: string;
  publish: boolean;
  phone: boolean;
};

/** Reads the command line. `at` gives the repository root and current branch for the defaults. Throws a plain message on bad input. */
export function parseArgs(argv: string[], at: { root: string; branch: string }): ScreensArgs {
  const routes: string[] = [];
  const values: Record<"as" | "setup" | "steps" | "publish-dir" | "folder" | "out", string | undefined> = {
    as: undefined,
    setup: undefined,
    steps: undefined,
    "publish-dir": undefined,
    folder: undefined,
    out: undefined,
  };
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
    const option = /^--(as|setup|steps|publish-dir|folder|out)(?:=(.*))?$/.exec(arg);
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
  const folder = values.folder ?? (/^RP-\d+/.exec(at.branch)?.[0] ?? at.branch.replace(/[^A-Za-z0-9._-]/g, "-"));
  if (!/^[A-Za-z0-9._-]+$/.test(folder) || folder.startsWith(".")) throw new Error(`--folder must be a plain name (letters, digits, . _ -): got "${folder}".`);
  const publishDir = values["publish-dir"];
  if (publishDir !== undefined) {
    const shooting = [routes.length > 0 && "routes", values.as && "--as", values.setup && "--setup", values.steps && "--steps", phone && "--phone", values.out && "--out"].filter(Boolean);
    if (shooting.length > 0) throw new Error(`--publish-dir publishes PNGs already on disk and shoots nothing: drop ${shooting.join(", ")}.`);
    const dir = resolve(publishDir);
    return { routes, email: "", short: "", publishDir: dir, folder, out: dir, publish: true, phone };
  }
  if (routes.length === 0 && !values.setup && !values.steps)
    throw new Error("Give at least one route, such as /work-items/<id>, a --setup that exports screens, or --steps.");
  if (!values.as) throw new Error("Name the demo person with --as: an email or a short name such as hafiz.");
  const { email, short } = resolvePerson(values.as);
  return { routes, email, short, setup: values.setup, steps: values.steps, folder, out: resolve(values.out ?? resolve(at.root, ".screens", folder)), publish, phone };
}

/** `route` with each `{name}` replaced by the setup's value for it. */
export function fillRoute(route: string, values: Record<string, string>): string {
  return route.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`Route ${route} has {${name}}, but the setup returned no "${name}".`);
    return encodeURIComponent(value);
  });
}

/** The file a shot is saved as: a route's path or a screen's name as a name, then width and locale. */
export function shotName(route: string, width: number, locale: string): string {
  const name = route.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "home";
  return `${name}-${width}-${locale}.png`;
}

type Locale = (typeof LOCALES)[number];

/**
 * An accessible name: one string when it reads the same in both languages (a Document Number, a
 * Subject the user typed), else `{ en, ar }`, each as that page's screen reader hears it.
 */
export type AccessibleName = string | Record<Locale, string>;

/** A step run on a screen after it loads and before its shot. */
export type ScreenAction =
  /** Clicks the one element with this ARIA role and exact accessible name. */
  | { click: string; name: AccessibleName }
  /** Checks the checkbox in the one table row whose text has `check` (a Document Number or Subject: the same in both languages). */
  | { check: string }
  /** Waits until the element with this role (and name, when given) shows. */
  | { waitFor: string; name?: AccessibleName };

/** A route shot in one state: `name` is its file's name, `actions` bring the page to that state. */
export type Screen = { name: string; route: string; actions: ScreenAction[] };

const plainName = /^[A-Za-z0-9._-]+$/;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Checks a route as given on the command line or in a screen; returns the refusal, or null. */
function routeProblem(route: string): string | null {
  if (!route.startsWith("/")) return `must start with /: got "${route}"`;
  if (/^\/(en|ar)(\/|$)/.test(route)) return `is given without the locale (each is shot in both): got "${route}"`;
  return null;
}

function parseName(value: unknown, verb: string): AccessibleName {
  if (typeof value === "string" && value.trim()) return value;
  if (isRecord(value) && typeof value.en === "string" && value.en.trim() && typeof value.ar === "string" && value.ar.trim()) return { en: value.en, ar: value.ar };
  if (value === undefined) throw new Error(`${verb} needs a name`);
  throw new Error(`${verb}'s name is a string, or both en and ar: got ${JSON.stringify(value)}`);
}

function parseRole(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z]+$/.test(value)) throw new Error(`${JSON.stringify(value)} is not an ARIA role (such as button, dialog, row)`);
  return value;
}

/** The name in the page's language: `name[locale]`, or the one name both share. A --steps module uses it for its locators. */
export const inLocale = (name: AccessibleName, locale: Locale) => (typeof name === "string" ? name : name[locale]);
const nameIn = inLocale;

/** What an action acts on: the one element with a role (and exact name), or the checkbox of the one row with a text. */
export type Target = { role: string; name?: string } | { row: string };

type Verb = "click" | "check" | "waitFor";

/**
 * Each kind of action, by its key: how it is read from a setup module, what it acts on in a
 * page's language, and how it is said in a failure. The one place a new kind is added.
 */
const ACTIONS: { [V in Verb]: { parse(value: Record<string, unknown>): ScreenAction; target(action: ScreenAction, locale: Locale): Target; say(target: Target): string } } = {
  click: {
    parse: (value) => ({ click: parseRole(value.click), name: parseName(value.name, "click") }),
    target: (action, locale) => {
      const { click, name } = action as Extract<ScreenAction, { click: string }>;
      return { role: click, name: nameIn(name, locale) };
    },
    say: (target) => `click ${"role" in target ? `${target.role} "${target.name}"` : ""}`,
  },
  check: {
    parse: (value) => {
      if (typeof value.check !== "string" || !value.check.trim()) throw new Error("check needs the text of its row (a Document Number or Subject)");
      return { check: value.check };
    },
    target: (action) => ({ row: (action as Extract<ScreenAction, { check: string }>).check }),
    say: (target) => `check the row "${"row" in target ? target.row : ""}"`,
  },
  waitFor: {
    parse: (value) => ({ waitFor: parseRole(value.waitFor), ...(value.name === undefined ? {} : { name: parseName(value.name, "waitFor") }) }),
    target: (action, locale) => {
      const { waitFor, name } = action as Extract<ScreenAction, { waitFor: string }>;
      return name === undefined ? { role: waitFor } : { role: waitFor, name: nameIn(name, locale) };
    },
    say: (target) => `wait for ${"role" in target ? `${target.role}${target.name === undefined ? "" : ` "${target.name}"`}` : ""}`,
  },
};

const VERBS = Object.keys(ACTIONS) as Verb[];
/** An action's kind: the one key of ACTIONS it has. */
const verbOf = (action: ScreenAction): Verb => VERBS.find((verb) => verb in action)!;

function parseAction(value: unknown): ScreenAction {
  if (!isRecord(value)) throw new Error(`an action is an object: got ${JSON.stringify(value)}`);
  const verb = VERBS.find((key) => key in value);
  if (!verb) throw new Error(`an action is ${VERBS.slice(0, -1).join(", ")} or ${VERBS.at(-1)}: got ${JSON.stringify(value)}`);
  return ACTIONS[verb].parse(value);
}

/** A setup module's `screens` export, checked; `source` (its file) starts every refusal. */
export function parseScreens(value: unknown, source: string): Screen[] {
  if (!Array.isArray(value)) throw new Error(`${source}: screens must be a list of { name, route, actions }.`);
  const names = new Set<string>();
  return value.map((item, i) => {
    if (!isRecord(item) || typeof item.name !== "string" || !item.name) throw new Error(`${source}: screen ${i + 1} needs a name.`);
    const { name } = item;
    if (!plainName.test(name) || name.startsWith(".")) throw new Error(`${source}: screen ${i + 1} ("${name}") must have a plain name (letters, digits, . _ -): it names the file.`);
    if (names.has(name)) throw new Error(`${source}: two screens named "${name}".`);
    names.add(name);
    const problem = typeof item.route === "string" ? routeProblem(item.route) : "is missing";
    if (problem) throw new Error(`${source}: screen "${name}": its route ${problem}.`);
    const actions = item.actions ?? [];
    if (!Array.isArray(actions)) throw new Error(`${source}: screen "${name}": actions must be a list.`);
    return {
      name,
      route: item.route as string,
      actions: actions.map((action, j) => {
        try {
          return parseAction(action);
        } catch (error) {
          throw new Error(`${source}: screen "${name}", action ${j + 1}: ${(error as Error).message}.`, { cause: error });
        }
      }),
    };
  });
}

/** The Playwright locator a target is found by, as code, so a failure says where to look. The one place it is spelled. */
const targetCode = (target: Target) =>
  "row" in target
    ? `getByRole("row").filter({ hasText: ${JSON.stringify(target.row)} }).getByRole("checkbox")`
    : target.name === undefined
      ? `getByRole(${JSON.stringify(target.role)})`
      : `getByRole(${JSON.stringify(target.role)}, { name: ${JSON.stringify(target.name)}, exact: true })`;

/** The Playwright locator an action uses in a page of `locale`, as code. */
export const locatorOf = (action: ScreenAction, locale: Locale): string => targetCode(ACTIONS[verbOf(action)].target(action, locale));

/** What runActions needs from a page: to act on a target, so a test can stand in for the browser. */
export type ActionDriver = { run(verb: Verb, target: Target): Promise<void> };

/** Runs `screen`'s actions in order on a page in `locale`; the first that fails stops it, named with its screen, number and locator. */
export async function runActions(driver: ActionDriver, screen: Screen, at: { locale: Locale; width: number }): Promise<void> {
  for (const [i, action] of screen.actions.entries()) {
    const verb = verbOf(action);
    const target = ACTIONS[verb].target(action, at.locale);
    try {
      await driver.run(verb, target);
    } catch (error) {
      const cause = (error instanceof Error ? error.message : String(error)).split("\n")[0];
      throw new Error(`Screen "${screen.name}" (${at.locale}, ${at.width}): action ${i + 1} of ${screen.actions.length}, ${ACTIONS[verb].say(target)}, failed at ${targetCode(target)}: ${cause}`, {
        cause: error,
      });
    }
  }
}

/** How long one action may wait for its element, and the requests after the last one may take to settle. */
const ACTION_TIMEOUT = 10_000;
/** How long the animations after the last action may take before the shot is taken anyway. */
const ANIMATION_TIMEOUT = 2_000;

/** runActions' driver on a Playwright page: every locator strict (exactly one element), the one targetCode prints. */
function playwrightDriver(page: import("playwright").Page): ActionDriver {
  type Role = Parameters<import("playwright").Page["getByRole"]>[0];
  const locate = (target: Target) =>
    "row" in target
      ? page.getByRole("row").filter({ hasText: target.row }).getByRole("checkbox")
      : page.getByRole(target.role as Role, target.name === undefined ? {} : { name: target.name, exact: true });
  return {
    run: (verb, target) => {
      const locator = locate(target);
      if (verb === "click") return locator.click({ timeout: ACTION_TIMEOUT });
      if (verb === "check") return locator.check({ timeout: ACTION_TIMEOUT });
      return locator.waitFor({ state: "visible", timeout: ACTION_TIMEOUT });
    },
  };
}

/** How many times a page that answered 404 or 5xx is loaded, LOAD_RETRY_MS apart, before the run stops. */
const LOAD_TRIES = 3;
const LOAD_RETRY_MS = 2_000;

/**
 * Loads a page through `goto` (its HTTP status, or undefined for no answer) until it answers
 * below 400. The web app answers 404 when its API read takes over 3 s (apps/web/src/lib/session.ts),
 * as under load, so a 404 or 5xx is tried again, with a warning, and the run stops after LOAD_TRIES.
 */
export async function loadPage(
  goto: () => Promise<number | undefined>,
  page: string,
  { sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)), warn = console.warn }: { sleep?: (ms: number) => Promise<void>; warn?: (line: string) => void } = {},
): Promise<void> {
  for (let tries = 1; ; tries++) {
    const status = await goto();
    if (status !== undefined && status < 400) return;
    const answer = status ?? "nothing";
    if (tries >= LOAD_TRIES) throw new Error(`${page} answered ${answer}, ${LOAD_TRIES} times.`);
    warn(`Warning: ${page} answered ${answer} (try ${tries} of ${LOAD_TRIES}); trying again: the web server answers 404 when its API read takes over 3 s.`);
    await sleep(LOAD_RETRY_MS);
  }
}

/** The page events trackRequests listens to. */
type RequestEvents = { on(event: string, listener: () => void): unknown; off(event: string, listener: () => void): unknown };
const REQUEST_EVENTS = { request: 1, requestfinished: -1, requestfailed: -1 } as const;

/**
 * Counts `page`'s requests from now. `settle()` waits until none has been in flight for half a
 * second, true, or gives up after ACTION_TIMEOUT, false; `networkidle` covers only the page's load,
 * not the fetches a click starts. Both it and `stop()` remove the listeners (stop: an action threw).
 */
export function trackRequests(
  page: RequestEvents,
  { now = Date.now, sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)) }: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): { settle(): Promise<boolean>; stop(): void } {
  let inFlight = 0;
  let last = now();
  const listeners = Object.entries(REQUEST_EVENTS).map(([event, step]) => {
    const listener = () => {
      inFlight = Math.max(0, inFlight + step);
      last = now();
    };
    page.on(event, listener);
    return [event, listener] as const;
  });
  const stop = () => {
    for (const [event, listener] of listeners) page.off(event, listener);
  };
  return {
    stop,
    settle: async () => {
      const giveUpAt = now() + ACTION_TIMEOUT;
      let quiet = false;
      while (!quiet && now() < giveUpAt) {
        quiet = inFlight === 0 && now() - last >= 500;
        if (!quiet) await sleep(50);
      }
      stop();
      return quiet;
    },
  };
}

/** What shoot() prints when a screen's requests had not settled: the shot may show a loading state. */
export const unsettledWarning = (screen: Pick<Screen, "name">, at: { locale: Locale; width: number }) =>
  // eslint-disable-next-line rabaed/no-avoid-terms -- HTTP requests and this script's own screen actions, not Rabaed terms
  `Warning: screen "${screen.name}" (${at.locale}, ${at.width}): requests were still in flight ${ACTION_TIMEOUT / 1000} s after its last action; shot anyway.`;

/**
 * Waits for the page's finite animations (a dialog fading in) to finish, at most `timeoutMs`;
 * an infinite one (a spinner) never does, so it is skipped. Self-contained: it runs in the page
 * through page.evaluate, where `animations` defaults to the document's.
 */
export async function finishAnimations(timeoutMs: number, animations: Animation[] = document.getAnimations()): Promise<"done" | "timed out"> {
  const finite = animations.filter((animation) => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime ?? 0)));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timed out">((done) => {
    timer = setTimeout(() => done("timed out"), timeoutMs);
  });
  const finished = Promise.all(finite.map((animation) => animation.finished.catch(() => undefined))).then(() => "done" as const);
  const result = await Promise.race([finished, timedOut]);
  clearTimeout(timer);
  return result;
}

/**
 * One PNG: a route as it loads, a Screen after its actions (`screen`), or a named shot of a --steps
 * flow or a --publish-dir file (`page`; a --publish-dir file has no route, "").
 */
export type Shot = { route: string; screen?: Screen; page?: string; width: number; locale: Locale; file: string };

const widthsOf = (phone: boolean): readonly number[] => (phone ? [PHONE.width] : WIDTHS);

/**
 * Every shot to take, locale by locale, then width: a route from the command line as it loads, a
 * Screen after its actions, saved under its name; at the phone's one width with `phone`. Refuses two
 * that would be saved as the same file, case aside (Windows file names ignore it).
 */
export function plannedShots(items: readonly (string | Screen)[], { phone = false }: { phone?: boolean } = {}): Shot[] {
  const seen = new Map<string, string | Screen>();
  const unique: (string | Screen)[] = [];
  const said = (item: string | Screen) => (typeof item === "string" ? item : `"${item.name}"`);
  for (const item of items) {
    const key = shotName(typeof item === "string" ? item : item.name, 0, "").toLowerCase();
    const other = seen.get(key);
    if (other === undefined) {
      seen.set(key, item);
      unique.push(item);
      continue;
    }
    // The same route twice is shot once.
    if (other === item) continue;
    const both =
      typeof other === typeof item
        ? `${typeof item === "string" ? "Routes" : "Screens"} ${said(other)} and ${said(item)}`
        : `${typeof other === "string" ? "Route" : "Screen"} ${said(other)} and ${typeof item === "string" ? "route" : "screen"} ${said(item)}`;
    throw new Error(`${both} would be saved as the same file: rename one, or shoot them in separate runs.`);
  }
  return unique.flatMap((item) =>
    LOCALES.flatMap((locale) =>
      widthsOf(phone).map((width) =>
        typeof item === "string"
          ? { route: item, width, locale, file: shotName(item, width, locale) }
          : { route: item.route, screen: item, width, locale, file: shotName(item.name, width, locale) },
      ),
    ),
  );
}

const shotFile = /^(?<page>.+)-(?<width>\d+)-(?<locale>en|ar)\.png$/i;

/**
 * The PNGs of a folder for --publish-dir, page by page in the order of `files` (main() passes them
 * oldest first, so a flow's steps keep their order), then locale and width: each named
 * `<page>-<width>-<locale>.png`, as `pnpm screens` and a --steps flow save them. Other files are
 * skipped; a PNG named otherwise is refused, since its row and column would be a guess.
 */
export function shotsOnDisk(files: readonly string[]): Shot[] {
  const shots = files
    .filter((file) => /\.png$/i.test(file))
    .map((file): Shot => {
      const match = shotFile.exec(file);
      if (!match?.groups) throw new Error(`${file} is not named <page>-<width>-<locale>.png (locale en or ar), so it has no row or column in the table: rename it.`);
      const { page, width, locale } = match.groups as { page: string; width: string; locale: string };
      return { route: "", page, width: Number(width), locale: locale.toLowerCase() as Locale, file };
    });
  if (shots.length === 0) throw new Error("The folder has no PNGs to publish.");
  const pages = [...new Set(shots.map((shot) => shot.page!))];
  return shots.sort((a, b) => pages.indexOf(a.page!) - pages.indexOf(b.page!) || LOCALES.indexOf(a.locale) - LOCALES.indexOf(b.locale) || a.width - b.width);
}

/**
 * The `shot(name)` of a --steps flow at one locale and width: the Shot for a step named `name`,
 * taken on `route`, saved as `<name>-<width>-<locale>.png`. `taken` is every file the run saves
 * (lower-cased: Windows file names ignore case), shared across the run, so two steps, or a step and
 * a route or Screen, never overwrite each other.
 */
export function stepRecorder(at: { locale: Locale; width: number }, taken: Set<string>): (name: string, route: string) => Shot {
  return (name, route) => {
    if (!plainName.test(name)) throw new Error(`Step shot "${name}": a name is letters, digits, . _ - (it becomes the file name).`);
    const file = shotName(name, at.width, at.locale);
    if (taken.has(file.toLowerCase())) throw new Error(`Step shot "${name}" (${at.locale}, ${at.width}) would be saved as ${file.toLowerCase()}, which this run already shot: name each shot once.`);
    taken.add(file.toLowerCase());
    return { route, page: name, width: at.width, locale: at.locale, file };
  };
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
  const label = (shot: Shot) => {
    const name = shot.screen?.name ?? shot.page;
    if (name === undefined) return `\`${shot.route}\``;
    return shot.route ? `${name}: \`${shot.route}\`` : name;
  };
  const rows = [...new Set(shots.map(label))];
  const cell = (row: string, locale: string, width: number) => {
    const shot = shots.find((s) => label(s) === row && s.locale === locale && s.width === width);
    return shot ? `![](${urlOf(shot.file)})` : "";
  };
  return [
    `| Page | ${columns.map((c) => `${LOCALE_NAMES[c.locale]} ${c.width}`).join(" | ")} |`,
    `|---|${columns.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row} | ${columns.map((c) => cell(row, c.locale, c.width)).join(" | ")} |`),
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
  /** Uploads a file to an item's file field as the browser does: a signed URL from the API, the file, then the API told it is there. */
  upload(id: string, fieldKey: string, file: { fileName: string; contentType: string; body: Uint8Array }): Promise<void>;
  /** The same API, signed in as another demo person (short name or email), for the states only someone else can reach. */
  as(person: string): Promise<SetupApi>;
};

/** The one Playwright Page method setupApi uses, so a test can stand in for the page. */
export type EvaluatingPage = Pick<import("playwright").Page, "evaluate">;

type StartedUpload = { id: string; upload: { url: string; method: string; headers: Record<string, string> } };

export function setupApi(page: EvaluatingPage, signInAs?: (person: string) => Promise<SetupApi>): SetupApi {
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
    upload: async (id, fieldKey, file) => {
      const documents = `/work-items/${id}/documents`;
      const { body: started } = (await request("POST", documents, { fieldKey, fileName: file.fileName, contentType: file.contentType, sizeBytes: file.body.byteLength })) as {
        body: StartedUpload;
      };
      // From inside the page too: the file store answers the web app's origin, as it does the browser's.
      const put = await page.evaluate(
        async ({ url, method, headers, base64 }) => {
          const res = await fetch(url, { method, headers, body: Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)) });
          return { status: res.status, text: await res.text() };
        },
        { ...started.upload, base64: Buffer.from(file.body).toString("base64") },
      );
      if (put.status >= 400) throw new Error(`Setup: the file store answered ${put.status} to ${file.fileName}: ${put.text}`);
      await request("POST", `${documents}/${started.id}/confirm`);
    },
    as: (person) => {
      if (!signInAs) return Promise.reject(new Error(`Setup: as("${person}") has no sign-in here.`));
      return signInAs(person);
    },
  };
}

/** Playwright, as @rabaed/ui depends on it: the repo's own copy, so the root needs no dependency of its own. */
function loadPlaywright(): typeof import("playwright") {
  return createRequire(resolve(root, "packages/ui/package.json"))("playwright") as typeof import("playwright");
}

/**
 * What a --steps module's default export gets, once per locale at each width: the signed-in page,
 * the setup's API and values, and three helpers. `goto(route)` opens a route without the locale as
 * the routes are opened; `shot(name)` waits for the requests since the last goto or shot and the
 * finite animations, then saves the full page as `<name>-<width>-<locale>.png`. The flow runs once
 * per locale and width, so one that changes data (Submits a Package) makes its own with `api`.
 */
export type StepContext = {
  page: import("playwright").Page;
  api: SetupApi;
  locale: Locale;
  width: number;
  values: Record<string, string>;
  inLocale(name: AccessibleName): string;
  goto(route: string): Promise<void>;
  shot(name: string): Promise<void>;
};

/** Opens `route` in `locale` and checks it is the page asked for, not the sign-in page; hides Next's dev indicator. */
async function openPage(page: import("playwright").Page, url: string, label: string, email: string): Promise<void> {
  await loadPage(async () => (await page.goto(url, { waitUntil: "networkidle" }))?.status(), label);
  // A lost session redirects to the sign-in page with a 200: that is not the page asked for.
  if (new URL(page.url()).pathname.includes("/sign-in")) throw new Error(`${label} sent ${email} to the sign-in page: the session did not hold.`);
  // Next's dev-mode indicator ("N" in a corner) is not part of the page.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

/** Runs a --steps module's flow on `page` at one locale and width, and returns the shots it named. */
async function runSteps(
  flow: (step: StepContext) => Promise<void>,
  page: import("playwright").Page,
  at: {
    locale: Locale;
    width: number;
    webUrl: string;
    email: string;
    out: string;
    values: Record<string, string>;
    taken: Set<string>;
    signInAs: (person: string) => Promise<SetupApi>;
  },
): Promise<Shot[]> {
  const record = stepRecorder(at, at.taken);
  const shots: Shot[] = [];
  let requests = trackRequests(page);
  try {
    await flow({
      page,
      api: setupApi(page, at.signInAs),
      locale: at.locale,
      width: at.width,
      values: at.values,
      inLocale: (name) => inLocale(name, at.locale),
      goto: async (route) => {
        requests.stop();
        await openPage(page, `${at.webUrl}/${at.locale}${route}`, `${at.locale}${route}`, at.email);
        requests = trackRequests(page);
      },
      shot: async (name) => {
        const path = new URL(page.url()).pathname.replace(new RegExp(`^/${at.locale}(?=/|$)`), "") || "/";
        const shot = record(name, path);
        if (!(await requests.settle())) console.warn(unsettledWarning({ name }, at));
        await page.evaluate(finishAnimations, ANIMATION_TIMEOUT);
        await page.screenshot({ path: join(at.out, shot.file), fullPage: true });
        console.log(join(at.out, shot.file));
        shots.push(shot);
        requests = trackRequests(page);
      },
    });
  } finally {
    requests.stop();
  }
  return shots;
}

async function shoot(args: ScreensArgs, webUrl: string): Promise<Shot[]> {
  const storageState = await signIn(args.email, webUrl);
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    let placeholders: Record<string, string> = {};
    let screens: Screen[] = [];
    /** Pages signed in for the setup's and the steps' `as()`; closed with the browser. */
    const apiContexts: import("playwright").BrowserContext[] = [];
    /** A SetupApi from a page signed in with `state`; `as()` signs in someone else the same way. */
    const apiFor = async (state: Awaited<ReturnType<typeof signIn>>): Promise<SetupApi> => {
      const context = await browser.newContext({ storageState: state });
      apiContexts.push(context);
      const page = await context.newPage();
      await page.goto(`${webUrl}/en`);
      return setupApi(page, signInAs);
    };
    const signInAs = async (person: string) => apiFor(await signIn(resolvePerson(person).email, webUrl));
    if (args.setup) {
      const setup = (await import(pathToFileURL(resolve(process.cwd(), args.setup)).href)) as {
        default?: (api: SetupApi) => Promise<Record<string, string> | void>;
        screens?: unknown;
      };
      if (setup.screens !== undefined) screens = parseScreens(setup.screens, args.setup);
      if (setup.default) placeholders = (await setup.default(await apiFor(storageState))) ?? {};
    }
    let flow: ((step: StepContext) => Promise<void>) | undefined;
    if (args.steps) {
      const module = (await import(pathToFileURL(resolve(process.cwd(), args.steps)).href)) as { default?: unknown };
      if (typeof module.default !== "function") throw new Error(`${args.steps} has no default export: a --steps module exports default async ({ page, goto, shot }) => { … }.`);
      flow = module.default as (step: StepContext) => Promise<void>;
    }
    if (args.routes.length === 0 && screens.length === 0 && !flow) throw new Error(`Give at least one route, or export screens from ${args.setup}.`);
    const shots = plannedShots([
      ...args.routes.map((route) => fillRoute(route, placeholders)),
      ...screens.map((screen) => ({ ...screen, route: fillRoute(screen.route, placeholders) })),
    ], { phone: args.phone });
    const taken = new Set(shots.map((shot) => shot.file.toLowerCase()));
    mkdirSync(args.out, { recursive: true });
    for (const width of widthsOf(args.phone)) {
      const context = await browser.newContext({
        storageState,
        ...(args.phone ? { viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width, height: HEIGHT } }),
      });
      const page = await context.newPage();
      for (const shot of shots.filter((s) => s.width === width)) {
        await openPage(page, `${webUrl}/${shot.locale}${shot.route}`, `${shot.locale}${shot.route}`, args.email);
        if (shot.screen) {
          const requests = trackRequests(page);
          try {
            await runActions(playwrightDriver(page), shot.screen, shot);
            // What the last action opened finishes loading (a dialog reads its form) and animating in.
            if (!(await requests.settle())) console.warn(unsettledWarning(shot.screen, shot));
          } finally {
            requests.stop();
          }
          await page.evaluate(finishAnimations, ANIMATION_TIMEOUT);
        }
        await page.screenshot({ path: join(args.out, shot.file), fullPage: true });
        console.log(join(args.out, shot.file));
      }
      if (flow) {
        for (const locale of LOCALES) {
          shots.push(...(await runSteps(flow, page, { locale, width, webUrl, email: args.email, out: args.out, values: placeholders, taken, signInAs })));
        }
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
  if (args.publishDir) {
    if (!existsSync(args.publishDir)) throw new Error(`--publish-dir: there is no folder ${args.publishDir}.`);
    const oldestFirst = readdirSync(args.publishDir)
      .map((file) => ({ file, at: statSync(join(args.publishDir!, file)).mtimeMs }))
      .sort((a, b) => a.at - b.at)
      .map(({ file }) => file);
    console.log(publish(args, shotsOnDisk(oldestFirst), branch));
    return;
  }
  const shots = await shoot(args, webUrlFromEnv());
  if (args.publish) console.log(`\n${publish(args, shots, branch)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
