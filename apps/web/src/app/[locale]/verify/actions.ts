"use server";

import type { RecordVerification } from "@rabaed/domain";
import { verifyByCode } from "@/lib/verification";

/** What the last typed Verification Code found, with what was typed (shown again in the form). */
export type CodeCheck = { code: string; documentNumber: string } & (
  | { kind: "idle" }
  | { kind: "found"; verification: RecordVerification }
  | { kind: "not_found" }
  | { kind: "too_many_attempts" }
  | { kind: "unavailable" }
);

/**
 * The public verification page's code form (RP-157): run on the web server, which forwards the
 * visitor's address so the api limits attempts per visitor. Nothing is kept, no cookie is set.
 */
export async function checkVerificationCode(_previous: CodeCheck, form: FormData): Promise<CodeCheck> {
  const code = String(form.get("code") ?? "").slice(0, 64);
  const documentNumber = String(form.get("documentNumber") ?? "").slice(0, 200);
  return { ...(await verifyByCode(code, documentNumber)), code, documentNumber };
}
