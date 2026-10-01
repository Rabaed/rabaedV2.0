// The post-deploy smoke test: checks a deployed environment from the outside,
// as a browser would. `bin/smoke.ts` runs it after every deploy; any failure
// fails the deploy workflow. In a demo environment it also signs in as two
// demo people and checks visibility holds (RP-213). Given Rabaed Admin's
// address, it checks Rabaed Admin answers there, and that the customer
// address serves none of it (ADR 0010, RP-254).

export interface SmokeTestOptions {
  /** The environment's HTTPS address, e.g. `https://<load balancer>`. */
  readonly url: string;
  /** Rabaed Admin's own HTTPS address (its own load balancer). */
  readonly adminUrl?: string;
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
export async function smokeTest({ url, adminUrl, version, arabicFont, demoPassword, fetch: get = fetch }: SmokeTestOptions): Promise<string[]> {
  const base = new URL(url);
  const failures: string[] = [];
  const check = async (name: string, run: () => Promise<string[]>) => {
    try {
      failures.push(...(await run()));
    } catch (error) {
      failures.push(`${name}: ${(error as Error).message}`);
    }
  };
  const request = (path: string, init?: RequestInit) => get(new URL(path, base).toString(), { ...init, signal: AbortSignal.timeout(10_000) });

  await check("HTTP redirect", async () => {
    const http = new URL("/en/health", base);
    http.protocol = "http:";
    const res = await get(http.toString(), { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    const location = res.headers.get("location") ?? "";
    const redirected = res.status === 301 && new URL(location, http).protocol === "https:" && new URL(location, http).hostname === base.hostname;
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
    await check("Rabaed Admin health", async () => {
      const health = new URL("/health", adminUrl).toString();
      const res = await get(health, { signal: AbortSignal.timeout(10_000) });
      if (res.status !== 200) return [`${health} answered ${res.status}`];
      const body = (await res.json()) as { version?: string; database?: string };
      const found: string[] = [];
      if (body.version !== version) found.push(`Rabaed Admin runs ${body.version}, expected ${version}`);
      if (body.database !== "ok") found.push(`Rabaed Admin's database: ${body.database}`);
      return found;
    });
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

/**
 * Each of two Members of different Projects gets 404 on the other's Project,
 * its Work Item list and its Work Items, and never sees it listed: visibility
 * holds on the deployed infrastructure, through web's /api/v1 proxy.
 */
export async function visibilityCheck({ url, password, fetch: get = fetch }: { url: string; password: string; fetch?: typeof fetch }): Promise<string[]> {
  const base = new URL(url);
  const call = (path: string, init: RequestInit = {}) => get(new URL(path, base).toString(), { ...init, signal: AbortSignal.timeout(10_000) });

  const signIn = async (email: string): Promise<SignedIn | string> => {
    const res = await call("/api/v1/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c?.startsWith("rabaed_session="));
    if (res.status >= 300 || !cookie) return `sign-in as ${email} answered ${res.status}`;
    const headers = { cookie };
    return {
      email,
      get: (path) => call(path, { headers }),
      // Best effort: a failed sign-out must not hide what the check found.
      signOut: async () => void (await call("/api/v1/session", { method: "DELETE", headers }).catch(() => undefined)),
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
    const projects = async (who: SignedIn) => ((await (await who.get("/api/v1/projects")).json()) as { projects: { id: string; code: string }[] }).projects;
    const items = async (who: SignedIn, projectId: string) =>
      ((await (await who.get(`/api/v1/projects/${projectId}/work-items`)).json()) as { items: { id: string }[] }).items.map((i) => i.id);
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
    await notFound(hafiz, `/api/v1/projects/${jcv.id}`);
    await notFound(hafiz, `/api/v1/projects/${jcv.id}/work-items`);
    for (const id of jcvItems) await notFound(hafiz, `/api/v1/work-items/${id}`);

    const twrItems = (await items(hafiz, twr.id)).slice(0, MAX_ITEMS_CHECKED);
    if (twrItems.length === 0) failures.push("Riyadh Gate Tower has no Work Item to check");
    await notFound(nasser, `/api/v1/projects/${twr.id}`);
    await notFound(nasser, `/api/v1/projects/${twr.id}/work-items`);
    for (const id of twrItems) await notFound(nasser, `/api/v1/work-items/${id}`);
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
