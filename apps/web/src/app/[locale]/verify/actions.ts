"use server";

import { verifyByCodeRequest } from "@rabaed/domain";
import { verifyByCode, type VerificationAnswer } from "@/lib/verification";

/** What the last typed Verification Code found; `idle` before the first. */
export type CodeCheck = VerificationAnswer | { kind: "idle" };

/**
 * The public verification page's code form (RP-157): run on the web server, which forwards the
 * visitor's address so the api limits attempts per visitor. Nothing is kept, no cookie is set. What
 * the api's own request schema refuses (too long) is a record that doesn't exist, as there.
 */
export async function checkVerificationCode(_previous: CodeCheck, form: FormData): Promise<CodeCheck> {
  const typed = verifyByCodeRequest.safeParse({ code: form.get("code") ?? "", documentNumber: form.get("documentNumber") ?? "" });
  if (!typed.success) return { kind: "not_found" };
  return verifyByCode(typed.data.code, typed.data.documentNumber);
}
