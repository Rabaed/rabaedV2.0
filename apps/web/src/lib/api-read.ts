/**
 * A server-side read of the api, and what it came to (RP-1049). Only the api's own 4xx is
 * `absent`: a hidden page and a missing one read the same (docs/visibility.md, Direct URL row).
 * A read that is slow, can't reach the api or gets a 5xx is `failed`, and is logged, so it
 * never looks hidden to the Member nor quiet to support.
 */
export type ApiRead<T> = { kind: "ok"; value: T } | { kind: "absent" } | { kind: "failed" };

/**
 * How long a read may take. The work item query and Home read every item the Member sees, which
 * on a real Project (858 items in UAT Round 0) is far more than the 3 s a small read gets;
 * 30 s until RP-1050 makes them fast. The time limit only stops a hung api holding a page.
 */
export const readTimeouts = { small: 3_000, wide: 30_000 } as const;

type Deps = { fetch: (url: string, init: RequestInit) => Promise<Response>; log: (line: string) => void };

const defaultDeps: Deps = { fetch: (url, init) => fetch(url, init), log: (line) => console.error(line) };

/** GETs `url` with the session cookie, giving up after `timeoutMs`. */
export async function readApiJson<T>(url: string, { cookie, timeoutMs }: { cookie: string; timeoutMs: number }, deps: Deps = defaultDeps): Promise<ApiRead<T>> {
  // The path only: the query string holds what the Member typed into a filter.
  const failed = (why: string): ApiRead<T> => {
    deps.log(`api read GET ${new URL(url).pathname} failed: ${why}`);
    return { kind: "failed" };
  };
  try {
    const res = await deps.fetch(url, { headers: { cookie }, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    if (res.status >= 400 && res.status < 500) return { kind: "absent" };
    if (!res.ok) return failed(`status ${res.status}`);
    return { kind: "ok", value: (await res.json()) as T };
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") return failed(`no answer within ${timeoutMs} ms`);
    return failed(error instanceof Error ? error.message : "unknown error");
  }
}

/** The body of a read that answered; null if it didn't, or wasn't made. */
export function valueOf<T>(read: ApiRead<T> | null): T | null {
  return read?.kind === "ok" ? read.value : null;
}

/**
 * What a page shows from its reads: the Project's (which decides visibility) and the others it
 * needs (null when not made). A hidden Project is not found whatever else failed; otherwise any
 * failed read is an error with Try again, never the not-found page.
 */
export function pageOutcome(project: ApiRead<unknown>, needed: readonly (ApiRead<unknown> | null)[]): "show" | "not-found" | "failed" {
  if (project.kind === "absent") return "not-found";
  const reads = [project, ...needed];
  if (reads.some((r) => r?.kind === "failed")) return "failed";
  if (reads.some((r) => r?.kind === "absent")) return "not-found";
  return "show";
}
