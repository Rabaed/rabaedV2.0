import type { NextRequest } from "next/server";
import { memberApiTarget } from "../../../../lib/api-url.ts";

// Forwards the browser's /api/v1/* calls to the API, so the session cookie is
// first-party (HttpOnly, SameSite=Lax) and no CORS is needed. Resolved per
// request, so API_URL is read at runtime, not baked in at build. Only the
// Member API (/v1) is exposed here; Rabaed Admin is not reachable from this origin.
async function forward(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const target = memberApiTarget(path, request.nextUrl.search);
  if (!target) return Response.json({ error: "not_found" }, { status: 404 });

  const headers = new Headers();
  // X-Forwarded-For: the API limits some public routes per visitor (password reset requests, RP-1058),
  // reading the last entry, the one the load balancer appended (apps/api/src/visitor.ts).
  for (const name of ["cookie", "content-type", "accept", "x-forwarded-for"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: "manual",
    cache: "no-store",
  });

  const response = new Headers();
  // A file the API sends itself (a linked item's record, RP-1087) keeps its name and caching.
  for (const name of ["content-type", "content-disposition", "cache-control"]) {
    const value = upstream.headers.get(name);
    if (value) response.set(name, value);
  }
  for (const cookie of upstream.headers.getSetCookie()) response.append("set-cookie", cookie);
  // Streamed, so a large PDF isn't held in memory here.
  const body = upstream.status === 204 ? null : upstream.body;
  return new Response(body, { status: upstream.status, headers: response });
}

export { forward as DELETE, forward as GET, forward as PATCH, forward as POST, forward as PUT };
