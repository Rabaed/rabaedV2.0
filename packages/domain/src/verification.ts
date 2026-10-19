import { z } from "zod";
import { bilingualText } from "./company.ts";

// The public verification page of a Documental Record (RP-157; ADR 0023; visibility.md, the
// Verification page row; workflow-engine.md §7). Anyone holding a record opens it without
// signing in: by the long link its QR prints, or by typing its Verification Code with its
// Document Number. It shows no more than the record's first page already does.

/** The QR's long link: `<web>/verify/<token>`, the token 32 random bytes in base64url. */
export const verificationToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** The record's QR link, as the page sends it. Any other token reads as a record that doesn't exist. */
export const verifyByLinkRequest = z.object({ token: z.string().max(200) });
export type VerifyByLinkRequest = z.infer<typeof verifyByLinkRequest>;

/**
 * The short code printed on every page, with the record's Document Number. Either may be left
 * out or wrong: the answer is then the one a record that doesn't exist gets, never a 400.
 */
export const verifyByCodeRequest = z.object({
  code: z.string().max(64).default(""),
  documentNumber: z.string().max(200).default(""),
});
export type VerifyByCodeRequest = z.input<typeof verifyByCodeRequest>;

/** Crockford's base 32, as the record job writes the code. */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A typed Verification Code as the record prints it (`XXXX-XXXX`), or null when it can't be
 * one: case, spaces and the dash don't matter, and I and L read as 1, O as 0 (Crockford).
 */
export function normalVerificationCode(typed: string): string | null {
  const chars = typed
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  if (chars.length !== 8 || [...chars].some((c) => !CODE_ALPHABET.includes(c))) return null;
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * What the page shows, exactly (visibility.md, the Verification page row): genuine, or replaced
 * by a corrected copy (Re-produce) on a date; the Document Number, Subject, Project, outcome and
 * sealed date; each signer's name, Positions and Company as the record printed them; and the
 * fingerprints a dropped copy is compared with in the browser: the current PDF's, and each
 * replaced one's with the date it was replaced. Never the Documents, the Form answers or the
 * live item.
 */
export const recordVerification = z.object({
  status: z.enum(["genuine", "replaced"]),
  /** When the latest corrected copy replaced the one before; null while genuine. */
  replacedAt: z.iso.datetime().nullable(),
  /** Null only for an item Cancelled before it was ever numbered. */
  documentNumber: z.string().nullable(),
  subject: z.string(),
  project: bilingualText,
  outcome: z.object({ code: z.string(), name: bilingualText }),
  sealedAt: z.iso.datetime(),
  signers: z.array(z.object({ name: bilingualText, positions: z.array(bilingualText), company: bilingualText })),
  fingerprints: z.object({
    current: sha256Hex,
    replaced: z.array(z.object({ sha256: sha256Hex, replacedAt: z.iso.datetime() })),
  }),
});
export type RecordVerification = z.infer<typeof recordVerification>;

/** What a dropped copy is, by its SHA-256: the record as issued now, a copy a corrected one replaced, or neither. */
export type CopyMatch = { kind: "original" } | { kind: "replaced"; replacedAt: string } | { kind: "different" };

/** Compares a dropped copy's fingerprint (hex, any case) with the record's: the browser's check, nothing uploaded. */
export function copyMatch(sha256: string, fingerprints: RecordVerification["fingerprints"]): CopyMatch {
  const hex = sha256.toLowerCase();
  if (hex === fingerprints.current) return { kind: "original" };
  const old = fingerprints.replaced.find((r) => r.sha256 === hex);
  return old ? { kind: "replaced", replacedAt: old.replacedAt } : { kind: "different" };
}

/** How many typed codes a visitor may try in a window (the api's limit, the page's message). */
export const VERIFICATION_ATTEMPTS = { perVisitor: 10, windowMinutes: 15 } as const;
