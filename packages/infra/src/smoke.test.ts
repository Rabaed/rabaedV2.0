import { describe, expect, it } from "vitest";
import { smokeTest, VISIBILITY_CHECK_PEOPLE, visibilityCheck } from "./smoke.ts";

const url = "https://rabaed-dev-123.eu-central-1.elb.amazonaws.com";
const version = "4f2a9c1e";

type Route = { status: number; body?: unknown; location?: string };

// The health page and its stylesheet, shaped like a Next.js build's output:
// minified, with font URLs relative to the stylesheet.
const page = '<html><head><link rel="stylesheet" href="/_next/static/chunks/app.css" data-precedence="next"/></head><body>…</body></html>';

function css({ arabic = '"Thmanyah Sans", "IBM Plex Sans Arabic"', extraFace = "" } = {}) {
  return [
    "@font-face{font-family:Thmanyah Sans;font-style:normal;font-weight:400;font-display:swap;" +
      'src:url(../media/thmanyahsans-Regular.2ulg.woff2)format("woff2")}',
    "@font-face{font-family:IBM Plex Sans Arabic;font-style:normal;font-weight:400;" +
      'src:url(../media/ibm-plex-sans-arabic-400.0a8j.woff2)format("woff2")}',
    extraFace,
    `:root{--font-arabic:${arabic}}`,
  ].join("");
}

// A fake deployment: answers each URL as a healthy dev environment would,
// with `overrides` for the case under test.
function deployment(overrides: Record<string, Route> = {}): typeof fetch {
  const routes: Record<string, Route> = {
    "http://rabaed-dev-123.eu-central-1.elb.amazonaws.com/en/health": {
      status: 301,
      location: "https://rabaed-dev-123.eu-central-1.elb.amazonaws.com:443/en/health",
    },
    [`${url}/api/health`]: { status: 200, body: { status: "ok", version, api: { status: "ok", database: "ok", version } } },
    [`${url}/en/health`]: { status: 200, body: page },
    [`${url}/_next/static/chunks/app.css`]: { status: 200, body: css() },
    [`${url}/_next/static/media/thmanyahsans-Regular.2ulg.woff2`]: { status: 200, body: "wOF2…" },
    [`${url}/_next/static/media/ibm-plex-sans-arabic-400.0a8j.woff2`]: { status: 200, body: "wOF2…" },
    ...overrides,
  };
  return (async (input: string | URL) => {
    const route = routes[String(input)];
    if (!route) throw new TypeError(`fetch failed: ${input}`);
    const headers = new Headers(route.location ? { location: route.location } : {});
    const body = typeof route.body === "string" ? route.body : JSON.stringify(route.body ?? null);
    return new Response(route.status === 301 ? null : body, { status: route.status, headers });
  }) as typeof fetch;
}

describe("smoke test", () => {
  it("passes when the deployed version is up, on HTTPS, with its database", async () => {
    expect(await smokeTest({ url, version, fetch: deployment() })).toEqual([]);
  });

  it("fails when HTTP is served instead of redirected to HTTPS", async () => {
    const failures = await smokeTest({
      url,
      version,
      fetch: deployment({ "http://rabaed-dev-123.eu-central-1.elb.amazonaws.com/en/health": { status: 200, body: "<html/>" } }),
    });
    expect(failures).toEqual([expect.stringContaining("HTTP does not redirect to HTTPS")]);
  });

  it("fails when the database is unavailable", async () => {
    const failures = await smokeTest({
      url,
      version,
      fetch: deployment({
        [`${url}/api/health`]: { status: 200, body: { status: "ok", version, api: { status: "degraded", database: "unavailable", version } } },
      }),
    });
    expect(failures).toEqual([expect.stringContaining("database: unavailable")]);
  });

  it("fails when the api is unreachable", async () => {
    const failures = await smokeTest({
      url,
      version,
      fetch: deployment({ [`${url}/api/health`]: { status: 200, body: { status: "ok", version, api: null } } }),
    });
    expect(failures).toEqual([expect.stringContaining("api unreachable")]);
  });

  it("fails when web or the api runs another version than the one deployed", async () => {
    const failures = await smokeTest({
      url,
      version,
      fetch: deployment({
        [`${url}/api/health`]: { status: 200, body: { status: "ok", version: "0000000", api: { status: "ok", database: "ok", version: "1111111" } } },
      }),
    });
    expect(failures).toEqual([
      expect.stringContaining("web runs 0000000, expected 4f2a9c1e"),
      expect.stringContaining("api runs 1111111, expected 4f2a9c1e"),
    ]);
  });

  it("fails when the health page does not load", async () => {
    const failures = await smokeTest({ url, version, fetch: deployment({ [`${url}/en/health`]: { status: 502, body: "Bad Gateway" } }) });
    expect(failures).toEqual([expect.stringContaining("/en/health answered 502")]);
  });

  it("reports a request that fails outright instead of throwing", async () => {
    const failures = await smokeTest({ url: "https://nowhere.example", version, fetch: deployment() });
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.every((f) => f.includes("fetch failed"))).toBe(true);
  });
});

describe("smoke test: Arabic font", () => {
  it("passes when the expected Arabic font is served from our own origin", async () => {
    expect(await smokeTest({ url, version, arabicFont: "Thmanyah Sans", fetch: deployment() })).toEqual([]);
  });

  it("fails when Thmanyah was expected but the build fell back to IBM Plex Sans Arabic", async () => {
    const failures = await smokeTest({
      url,
      version,
      arabicFont: "Thmanyah Sans",
      fetch: deployment({ [`${url}/_next/static/chunks/app.css`]: { status: 200, body: css({ arabic: '"IBM Plex Sans Arabic"' }) } }),
    });
    expect(failures).toEqual([expect.stringContaining("Arabic is in IBM Plex Sans Arabic, expected Thmanyah Sans")]);
  });

  it("accepts the fallback when no font is expected, and fetches its file", async () => {
    const fetch = deployment({ [`${url}/_next/static/chunks/app.css`]: { status: 200, body: css({ arabic: '"IBM Plex Sans Arabic"' }) } });
    expect(await smokeTest({ url, version, fetch })).toEqual([]);
  });

  it("fails when the Arabic font file does not load", async () => {
    const failures = await smokeTest({
      url,
      version,
      fetch: deployment({ [`${url}/_next/static/media/thmanyahsans-Regular.2ulg.woff2`]: { status: 404, body: "Not Found" } }),
    });
    expect(failures).toEqual([expect.stringMatching(/thmanyahsans-Regular.*answered 404/)]);
  });

  it("fails when a font comes from anywhere but our own origin (no font CDN)", async () => {
    const cdn = "@font-face{font-family:Other;src:url(https://fonts.gstatic.com/s/other.woff2)format(\"woff2\")}";
    const failures = await smokeTest({
      url,
      version,
      fetch: deployment({ [`${url}/_next/static/chunks/app.css`]: { status: 200, body: css({ extraFace: cdn }) } }),
    });
    expect(failures).toEqual([expect.stringContaining("font from another origin: https://fonts.gstatic.com/s/other.woff2")]);
  });

  it("fails when the page sets no Arabic font", async () => {
    const failures = await smokeTest({ url, version, fetch: deployment({ [`${url}/_next/static/chunks/app.css`]: { status: 200, body: "body{margin:0}" } }) });
    expect(failures).toEqual([expect.stringContaining("no --font-arabic")]);
  });
});

// The deploy's visibility check (RP-213), through web's /api/v1 proxy as a
// browser would: a Member of Riyadh Gate Tower (Hafiz) and one of Jeddah
// Corniche Villas (Nasser) get 404 on each other's Project and Work Items.
describe("visibility check", () => {
  const password = "demo-password-from-secrets-manager";
  const people = { hafiz: VISIBILITY_CHECK_PEOPLE.twr, nasser: VISIBILITY_CHECK_PEOPLE.jcv };
  const twr = "0190a000-0000-7000-8000-000000000001";
  const jcv = "0190a000-0000-7000-8000-000000000002";
  const twrItem = "0190a000-0000-7000-8000-00000000000a";
  const jcvItem = "0190a000-0000-7000-8000-00000000000b";

  type Who = keyof typeof people;
  /** What each person may read, as the api answers it; `leak` lets a case break one rule. */
  function api({ leak, badPassword = false, twrItems = [twrItem] }: { leak?: { who: Who; path: string }; badPassword?: boolean; twrItems?: string[] } = {}) {
    const own: Record<Who, { project: string; code: string; items: string[] }> = {
      hafiz: { project: twr, code: "TWR", items: twrItems },
      nasser: { project: jcv, code: "JCV", items: [jcvItem] },
    };
    const signedOut: Who[] = [];
    const fetcher = (async (input: string | URL, init: RequestInit = {}) => {
      const path = new URL(String(input)).pathname;
      const method = init.method ?? "GET";
      const json = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
        new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
      if (path === "/api/v1/session" && method === "POST") {
        const { email, password: given } = JSON.parse(String(init.body));
        const who = (Object.keys(people) as Who[]).find((w) => people[w] === email);
        if (!who || given !== password || badPassword) return json(401, { error: "invalid_credentials" });
        return json(204, undefined, { "set-cookie": `rabaed_session=token-${who}; Path=/; HttpOnly; Secure` });
      }
      const cookie = new Headers(init.headers).get("cookie") ?? "";
      const who = (Object.keys(people) as Who[]).find((w) => cookie.includes(`rabaed_session=token-${w}`));
      if (!who) return json(401, { error: "not_signed_in" });
      if (path === "/api/v1/session" && method === "DELETE") {
        signedOut.push(who);
        return json(204);
      }
      const mine = own[who];
      const allowed = (p: string) => (leak?.who === who && leak.path === p) || p === `/api/v1/projects/${mine.project}` || p === `/api/v1/projects/${mine.project}/work-items` || mine.items.some((i) => p === `/api/v1/work-items/${i}`);
      if (path === "/api/v1/projects") {
        const projects = [{ id: mine.project, code: mine.code }];
        if (leak?.who === who && leak.path === "/api/v1/projects") projects.push(who === "hafiz" ? { id: jcv, code: "JCV" } : { id: twr, code: "TWR" });
        return json(200, { projects });
      }
      if (!allowed(path)) return json(404, { error: "not_found" });
      if (path.endsWith("/work-items")) return json(200, { stages: [], items: (path.includes(twr) ? own.hafiz : own.nasser).items.map((id) => ({ id })) });
      return json(200, {});
    }) as typeof fetch;
    return { fetcher, signedOut };
  }

  it("passes when each gets 404 on the other's Project and Work Items, and signs both out", async () => {
    const { fetcher, signedOut } = api();
    expect(await visibilityCheck({ url, password, fetch: fetcher })).toEqual([]);
    expect(signedOut.sort()).toEqual(["hafiz", "nasser"]);
  });

  it.each([
    ["hafiz", `/api/v1/projects/${jcv}`],
    ["hafiz", `/api/v1/projects/${jcv}/work-items`],
    ["hafiz", `/api/v1/work-items/${jcvItem}`],
    ["nasser", `/api/v1/projects/${twr}`],
    ["nasser", `/api/v1/projects/${twr}/work-items`],
    ["nasser", `/api/v1/work-items/${twrItem}`],
  ] as const)("fails when %s can read %s", async (who, path) => {
    const failures = await visibilityCheck({ url, password, fetch: api({ leak: { who, path } }).fetcher });
    expect(failures).toEqual([expect.stringContaining(`${path} answered 200, expected 404`)]);
  });

  it("fails when the other Project is listed", async () => {
    const failures = await visibilityCheck({ url, password, fetch: api({ leak: { who: "hafiz", path: "/api/v1/projects" } }).fetcher });
    expect(failures).toContainEqual(expect.stringContaining("hafiz.hamdan@tmc.demo.rabaed.test lists JCV"));
  });

  it("fails when a demo person cannot sign in (the demo is not seeded)", async () => {
    const failures = await visibilityCheck({ url, password, fetch: api({ badPassword: true }).fetcher });
    expect(failures).toEqual([expect.stringContaining("sign-in as hafiz.hamdan@tmc.demo.rabaed.test answered 401")]);
  });

  it("fails when a Project has no Work Item to check (the demo seeds one in each)", async () => {
    const failures = await visibilityCheck({ url, password, fetch: api({ twrItems: [] }).fetcher });
    expect(failures).toEqual([expect.stringContaining("Riyadh Gate Tower has no Work Item to check")]);
  });

  it("reports what it found even when signing out fails", async () => {
    const { fetcher } = api({ leak: { who: "hafiz", path: `/api/v1/projects/${jcv}` } });
    const failing = (async (input: string | URL, init: RequestInit = {}) => {
      if (init.method === "DELETE") throw new TypeError("fetch failed");
      return fetcher(input, init);
    }) as typeof fetch;
    const failures = await visibilityCheck({ url, password, fetch: failing });
    expect(failures).toEqual([expect.stringContaining(`/api/v1/projects/${jcv} answered 200, expected 404`)]);
  });
});
