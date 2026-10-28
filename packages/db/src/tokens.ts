import { createHash, randomBytes } from "node:crypto";

// The one-time token mechanism of invitations, sessions and password reset links. It lives here
// so the worker's outbox handlers can mint one (the password reset link, RP-1058); @rabaed/auth
// re-exports it for the api and Rabaed Admin.

/** A random bearer token for a cookie or link. Only its hash is ever stored. */
export function newToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}
