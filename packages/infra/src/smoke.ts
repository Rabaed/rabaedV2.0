// The post-deploy smoke test: checks a deployed environment from the outside,
// as a browser would. `bin/smoke.ts` runs it after every deploy; any failure
// fails the deploy workflow.

export interface SmokeTestOptions {
  /** The environment's HTTPS address, e.g. `https://<load balancer>`. */
  readonly url: string;
  /** The commit that was just deployed; web and the api must both report it. */
  readonly version: string;
  readonly fetch?: typeof fetch;
}

interface Health {
  version?: string;
  api?: { database?: string; version?: string } | null;
}

/** Runs every check and returns what failed; empty means the deploy is good. */
export async function smokeTest({ url, version, fetch: get = fetch }: SmokeTestOptions): Promise<string[]> {
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
    return res.status === 200 ? [] : [`/en/health answered ${res.status}`];
  });

  return failures;
}
