import { createHash, randomBytes } from "node:crypto";

/** A random bearer token for a cookie or link. Only its hash is ever stored. */
export function newToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}
