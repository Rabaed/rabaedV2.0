import type { WebHealthResponse } from "@rabaed/domain";
import { fetchApiHealth, webVersion } from "@/lib/health";

// The load balancer's health check and the post-deploy smoke test. Answers 200
// whenever web itself is up, so an api outage does not take web out of the
// load balancer; the body says how the api and database are.
export const dynamic = "force-dynamic";

export async function GET() {
  const body: WebHealthResponse = { status: "ok", version: webVersion(), api: await fetchApiHealth() };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
