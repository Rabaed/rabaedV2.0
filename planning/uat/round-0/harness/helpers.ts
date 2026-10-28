import type { BrowserContext, Locator, Page } from "playwright";
import { mailpitUrl, pageAs, urlOf, type ContextOptions, type Locale } from "./browser.ts";

// Page and API helpers for cases. Locators are role and name, scoped to a region; a dialog is
// waited for to close before the next step (the lessons of the old round, strategy 13.4).

export const PROJECT_NAME = /Riyadh Gate Tower/;
export const PROJECT_CODE = "TWR";

/** Waits for the page's requests to settle (a click's fetches too, not only the load). */
export async function settle(page: Page, ms = 400): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(ms);
}

/** Opens a path (no locale) and fails with the status when the server errors; a 404 page is returned, not thrown. */
export async function go(page: Page, path: string, locale: Locale = "en"): Promise<number | undefined> {
  const response = await page.goto(urlOf(path, locale), { waitUntil: "networkidle" });
  return response?.status();
}

// ---- Signed-in api calls, made from inside a page so the session cookie and lane host just work ----

export type ApiReply = { status: number; body: unknown; text: string };

export class Api {
  readonly person: string;
  readonly context: BrowserContext;
  private readonly page: Page;

  private constructor(person: string, context: BrowserContext, page: Page) {
    this.person = person;
    this.context = context;
    this.page = page;
  }

  static async as(person: string): Promise<Api> {
    const { context, page } = await pageAs(person);
    // Any page of the web app's origin will do for its /api proxy; not Home, whose reads are the slowest (RP-1050).
    await page.goto(urlOf("/uat-api-origin"), { waitUntil: "domcontentloaded" });
    return new Api(person, context, page);
  }

  /** `path` starts at `/v1/...` or without `/v1`; the web app proxies `/api/v1`. */
  async request(method: string, path: string, body?: unknown): Promise<ApiReply> {
    const url = path.startsWith("/v1/") ? path : `/v1${path}`;
    const reply = await this.page.evaluate(
      async ({ method, url, body }) => {
        const res = await fetch(`/api${url}`, {
          method,
          headers: body === undefined ? {} : { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: res.status, text: await res.text() };
      },
      { method, url, body },
    );
    const parse = (): unknown => {
      try {
        return reply.text ? JSON.parse(reply.text) : null;
      } catch {
        return null;
      }
    };
    return { status: reply.status, body: parse(), text: reply.text };
  }

  get = (path: string) => this.request("GET", path);
  put = (path: string, body: unknown) => this.request("PUT", path, body);
  post = (path: string, body?: unknown) => this.request("POST", path, body);

  /** Takes a Transition, confirmed, with a fresh idempotency key (ADR 0017). */
  transition(workItemId: string, transition: string, extra: Record<string, unknown> = {}): Promise<ApiReply> {
    return this.post(`/work-items/${workItemId}/transitions`, { transition, confirmed: true, idempotencyKey: crypto.randomUUID(), ...extra });
  }
}

/** The status an api path answers to a person, as a one-off. */
export async function apiStatus(person: string, path: string, method = "GET"): Promise<number> {
  const api = await Api.as(person);
  try {
    return (await api.request(method, path)).status;
  } finally {
    await api.context.close();
  }
}

/** The Project "Riyadh Gate Tower - Phase 2" as `person` lists it, or undefined when they do not see it. */
export async function projectIdOf(api: Api): Promise<string | undefined> {
  const reply = await api.get("/projects");
  const projects = (reply.body as { projects?: { id: string; code: string }[] } | null)?.projects ?? [];
  return projects.find((p) => p.code === PROJECT_CODE)?.id;
}

// ---- Pages ----

/** Opens the Project "Riyadh Gate Tower - Phase 2" from the Projects page, and returns its id. */
export async function openProject(page: Page, locale: Locale = "en"): Promise<string> {
  await go(page, "/projects", locale);
  await page.getByRole("main").getByRole("link", { name: PROJECT_NAME }).first().click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}/);
  await settle(page);
  const id = /\/projects\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (!id) throw new Error(`Not on a Project page: ${page.url()}`);
  return id;
}

/** The Project id from the current URL. */
export function projectIdFromUrl(page: Page): string {
  const id = /\/projects\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (!id) throw new Error(`Not on a Project page: ${page.url()}`);
  return id;
}

/** The Module tab of an open Project: submittals, inspections or snag-list; `list` or `kanban`. */
export async function openModule(page: Page, projectId: string, module: "work-items" | "inspections" | "snag-list", view: "list" | "kanban" = "list", locale: Locale = "en"): Promise<void> {
  await go(page, `/projects/${projectId}/${module}${view === "kanban" ? "?view=kanban" : ""}`, locale);
  await settle(page);
}

export const openList = (page: Page, projectId: string, locale: Locale = "en") => openModule(page, projectId, "work-items", "list", locale);
export const openKanban = (page: Page, projectId: string, locale: Locale = "en") => openModule(page, projectId, "work-items", "kanban", locale);

/** The Submittals table's rows: Document Number (or "No number yet"), Subject, and the row's text. */
export async function listRows(page: Page): Promise<{ number: string; subject: string; text: string; href: string | null }[]> {
  return page.getByRole("table").first().locator("tbody tr").evaluateAll((rows) =>
    rows.map((row) => {
      const cells = [...row.querySelectorAll("td")].map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim());
      const link = row.querySelector("a[href*='/work-items/']");
      return { number: cells[1] ?? "", subject: (link?.textContent ?? "").trim(), text: (row.textContent ?? "").replace(/\s+/g, " ").trim(), href: link?.getAttribute("href") ?? null };
    }),
  );
}

/** Opens an item from the List by its Document Number or Subject (the List's Search finds it when it is not on page 1). Returns its id. */
export async function openItem(page: Page, projectId: string, ref: string, locale: Locale = "en"): Promise<string> {
  await openList(page, projectId, locale);
  let row = page.getByRole("table").first().locator("tbody tr").filter({ hasText: ref });
  if ((await row.count()) === 0) {
    const search = page.getByRole("main").getByRole("searchbox").or(page.getByRole("main").getByPlaceholder(/search|بحث/i)).first();
    await search.fill(ref);
    await settle(page, 800);
    row = page.getByRole("table").first().locator("tbody tr").filter({ hasText: ref });
  }
  if ((await row.count()) === 0) throw new Error(`No row for "${ref}" in the Submittals List.`);
  await row.first().locator("a[href*='/work-items/']").first().click();
  await page.waitForURL(/\/work-items\/[0-9a-f-]{36}/);
  await settle(page);
  return /\/work-items\/([0-9a-f-]{36})/.exec(page.url())![1]!;
}

/** The Subject of the open item page (its heading in the page header). */
export async function itemSubject(page: Page): Promise<string> {
  return (await page.getByRole("heading", { level: 1 }).first().innerText()).trim();
}

/**
 * Takes a Transition from the open item page: clicks its button in the main region, fills the
 * Internal Note if given, confirms in the pop-up, and waits for the dialog to close. The
 * pop-up's confirm button has the Transition's own name.
 */
export async function takeTransition(page: Page, name: string | RegExp, options: { note?: string; fill?: (dialog: Locator) => Promise<void> } = {}): Promise<void> {
  await page.getByRole("main").getByRole("button", { name, exact: typeof name === "string" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  if (options.note) await dialog.getByRole("textbox").first().fill(options.note);
  if (options.fill) await options.fill(dialog);
  await dialog.getByRole("button", { name, exact: typeof name === "string" }).click();
  await dialog.waitFor({ state: "hidden" });
  await settle(page, 600);
}

/** Opens a path and reads the plain not-found page: whether it shows, its text, and the HTTP status. */
export async function readNotFound(page: Page, path: string, locale: Locale = "en"): Promise<{ notFound: boolean; text: string; status: number | undefined }> {
  const status = await go(page, path, locale);
  const marker = page.getByTestId("not-found");
  const notFound = (await marker.count()) > 0;
  return { notFound, text: notFound ? (await marker.first().innerText()).replace(/\s+/g, " ").trim() : "", status };
}

/** Signs in as `person`, opens `path`, reads it as the not-found page. */
export async function notFoundFor(person: string, path: string, options: ContextOptions = {}): Promise<{ notFound: boolean; text: string; status: number | undefined }> {
  const { context, page } = await pageAs(person, options);
  try {
    return await readNotFound(page, path, options.locale ?? "en");
  } finally {
    await context.close();
  }
}

// ---- Mail ----

export type MailSummary = { id: string; to: string[]; subject: string; created: string };

/** Mailpit messages for an address (or all), newest first. */
export async function mailTo(address?: string): Promise<MailSummary[]> {
  const url = address ? `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}` : `${mailpitUrl}/api/v1/messages`;
  const res = await fetch(url);
  const json = (await res.json()) as { messages?: { ID: string; To: { Address: string }[]; Subject: string; Created: string }[] };
  return (json.messages ?? []).map((m) => ({ id: m.ID, to: m.To.map((t) => t.Address), subject: m.Subject, created: m.Created }));
}
