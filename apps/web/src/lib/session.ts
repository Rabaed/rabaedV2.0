import "server-only";
import type { SignedInMember } from "@rabaed/domain";
import { cookies } from "next/headers";
import { apiUrl } from "./api-url.ts";

/** The signed-in Member, read from the API with the browser's session cookie; null if signed out. */
export async function getMe(): Promise<SignedInMember | null> {
  const cookie = (await cookies()).toString();
  if (!cookie) return null;
  try {
    const res = await fetch(`${apiUrl}/v1/me`, {
      headers: { cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? ((await res.json()) as SignedInMember) : null;
  } catch {
    return null;
  }
}
