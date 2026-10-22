import { mkdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { Page } from "playwright";
import { round } from "./browser.ts";

// The tiny case API: defineCase(id, async (t) => { ... }). run.ts loads case files and runs them.

export type Status = "pass" | "fail" | "error" | "manual" | "not-run" | "blocked";
export type Check = { text: string; ok: boolean; detail?: string };

export type CaseResult = { status: Status; checks: Check[]; screenshots: string[]; notes: string; ranAt: string };

export type CaseApi = {
  id: string;
  /** Records one check of the Expected result. Returns `ok` so a case can stop early on it. */
  check(text: string, ok: boolean, detail?: string): boolean;
  /** Saves `evidence/<ID>-<n>-<what>.jpg` (JPEG, viewport only unless `fullPage`) and returns its relative path. */
  shot(page: Page, what: string, options?: { fullPage?: boolean }): Promise<string>;
  /** Free text kept with the result. */
  note(text: string): void;
  /** Not run: the case was not reached or not tried. Never a failure. */
  notRun(reason: string): void;
  /** A person must do this one. */
  manual(reason: string): void;
  /** Cannot run: something it needs is missing (a fixture, a tool, a feature). */
  blocked(reason: string): void;
};

export type CaseBody = (t: CaseApi) => Promise<void>;
export type DefinedCase = { id: string; body: CaseBody };

export const registry: DefinedCase[] = [];

export function defineCase(id: string, body: CaseBody): void {
  if (registry.some((c) => c.id === id)) throw new Error(`Case ${id} is defined twice.`);
  registry.push({ id, body });
}

export const evidenceDir = resolve(round, "evidence");

/** The state of one running case; run.ts turns it into a result. */
export class CaseRun implements CaseApi {
  readonly checks: Check[] = [];
  readonly screenshots: string[] = [];
  readonly notes: string[] = [];
  /** Set by notRun, manual or blocked: the first one wins. */
  declared: { status: "manual" | "not-run" | "blocked"; reason: string } | undefined;
  private shots = 0;

  readonly id: string;

  constructor(id: string) {
    this.id = id;
  }

  check(text: string, ok: boolean, detail?: string): boolean {
    this.checks.push(detail === undefined ? { text, ok } : { text, ok, detail });
    return ok;
  }

  async shot(page: Page, what: string, options: { fullPage?: boolean } = {}): Promise<string> {
    mkdirSync(evidenceDir, { recursive: true });
    const slug = what.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "shot";
    const file = resolve(evidenceDir, `${this.id}-${++this.shots}-${slug}.jpg`);
    await page.screenshot({ path: file, type: "jpeg", quality: 60, fullPage: options.fullPage ?? false });
    const path = relative(round, file).replaceAll("\\", "/");
    this.screenshots.push(path);
    return path;
  }

  note(text: string): void {
    this.notes.push(text);
  }

  private setDeclared(status: "manual" | "not-run" | "blocked", reason: string): void {
    this.declared ??= { status, reason };
  }

  notRun(reason: string): void {
    this.setDeclared("not-run", reason);
  }

  manual(reason: string): void {
    this.setDeclared("manual", reason);
  }

  blocked(reason: string): void {
    this.setDeclared("blocked", reason);
  }
}
