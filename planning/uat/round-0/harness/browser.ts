import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, BrowserContext, Page } from "playwright";

// Browser and sign-in for the UAT Round 0 harness. Playwright is the repo's own copy (packages/ui),
// as scripts/screens.ts loads it. Sessions come from `scripts/demo-session.ts`: the password is read
// there and never reaches this code.

const here = dirname(fileURLToPath(import.meta.url));
export const root = resolve(here, "../../../..");
export const round = resolve(here, "..");
export const sessionsDir = resolve(round, ".sessions");

try {
  process.loadEnvFile(resolve(root, ".env"));
} catch {
  // No .env: the lane 7 defaults below apply.
}

export const webUrl = (process.env.WEB_URL ?? "http://lane7.localhost:3700").replace(/\/+$/, "");
export const mailpitUrl = `http://127.0.0.1:${process.env.MAILPIT_PORT ?? "8725"}`;

export type Locale = "en" | "ar";
export type ContextOptions = { locale?: Locale; width?: number; height?: number; phone?: boolean };

/** The demo people's short names (scripts/demo-session.ts) and Layla, Noura, Hind by email. */
export const people: Record<string, string> = {
  saeed: "saeed",
  hafiz: "hafiz",
  ali: "ali",
  omar: "omar",
  yousef: "yousef",
  ahmed: "ahmed",
  sara: "sara",
  mohammed: "mohammed",
  faisal: "faisal",
  nasser: "nasser",
  layla: "layla.mansour@designconsultants.demo.rabaed.test",
  noura: "noura.alharbi@alwaha.demo.rabaed.test",
  hind: "hind.almutairi@alwaha.demo.rabaed.test",
};

function loadPlaywright(): typeof import("playwright") {
  return createRequire(resolve(root, "packages/ui/package.json"))("playwright") as typeof import("playwright");
}

let browser: Browser | undefined;
const open = new Set<BrowserContext>();
const madeThisRun = new Set<string>();

export async function getBrowser(): Promise<Browser> {
  browser ??= await loadPlaywright().chromium.launch();
  return browser;
}

/** The storage-state file of a person, made on demand (once per run) with `demo-session.ts`. */
export function sessionFile(person: string): string {
  const who = people[person.toLowerCase()];
  if (!who) throw new Error(`Unknown person "${person}": add it to people in browser.ts.`);
  const short = person.toLowerCase();
  const file = resolve(sessionsDir, `${short}.json`);
  if (!madeThisRun.has(short) || !existsSync(file)) {
    mkdirSync(sessionsDir, { recursive: true });
    // The same script `pnpm demo:session` runs; node directly so no shell is involved.
    execFileSync(process.execPath, ["--env-file-if-exists=.env", "scripts/demo-session.ts", who, "--out", file], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    madeThisRun.add(short);
  }
  return file;
}

export const PHONE = { width: 375, height: 812 } as const;

/** A browser context signed in as `person`: 1366x800 by default, or a 375x812 phone with `phone`. */
export async function contextAs(person: string, options: ContextOptions = {}): Promise<BrowserContext> {
  const b = await getBrowser();
  const context = await b.newContext({
    storageState: sessionFile(person),
    locale: options.locale === "ar" ? "ar-SA" : "en-US",
    ...(options.phone
      ? { viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
      : { viewport: { width: options.width ?? 1366, height: options.height ?? 800 } }),
  });
  context.setDefaultTimeout(15_000);
  // Next's dev indicator is not part of the page.
  await context.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal { display: none !important; }";
      document.head.append(style);
    });
  });
  open.add(context);
  return context;
}

/** A signed-in context and its first page. */
export async function pageAs(person: string, options: ContextOptions = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await contextAs(person, options);
  return { context, page: await context.newPage() };
}

/** `webUrl/<locale><path>`; a path starts with `/` and has no locale. */
export const urlOf = (path: string, locale: Locale = "en") => `${webUrl}/${locale}${path === "/" ? "" : path}`;

export async function closeContexts(): Promise<void> {
  for (const context of open) await context.close().catch(() => undefined);
  open.clear();
}

export async function closeBrowser(): Promise<void> {
  await closeContexts();
  await browser?.close().catch(() => undefined);
  browser = undefined;
}
