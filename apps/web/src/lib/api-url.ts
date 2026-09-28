/** Where the web server reaches the API. The browser reaches it through `/api/v1` (see src/app/api/v1/[...path]/route.ts). */
export const apiUrl = process.env.API_URL ?? "http://127.0.0.1:4000";

/**
 * Where the /api/v1 proxy forwards a request: the same path under the API's
 * `/v1`, or null for a path that would leave it (a `.` or `..` segment), so
 * nothing outside the Member API (Rabaed Admin included) is reachable through web.
 */
export function memberApiTarget(path: string[], search: string, base: string = apiUrl): URL | null {
  if (path.some((segment) => segment === "." || segment === "..")) return null;
  const target = new URL(`/v1/${path.map(encodeURIComponent).join("/")}`, base);
  if (!target.pathname.startsWith("/v1/")) return null;
  target.search = search;
  return target;
}
