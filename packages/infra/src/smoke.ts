// The post-deploy smoke test: checks a deployed environment from the outside,
// as a browser would. `bin/smoke.ts` runs it after every deploy; any failure
// fails the deploy workflow.

export interface SmokeTestOptions {
  /** The environment's HTTPS address, e.g. `https://<load balancer>`. */
  readonly url: string;
  /** The commit that was just deployed; web and the api must both report it. */
  readonly version: string;
  /**
   * The Arabic font the web image was built with: Thmanyah Sans when the
   * private fonts were available to the build, otherwise IBM Plex Sans Arabic.
   * Left out, any Arabic font passes, as long as it is served from our origin.
   */
  readonly arabicFont?: string;
  readonly fetch?: typeof fetch;
}

interface Health {
  version?: string;
  api?: { database?: string; version?: string } | null;
}

/** Runs every check and returns what failed; empty means the deploy is good. */
export async function smokeTest({ url, version, arabicFont, fetch: get = fetch }: SmokeTestOptions): Promise<string[]> {
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

  return failures;
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
