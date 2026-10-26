// The post-deploy smoke test: checks a deployed environment from the outside,
// as a browser would. `bin/smoke.ts` runs it after every deploy; any failure
// fails the deploy workflow. In a demo environment it also signs in as two
// demo people and checks visibility holds (RP-213). Given Rabaed Admin's
// address, it checks Rabaed Admin answers there, and that the customer
// address serves none of it (ADR 0010, RP-254).

export interface SmokeTestOptions {
  /** The environment's HTTPS address, e.g. `https://<load balancer>`. */
  readonly url: string;
  /** Rabaed Admin's own HTTPS address (its own load balancer, or its Vercel project). */
  readonly adminUrl?: string;
  /** Admin's Vercel Protection Bypass for Automation secret, sent to Admin only (it sits behind Password Protection). */
  readonly adminBypass?: string;
  /** The commit that was just deployed; web and the api must both report it. */
  readonly version: string;
  /**
   * The Arabic font the web image was built with: Thmanyah Sans when the
   * private fonts were available to the build, otherwise IBM Plex Sans Arabic.
   * Left out, any Arabic font passes, as long as it is served from our origin.
   */
  readonly arabicFont?: string;
  /** The demo people's password; given in a demo environment, the visibility check runs too. */
  readonly demoPassword?: string;
  readonly fetch?: typeof fetch;
}

interface Health {
  version?: string;
  api?: { database?: string; version?: string } | null;
}

/** Runs every check and returns what failed; empty means the deploy is good. */
export async function smokeTest({ url, adminUrl, adminBypass, version, arabicFont, demoPassword, fetch: get = fetch }: SmokeTestOptions): Promise<string[]> {
  const base = new URL(url);
  const { check, failures } = collector();
  const request = (path: string, init?: RequestInit) => get(new URL(path, base).toString(), { ...init, signal: AbortSignal.timeout(10_000) });

  await check("HTTP redirect", async () => {
    const http = new URL("/en/health", base);
    http.protocol = "http:";
    const res = await get(http.toString(), { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    const location = res.headers.get("location") ?? "";
    // Permanent: 301 from the AWS load balancer, 308 from Vercel.
    const redirected = (res.status === 301 || res.status === 308) && new URL(location, http).protocol === "https:" && new URL(location, http).hostname === base.hostname;
    return redirected ? [] : [`HTTP does not redirect to HTTPS: answered ${res.status} ${location}`.trim()];
  });

  await check("/api/health", async () => {
    const res = await request("/api/health");
    if (res.status !== 200) return [`/api/health answered ${res.status}`];
    const health = (await res.json()) as Health;
    const found: string[] = [];
    if (health.version !== version) found.push(`web runs ${health.version}, expected ${version}`);
    if (!health.api) return [...found, "api unreachable from web"];
    if (health.api.version !== version) found.push(`api runs ${health.api.version}, expected ${version}`);
    if (health.api.database !== "ok") found.push(`database: ${health.api.database}`);
    return found;
  });

  await check("/en/health", async () => {
    const res = await request("/en/health");
    if (res.status !== 200) return [`/en/health answered ${res.status}`];
    const html = await res.text();
    return arabicFontChecks(html, new URL("/en/health", base), request, arabicFont);
  });

  if (demoPassword) await check("visibility", () => visibilityCheck({ url, password: demoPassword, fetch: get }));

  if (adminUrl) {
    await check("Rabaed Admin health", () => healthCheck({ url: adminUrl, who: "Rabaed Admin", version, headers: bypassHeader(adminBypass), fetch: get }));
    await check("no Rabaed Admin on the customer address", async () => {
      const found: string[] = [];
      for (const { method, path } of ADMIN_PATHS) {
        const res = await request(path, { method, redirect: "manual", headers: { "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined });
        // The api answers what it doesn't serve with 404; web may first redirect a page path to add the language.
        const served = path.startsWith("/api/") ? res.status !== 404 : res.status < 300 || res.status >= 500;
        if (served) found.push(`the customer address answered ${method} ${path} with ${res.status}: it must not serve Rabaed Admin`);
      }
      return found;
    });
  }

  return failures;
}

/** Runs named checks, collecting what each found; a check that throws is reported by its name, not thrown. */
function collector() {
  const failures: string[] = [];
  const check = async (name: string, run: () => Promise<string[]>) => {
    try {
      failures.push(...(await run()));
    } catch (error) {
      failures.push(`${name}: ${(error as Error).message}`);
    }
  };
  return { check, failures };
}

/** Admin's Vercel Protection Bypass for Automation header, sent to Admin alone (it sits behind Password Protection). */
const bypassHeader = (secret: string | undefined): Record<string, string> => (secret ? { "x-vercel-protection-bypass": secret } : {});

/** `url`'s /health (the api's or Rabaed Admin's) answers 200 with the deployed version and its database. */
async function healthCheck({ url, who, version, headers = {}, fetch: get }: { url: string; who: string; version: string; headers?: Record<string, string>; fetch: typeof fetch }): Promise<string[]> {
  const health = new URL("/health", url).toString();
  const res = await get(health, { headers, signal: AbortSignal.timeout(10_000) });
  if (res.status !== 200) return [`${health} answered ${res.status}`];
  const body = (await res.json()) as { version?: string; database?: string };
  const found: string[] = [];
  if (body.version !== version) found.push(`${who} runs ${body.version}, expected ${version}`);
  if (body.database !== "ok") found.push(`${who}'s database: ${body.database}`);
  return found;
}

export type SmokeRun = { stage: "web"; options: Omit<SmokeTestOptions, "fetch"> } | { stage: "api"; options: Omit<ApiSmokeTestOptions, "fetch"> } | { error: string };

/**
 * What bin/smoke.ts runs, from its environment: web's smoke given SMOKE_URL (after
 * every deploy), or the api's given SMOKE_API_URL (on Vercel, before web is deployed).
 * Blank values count as unset.
 */
export function smokeRunFromEnv(env: NodeJS.ProcessEnv): SmokeRun {
  const read = (name: string) => env[name] || undefined;
  const url = read("SMOKE_URL");
  const apiUrl = read("SMOKE_API_URL");
  const version = read("SMOKE_VERSION");
  if ((!url && !apiUrl) || !version) return { error: "Set SMOKE_URL (web) or SMOKE_API_URL (the api, before web), and SMOKE_VERSION" };
  if (url && apiUrl) return { error: "Set SMOKE_URL or SMOKE_API_URL, not both" };
  const defined = <T extends object>(options: T): T => Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) as T;
  const admin = { adminUrl: read("SMOKE_ADMIN_URL"), adminBypass: read("SMOKE_ADMIN_BYPASS") };
  const demoPassword = read("SMOKE_DEMO_PASSWORD");
  if (url) return { stage: "web", options: defined({ url, version, ...admin, arabicFont: read("SMOKE_ARABIC_FONT"), demoPassword }) };
  if (!demoPassword) return { error: "SMOKE_API_URL needs SMOKE_DEMO_PASSWORD: the api's smoke is the visibility check" };
  return { stage: "api", options: defined({ apiUrl: apiUrl!, version, demoPassword, ...admin }) };
}

/**
 * Rabaed Admin's routes, and where the customer api served them before Rabaed
 * Admin moved out, as they would look on the customer address. None may answer there.
 */
export const ADMIN_PATHS = [
  { method: "POST", path: "/api/v1/sign-in" },
  { method: "POST", path: "/api/v1/sign-in/code" },
  { method: "POST", path: "/api/v1/companies" },
  { method: "POST", path: "/api/v1/invitations" },
  { method: "GET", path: "/api/v1/onboarding-leads?reason=smoke" },
  { method: "POST", path: "/api/admin/v1/session" },
  { method: "POST", path: "/api/admin/v1/companies" },
  { method: "GET", path: "/assets/admin.js" },
] as const;

/**
 * Two demo people on different Projects (apps/api/src/demo/seed.ts): Hafiz is
 * on Riyadh Gate Tower only, Nasser on Jeddah Corniche Villas only.
 */
export const VISIBILITY_CHECK_PEOPLE = {
  twr: "hafiz.hamdan@tmc.demo.rabaed.test",
  jcv: "nasser.aldosari@betabuild.demo.rabaed.test",
} as const;

/** How many of Riyadh Gate Tower's Work Items (the seeded Draft, and any made in walkthroughs) are tried as Nasser. */
const MAX_ITEMS_CHECKED = 5;

interface SignedIn {
  email: string;
  get(path: string): Promise<Response>;
  signOut(): Promise<void>;
}

export interface ApiSmokeTestOptions {
  /** The api's own HTTPS address (its Vercel project), where the Member API is /v1. */
  readonly apiUrl: string;
  /** The commit that was just deployed; the api (and Admin, if given) must report it. */
  readonly version: string;
  /** The demo people's password: the visibility check runs on the api itself. */
  readonly demoPassword: string;
  readonly adminUrl?: string;
  readonly adminBypass?: string;
  readonly fetch?: typeof fetch;
}

/**
 * The checks that run once the api and Rabaed Admin are deployed and before web
 * is (RP-1043): the api runs this version with its database, visibility holds
 * when asked of the api directly, the api's own public address serves none of
 * Rabaed Admin, and Admin answers. Empty means web may follow.
 */
export async function apiSmokeTest({ apiUrl, version, demoPassword, adminUrl, adminBypass, fetch: get = fetch }: ApiSmokeTestOptions): Promise<string[]> {
  const { check, failures } = collector();
  await check("api health", () => healthCheck({ url: apiUrl, who: "api", version, fetch: get }));
  await check("visibility", () => visibilityCheck({ url: apiUrl, password: demoPassword, memberApi: "/v1", fetch: get }));
  await check("no Rabaed Admin on the api's address", async () => {
    const found: string[] = [];
    for (const { method, path: onWeb } of ADMIN_PATHS) {
      // Web's /api/... is the api's /...; the api answers a route it doesn't serve with 404 before any sign-in check.
      const path = onWeb.replace(/^\/api\//, "/");
      const res = await get(new URL(path, apiUrl).toString(), { method, redirect: "manual", headers: { "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined, signal: AbortSignal.timeout(10_000) });
      if (res.status !== 404) found.push(`the api answered ${method} ${path} with ${res.status}: it must not serve Rabaed Admin`);
    }
    return found;
  });
  if (adminUrl) await check("Rabaed Admin health", () => healthCheck({ url: adminUrl, who: "Rabaed Admin", version, headers: bypassHeader(adminBypass), fetch: get }));
  return failures;
}

/**
 * Each of two Members of different Projects gets 404 on the other's Project,
 * its Work Item list and its Work Items, and never sees it listed: visibility
 * holds on the deployed infrastructure, through web's /api/v1 proxy, or
 * (`memberApi: "/v1"`) asked of the api itself.
 */
export async function visibilityCheck({
  url,
  password,
  memberApi = "/api/v1",
  fetch: get = fetch,
}: {
  url: string;
  password: string;
  /** Where the Member API is on `url`: web's proxy (`/api/v1`) or the api's own (`/v1`). */
  memberApi?: "/api/v1" | "/v1";
  fetch?: typeof fetch;
}): Promise<string[]> {
  const base = new URL(url);
  const call = (path: string, init: RequestInit = {}) => get(new URL(path, base).toString(), { ...init, signal: AbortSignal.timeout(10_000) });

  const signIn = async (email: string): Promise<SignedIn | string> => {
    const res = await call(`${memberApi}/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c?.startsWith("rabaed_session="));
    if (res.status >= 300 || !cookie) return `sign-in as ${email} answered ${res.status}`;
    const headers = { cookie };
    return {
      email,
      get: (path) => call(path, { headers }),
      // Best effort: a failed sign-out must not hide what the check found.
      signOut: async () => void (await call(`${memberApi}/session`, { method: "DELETE", headers }).catch(() => undefined)),
    };
  };

  const hafiz = await signIn(VISIBILITY_CHECK_PEOPLE.twr);
  if (typeof hafiz === "string") return [hafiz];
  const nasser = await signIn(VISIBILITY_CHECK_PEOPLE.jcv);
  if (typeof nasser === "string") {
    await hafiz.signOut();
    return [nasser];
  }

  try {
    const failures: string[] = [];
    const projects = async (who: SignedIn) => ((await (await who.get(`${memberApi}/projects`)).json()) as { projects: { id: string; code: string }[] }).projects;
    const items = async (who: SignedIn, projectId: string) =>
      ((await (await who.get(`${memberApi}/projects/${projectId}/work-items`)).json()) as { items: { id: string }[] }).items.map((i) => i.id);
    const notFound = async (who: SignedIn, path: string) => {
      const res = await who.get(path);
      if (res.status !== 404) failures.push(`${who.email}: ${path} answered ${res.status}, expected 404`);
    };

    const [hafizProjects, nasserProjects] = [await projects(hafiz), await projects(nasser)];
    const twr = hafizProjects.find((p) => p.code === "TWR");
    const jcv = nasserProjects.find((p) => p.code === "JCV");
    if (!twr || !jcv) return [`demo Projects not found (TWR for ${hafiz.email}, JCV for ${nasser.email}): is the demo seeded?`];
    if (hafizProjects.some((p) => p.id === jcv.id)) failures.push(`${hafiz.email} lists JCV`);
    if (nasserProjects.some((p) => p.id === twr.id)) failures.push(`${nasser.email} lists TWR`);

    const jcvItems = await items(nasser, jcv.id);
    if (jcvItems.length === 0) failures.push("Jeddah Corniche Villas has no Work Item to check");
    await notFound(hafiz, `${memberApi}/projects/${jcv.id}`);
    await notFound(hafiz, `${memberApi}/projects/${jcv.id}/work-items`);
    for (const id of jcvItems) await notFound(hafiz, `${memberApi}/work-items/${id}`);

    const twrItems = (await items(hafiz, twr.id)).slice(0, MAX_ITEMS_CHECKED);
    if (twrItems.length === 0) failures.push("Riyadh Gate Tower has no Work Item to check");
    await notFound(nasser, `${memberApi}/projects/${twr.id}`);
    await notFound(nasser, `${memberApi}/projects/${twr.id}/work-items`);
    for (const id of twrItems) await notFound(nasser, `${memberApi}/work-items/${id}`);
    return failures;
  } finally {
    await Promise.all([hafiz.signOut(), nasser.signOut()]);
  }
}

// Fonts are self-hosted (no font CDN), and Arabic is in the font the build was
// given: the page's stylesheets name it, and its file loads from our origin,
// as a browser would fetch it.
async function arabicFontChecks(html: string, page: URL, request: (url: string) => Promise<Response>, expected?: string): Promise<string[]> {
  const faces: Face[] = [];
  let arabic: string | undefined;
  for (const sheet of stylesheetUrls(html, page)) {
    const res = await request(sheet);
    if (res.status !== 200) return [`stylesheet ${sheet} answered ${res.status}`];
    const css = await res.text();
    faces.push(...fontFaces(css, sheet));
    const stack = /--font-arabic:\s*([^;}]+)/.exec(css)?.[1];
    arabic ??= stack && unquote(stack.split(",")[0] ?? "");
  }

  const failures = faces
    .flatMap((face) => face.urls)
    .filter((url) => new URL(url).origin !== page.origin)
    .map((url) => `font from another origin: ${url}`);
  if (!arabic) return [...failures, "no --font-arabic in the page's stylesheets"];
  if (expected && arabic !== expected) failures.push(`Arabic is in ${arabic}, expected ${expected}`);
  const file = faces.find((face) => face.family === arabic)?.urls[0];
  if (!file) return [...failures, `no @font-face for ${arabic}`];
  const res = await request(file);
  if (res.status !== 200) return [...failures, `${arabic} font ${file} answered ${res.status}`];
  // woff2 and woff files start with these signatures.
  const signature = new TextDecoder().decode((await res.arrayBuffer()).slice(0, 4));
  if (signature !== "wOF2" && signature !== "wOFF") failures.push(`${arabic} font ${file} is not a web font`);
  return failures;
}

/** The page's stylesheets, as absolute URLs. */
function stylesheetUrls(html: string, page: URL): string[] {
  return [...html.matchAll(/<link\s[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => /\srel="stylesheet"/.test(tag))
    .map((tag) => /\shref="([^"]+)"/.exec(tag)?.[1])
    .filter((href): href is string => !!href)
    .map((href) => new URL(href, page).toString());
}

/** A CSS font family name without its quotes, if any. */
function unquote(family: string): string {
  return family.trim().replace(/^["']|["']$/g, "");
}

interface Face {
  family: string;
  /** Absolute URLs of its files. */
  urls: string[];
}

/** The @font-face rules of a stylesheet, with URLs resolved against it. */
function fontFaces(css: string, sheetUrl: string): Face[] {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body = ""]) => ({
    family: unquote(/font-family:\s*([^;]+)/.exec(body)?.[1] ?? ""),
    urls: [...body.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map(([, url = ""]) => new URL(url, sheetUrl).toString()),
  }));
}
