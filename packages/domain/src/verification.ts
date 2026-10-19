import { z } from "zod";
import type { Locale } from "./locale.ts";

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
 * out, wrong or too long: the api answers any body this refuses as a record that doesn't exist,
 * never a 400.
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
export function parseVerificationCode(typed: string): string | null {
  const chars = typed
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  if (chars.length !== 8 || [...chars].some((c) => !CODE_ALPHABET.includes(c))) return null;
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

/** Text as the record printed it: only in the language(s) it printed (both, or Arabic or English alone). */
export const printedText = z
  .object({ ar: z.string().min(1).optional(), en: z.string().min(1).optional() })
  .refine((t) => t.ar !== undefined || t.en !== undefined, "at least one language");
export type PrintedText = z.infer<typeof printedText>;

/** The text in `locale` when the record printed it, else in the language it printed. */
export const printedIn = (text: PrintedText, locale: Locale): string => text[locale] ?? text.ar ?? text.en ?? "";

const printedFace = {
  /** Null only for an item Cancelled before it was ever numbered. */
  documentNumber: z.string().nullable(),
  subject: z.string(),
  project: printedText,
  /** `code`: the short code (A, B, C, D) the record prints; null for an outcome it prints by its name only. */
  outcome: z.object({ code: z.string().nullable(), name: printedText }),
  /** Everyone on the record's path to its outcome, in its order. */
  signers: z.array(z.object({ name: printedText, positions: z.array(printedText), company: printedText })),
};

/**
 * A record's printed face, as the worker takes it from the Record Data it printed and keeps it for
 * this page (documental_record_face): with the language(s) the record printed.
 */
export const recordFace = z.object({ language: z.enum(["bilingual", "ar", "en"]), ...printedFace });
export type RecordFace = z.infer<typeof recordFace>;

const shown = {
  ...printedFace,
  sealedAt: z.iso.datetime(),
  fingerprints: z.object({
    current: sha256Hex,
    replaced: z.array(z.object({ sha256: sha256Hex, replacedAt: z.iso.datetime() })),
  }),
};

/**
 * What the page shows, exactly (visibility.md, the Verification page row): genuine, or replaced
 * by a corrected copy (Re-produce) on a date; the Document Number, Subject, Project, outcome and
 * sealed date; each signer's name, Positions and Company; all as the record printed them, in the
 * language(s) it printed; and the fingerprints a dropped copy is compared with in the browser: the
 * current PDF's, and each replaced one's with the date it was replaced. Never the Documents, the
 * Form answers or the live item.
 */
export const recordVerification = z.discriminatedUnion("status", [
  z.object({ status: z.literal("genuine"), ...shown }),
  /** `replacedAt`: when the latest corrected copy replaced the one before. */
  z.object({ status: z.literal("replaced"), replacedAt: z.iso.datetime(), ...shown }),
]);
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
