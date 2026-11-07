import "server-only";
import { recordVerification, type RecordVerification } from "@rabaed/domain";
import { headers } from "next/headers";
import { apiUrl } from "./api-url.ts";
import { visitorForwardHeaders, visitorForwardSecretFromEnv } from "./visitor-forward.ts";

// The public verification page's reads (RP-157), from the web server: no session cookie is sent,
// none is needed. The visitor goes on with them, so the api limits typed codes per visitor, not per
// web server: web's own X-Forwarded-For, and on Vercel, where the api sees web's egress address, the
// visitor named with VISITOR_FORWARD_SECRET (RP-1230, visitor-forward.ts).

export type VerificationAnswer = { kind: "found"; verification: RecordVerification } | { kind: "not_found" } | { kind: "too_many_attempts" } | { kind: "unavailable" };

async function verify(path: "link" | "code", body: Record<string, string>): Promise<VerificationAnswer> {
  const visitor = visitorForwardHeaders((await headers()).get("x-forwarded-for"), visitorForwardSecretFromEnv());
  try {
    const res = await fetch(`${apiUrl}/v1/verification/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...visitor },
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
