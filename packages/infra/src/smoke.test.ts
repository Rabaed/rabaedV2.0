import { describe, expect, it } from "vitest";
import { smokeTest } from "./smoke.ts";

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
