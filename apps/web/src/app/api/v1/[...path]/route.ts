import type { NextRequest } from "next/server";
import { memberApiTarget } from "../../../../lib/api-url.ts";
import { stripVisitorHeaders, visitorForwardHeaders, visitorForwardSecretFromEnv } from "../../../../lib/visitor-forward.ts";

// Forwards the browser's /api/v1/* calls to the API, so the session cookie is
// first-party (HttpOnly, SameSite=Lax) and no CORS is needed. Resolved per
// request, so API_URL is read at runtime, not baked in at build. Only the
// Member API (/v1) is exposed here; Rabaed Admin is not reachable from this origin.
async function forward(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const target = memberApiTarget(path, request.nextUrl.search);
  if (!target) return Response.json({ error: "not_found" }, { status: 404 });

  const headers = new Headers();
  for (const name of ["cookie", "content-type", "accept"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // The visitor: the API limits some public routes per visitor (password reset requests, RP-1058). On
  // Vercel the API sees web's egress address, so web names the visitor with VISITOR_FORWARD_SECRET
  // (RP-1230, lib/visitor-forward.ts). Only web names one: a browser's own x-rabaed-visitor* never passes.
  stripVisitorHeaders(headers);
  for (const [name, value] of Object.entries(visitorForwardHeaders(request.headers.get("x-forwarded-for"), visitorForwardSecretFromEnv()))) headers.set(name, value);
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
