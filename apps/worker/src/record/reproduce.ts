import { documentalRecordReproductionSource, reproduceDocumentalRecord, saveDocumentalRecordFace, type OutboxHandler, type ReproductionSource } from "@rabaed/db";
import { appendixFrom } from "./appendix.ts";
import { IMAGE_TYPES, inlinePhotos, type PhotoCandidate } from "./assets.ts";
import { recordFace } from "./face.ts";
import { checkRecord, environmentValidator, expectationOf } from "./checks.ts";
import type { RecordFiles } from "./files.ts";
import type { RecordJobDeps } from "./job.ts";
import { makeRecordPdf } from "./make-pdf.ts";
import { photoFingerprints, recordPhotos } from "./photo-fingerprints.ts";
import { sha256 } from "./pki.ts";
import { parseRecord } from "./record-data-read.ts";
import { LAYOUT_VERSION, RECORD_DATA_NAMESPACE, recordDataFacts } from "./record-data.ts";
import type { RecordText } from "./record-text.ts";

// Re-produce (RP-155; ADR 0023; workflow-engine.md §7): when the PDF maker had a bug, a Rabaed
// Engineer re-produces a record in Rabaed Admin, which queues an outbox row of kind
// 'documental_record_reproduce' (apps/admin, logged in admin_action with a reason). This
// handler remakes the PDF from the stored Record Data alone, with a new seal date, checks it
// as any new record is, and replaces the old one at the same storage key, so its name and
// download link stay. The replaced PDF is kept under `replaced/` next to it, with its
// fingerprint in documental_record_reproduction (admin-only). The verification token and
// code, printed in the Record Data, are kept as they are. A new PDF that fails its checks
// replaces nothing. The item and its Transitions are never read or changed.
//
// The Record Data holds the fingerprint of each image the pages print; a Form photo comes from
// the item's Documents with that very fingerprint, a logo, Signature or Stamp from the files the
// record was made with (source.marks), and the appendix's files from the Documents too
// (appendix.ts, appendixFrom). One the store no longer holds (or holds changed) fails the
// Re-produce, rather than being left out of a poorer PDF that would replace the good one. The PDF
// is made by make-pdf.ts, as at closure. Its Record Data must hold the same facts as the stored
// one: only the layout's values (record-data.ts, LAYOUT_DERIVED: the pages things land on) may
// move, and the new PDF carries the remade Record Data with them; the stored Record Data file is
// not changed. A record whose Record Data is of an earlier version gets a failed verdict saying so.

/** A name as a Rabaed Engineer reads it: English where the record has it. */
const nameOf = (t: RecordText) => t.en ?? t.ar ?? "";

const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

/** Where the PDF with fingerprint `sha256` (hex) is kept once a Re-produce has replaced it. */
export function replacedRecordKey(pdfKey: string, sha256: string): string {
  return pdfKey.replace(/[^/]+$/, `replaced/${sha256}.pdf`);
}

type Candidate = PhotoCandidate & { readonly sha256: string | null };

/**
 * The files whose fingerprints are `wanted` (hex SHA-256), with their images: among the item's
 * `documents` (Form photos), then among the `marks` (Signatures, logos, Stamps). Each set is
 * inlined within its own budget, as the record job inlines them (assets.ts), so what printed at
 * close prints again. A Document confirmed before its fingerprint was kept (null) is hashed from
 * its bytes. Each fingerprint is checked against the bytes in storage, so a file changed there
 * does not match.
 */
export async function findPhotos(
  wanted: ReadonlySet<string>,
  documents: readonly Candidate[],
  files: RecordFiles,
  marks: readonly Candidate[] = [],
): Promise<{ keys: Map<string, string>; images: Map<string, string> }> {
  const photos = await findAmong(wanted, documents, files);
  const marked = await findAmong(new Set([...wanted].filter((sha) => !photos.keys.has(sha))), marks, files);
  return { keys: new Map([...photos.keys, ...marked.keys]), images: new Map([...photos.images, ...marked.images]) };
}

async function findAmong(wanted: ReadonlySet<string>, candidates: readonly Candidate[], files: RecordFiles): Promise<{ keys: Map<string, string>; images: Map<string, string> }> {
  const keys = new Map<string, string>();
  if (wanted.size === 0) return { keys, images: new Map() };
  for (const d of candidates) if (d.sha256 && wanted.has(d.sha256) && !keys.has(d.sha256)) keys.set(d.sha256, d.storageKey);
  if ([...wanted].some((sha) => !keys.has(sha))) {
    const unhashed = candidates.filter((d) => d.sha256 === null && IMAGE_TYPES.has(d.contentType));
    for (const [storageKey, sha] of (await inlinePhotos(unhashed, files)).fingerprints) if (wanted.has(sha) && !keys.has(sha)) keys.set(sha, storageKey);
  }
  const byKey = new Map(candidates.map((d) => [d.storageKey, d]));
  const { images, fingerprints } = await inlinePhotos([...keys.values()].flatMap((k) => byKey.get(k) ?? []), files);
  // What is in storage now must be what the record printed.
  for (const [sha, storageKey] of keys) if (fingerprints.get(storageKey) !== sha) keys.delete(sha);
  return { keys, images };
}

/** Why a stored Record Data can't be read back by this version, or null when it can. */
export function unreadableVersion(xml: string): string | null {
  const root = /<recordData\b[^>]*>/.exec(xml)?.[0] ?? "";
  if (root.includes(`xmlns="${RECORD_DATA_NAMESPACE}"`)) return null;
  const version = /layoutVersion="([^"]*)"/.exec(root)?.[1] ?? "unknown";
  return `the record was made with Record Data version ${version}, and a Re-produce reads only version ${LAYOUT_VERSION}: it cannot be re-produced`;
}

export function reproduceHandler(deps: RecordJobDeps): OutboxHandler {
  const now = deps.now ?? (() => new Date());
  return async (trx, row) => {
    const source = await documentalRecordReproductionSource(trx, row.id);
    if (!source) return;
    const stored = await deps.files.get(source.recordDataKey);
    if (!stored) throw new Error("the Record Data is missing from storage");
    const xml = new TextDecoder().decode(stored);
    // A record made with an earlier version's Record Data (dev and UAT only) is not read back: it says so.
    const unreadable = unreadableVersion(xml);
    if (unreadable) {
      await reproduceDocumentalRecord(trx, row.id, { verdict: { passed: false, problems: [unreadable] } });
      return;
    }

    // Every image the page printed (Form photos, logos, Signatures, Stamps), found again by its fingerprint.
    const read = parseRecord(xml).data;
    const blocks = [...read.sections.flatMap((s) => s.blocks), ...read.classification];
    const marks = [
      ...read.companies.flatMap((c) => (c.logo && c.logoSha256 ? [{ what: `the logo of ${nameOf(c.name)}`, sha256: c.logoSha256 }] : [])),
      ...read.cards.flatMap((c) => (c.signature && c.signatureSha256 ? [{ what: `the Signature of ${nameOf(c.name)}`, sha256: c.signatureSha256 }] : [])),
      ...read.stamps.flatMap((s) => (s.image && s.imageSha256 ? [{ what: `the Stamp of ${nameOf(s.company)}`, sha256: s.imageSha256 }] : [])),
    ];
    const wanted = new Set([...photoFingerprints(blocks), ...marks.map((m) => m.sha256)]);
    const found = await findPhotos(wanted, source.documents, deps.files, source.marks);
    const { appendix, problems: appendixProblems } = await appendixFrom(read.appendix, source.documents, deps.files);
    const problems = [
      ...recordPhotos(blocks)
        .filter((p) => p.sha256 && !found.keys.has(p.sha256))
        .map((p) => `the Form photo ${p.fileName} (${p.sha256!.slice(0, 12)}…) is not among the item's Documents as the record printed it`),
      ...marks.filter((m) => !found.keys.has(m.sha256)).map((m) => `${m.what} (${m.sha256.slice(0, 12)}…) is not stored as the record printed it`),
      ...appendixProblems,
    ];
    if (problems.length > 0) {
      await reproduceDocumentalRecord(trx, row.id, { verdict: { passed: false, problems } });
      return;
    }
    const { data, marks: markKeys } = parseRecord(xml, { keyOf: (sha) => found.keys.get(sha) ?? null });

    // The PDF being replaced: at its key, or already moved aside by an attempt that failed after storing.
    const movedAsideKey = replacedRecordKey(source.pdfKey, source.pdfSha256);
    const current = await deps.files.get(source.pdfKey);
    const replacedPdf = current && toHex(await sha256(current)) === source.pdfSha256 ? current : await deps.files.get(movedAsideKey);
    if (!replacedPdf) throw new Error("the PDF being replaced is missing from storage");

    const sealedAt = now();
    const made = await makeRecordPdf(deps, { data, marks: markKeys, images: found.images, appendix }, sealedAt);
    const { pdf } = made;
    const checked = await checkRecord(pdf, expectationOf(made.data, made.layoutPages), deps.validator ?? environmentValidator());
    // Every fact must come out as stored; only where things land on the pages may move (LAYOUT_DERIVED).
    const same = recordDataFacts(new TextDecoder().decode(made.xml)) === recordDataFacts(xml);
    const verdict = same
      ? checked
      : { passed: false, problems: [...checked.problems, "the remade Record Data differs from the stored one in more than where things land on the pages"] };

    if (verdict.passed) {
      await deps.files.put(movedAsideKey, replacedPdf, "application/pdf");
      await deps.files.put(source.pdfKey, pdf, "application/pdf");
    }
    await reproduceDocumentalRecord(trx, row.id, {
      replaced: { storageKey: movedAsideKey, sha256: await sha256(replacedPdf), size: replacedPdf.length },
      newPdf: { sha256: await sha256(pdf), size: pdf.length, sealedAt },
      verdict,
    });
    if (verdict.passed) await saveDocumentalRecordFace(trx, row.id, recordFace(data)); // the verification page's (RP-157)
  };
}
