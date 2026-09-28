import "server-only";
import type { CompanyMembers, SignedInMember } from "@rabaed/domain";
import { cookies } from "next/headers";
import { apiUrl } from "./api-url.ts";

/** GETs an API path with the browser's session cookie; null if signed out or it fails. */
async function apiGet<T>(path: string): Promise<T | null> {
  const cookie = (await cookies()).toString();
  if (!cookie) return null;
  try {
    const res = await fetch(`${apiUrl}${path}`, {
      headers: { cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** The signed-in Member, read from the API with the browser's session cookie; null if signed out. */
export function getMe(): Promise<SignedInMember | null> {
  return apiGet<SignedInMember>("/v1/me");
}

/** The signed-in Member's Company's Members; null if signed out. */
export function getMembers(): Promise<CompanyMembers | null> {
  return apiGet<CompanyMembers>("/v1/members");
}
