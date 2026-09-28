import "server-only";
import { appVersion, healthResponse, type HealthResponse } from "@rabaed/domain";
import { apiUrl } from "@/lib/api-url";

/** The commit this web server was deployed from; `local` in development. Read at runtime, not build. */
export function webVersion(): string {
  return appVersion.catch("local").parse(process.env.APP_VERSION);
}

/** What the api's /health reports right now, or null if it can't be reached. */
export async function fetchApiHealth(): Promise<HealthResponse | null> {
  try {
    const res = await fetch(`${apiUrl}/health`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    return healthResponse.parse(await res.json());
  } catch {
    return null;
  }
}
