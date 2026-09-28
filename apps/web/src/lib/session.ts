import "server-only";
import type { BilingualText } from "@rabaed/domain";
import { cookies } from "next/headers";
import { apiUrl } from "./api-url.ts";

export interface Me {
  member: { id: string; email: string; fullName: BilingualText; isAuthorizedPerson: boolean };
  company: { id: string; legalName: BilingualText };
}

/** The signed-in Member, read from the API with the browser's session cookie; null if signed out. */
export async function getMe(): Promise<Me | null> {
  const cookie = (await cookies()).toString();
  if (!cookie) return null;
  try {
    const res = await fetch(`${apiUrl}/v1/me`, {
      headers: { cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? ((await res.json()) as Me) : null;
  } catch {
    return null;
  }
}
