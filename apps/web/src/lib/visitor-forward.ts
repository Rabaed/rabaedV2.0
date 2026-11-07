import { readVisitorForwardSecret, VISITOR_HEADER, VISITOR_KEY_HEADER } from "@rabaed/domain";

// RP-1230: when web calls the api on Vercel, Vercel overwrites X-Forwarded-For with web's egress
// address, the same for every visitor, so the api's per-visitor limits (typed Verification Codes,
// RP-157; password-reset requests, RP-1058) would count all visitors as one. Web names the visitor
// in `x-rabaed-visitor`, with VISITOR_FORWARD_SECRET in `x-rabaed-visitor-key`, and the api believes
// it only with that key (apps/api/src/visitor.ts).

/**
 * VISITOR_FORWARD_SECRET, or undefined when unset or empty (web then sends only X-Forwarded-For, as
 * before). Shorter than 32 characters, it throws: instrumentation.ts reads it at start-up, so web
 * does not start with a guessable key. Read each call, so a test can set it.
 */
export function visitorForwardSecretFromEnv(source: Record<string, string | undefined> = process.env): string | undefined {
  return readVisitorForwardSecret(source);
}

/**
 * What web sends the api about the visitor, from web's own incoming X-Forwarded-For (on Vercel,
 * the browser's address, which the browser cannot set): that header as before, and with a secret
 * its last entry as the named visitor, with the key. Nothing without an X-Forwarded-For.
 */
export function visitorForwardHeaders(forwardedFor: string | null, secret: string | undefined): Record<string, string> {
  const visitor = forwardedFor
    ?.split(",")
    .map((a) => a.trim())
    .filter((a) => a !== "")
    .at(-1);
  if (!forwardedFor || !visitor) return {};
  return { "x-forwarded-for": forwardedFor, ...(secret ? { [VISITOR_HEADER]: visitor, [VISITOR_KEY_HEADER]: secret } : {}) };
}

/** Takes off every `x-rabaed-visitor*` header, so only web, never a browser, names a visitor. */
export function stripVisitorHeaders(headers: Headers): void {
  for (const name of [...headers.keys()]) if (name.startsWith(VISITOR_HEADER)) headers.delete(name);
}
