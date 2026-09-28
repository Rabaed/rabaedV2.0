import type { NextRequest } from "next/server";
import { apiUrl } from "@/lib/api-url";

// Forwards the browser's /api/v1/* calls to the API, so the session cookie is
// first-party (HttpOnly, SameSite=Lax) and no CORS is needed. Resolved per
// request, so API_URL is read at runtime, not baked in at build. Only the
// Member API (/v1) is exposed here; Rabaed Admin is not reachable from this origin.
async function forward(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const target = new URL(`/v1/${path.map(encodeURIComponent).join("/")}`, apiUrl);
  target.search = request.nextUrl.search;

  const headers = new Headers();
  for (const name of ["cookie", "content-type", "accept"]) {
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
  const contentType = upstream.headers.get("content-type");
  if (contentType) response.set("content-type", contentType);
  for (const cookie of upstream.headers.getSetCookie()) response.append("set-cookie", cookie);
  const body = upstream.status === 204 ? null : await upstream.arrayBuffer();
  return new Response(body, { status: upstream.status, headers: response });
}

export { forward as DELETE, forward as GET, forward as PATCH, forward as POST, forward as PUT };
