import "server-only";
import { recordVerification, type RecordVerification } from "@rabaed/domain";
import { headers } from "next/headers";
import { apiUrl } from "@/lib/api-url";

// The public verification page's reads (RP-157), from the web server: no session cookie is sent,
// none is needed. The visitor's address goes on as the load balancer gave it (X-Forwarded-For), so
// the api limits typed codes per visitor, not per web server. Only this page's calls carry it; the
// browser's /api/v1 proxy is unchanged.

export type VerificationAnswer = { kind: "found"; verification: RecordVerification } | { kind: "not_found" } | { kind: "too_many_attempts" } | { kind: "unavailable" };

async function verify(path: "link" | "code", body: Record<string, string>): Promise<VerificationAnswer> {
  const forwarded = (await headers()).get("x-forwarded-for");
  try {
    const res = await fetch(`${apiUrl}/v1/verification/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(forwarded ? { "x-forwarded-for": forwarded } : {}) },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (res.status === 200) {
      const parsed = recordVerification.safeParse(await res.json());
      return parsed.success ? { kind: "found", verification: parsed.data } : { kind: "unavailable" };
    }
    if (res.status === 404) return { kind: "not_found" };
    if (res.status === 429) return { kind: "too_many_attempts" };
    return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

/** The record the QR's link opens. */
export const verifyByLink = (token: string) => verify("link", { token });

/** The record a typed Verification Code with its Document Number opens. */
export const verifyByCode = (code: string, documentNumber: string) => verify("code", { code, documentNumber });
