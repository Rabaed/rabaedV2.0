import { documentalRecordReproductionSource, reproduceDocumentalRecord, type OutboxHandler } from "@rabaed/db";
import { checkRecord, environmentValidator, expectationOf, pageCountOf } from "./checks.ts";
import { recordHtml } from "./layout.ts";
import { toPdfA3 } from "./pdfa.ts";
import { sha256 } from "./pki.ts";
import { parseRecordData } from "./record-data-read.ts";
import type { RecordJobDeps } from "./job.ts";
import { sealPdf } from "./seal.ts";

// Re-produce (RP-155; ADR 0023; workflow-engine.md §7): when the PDF maker had a bug, a Rabaed
// Engineer re-produces a record in Rabaed Admin, which queues an outbox row of kind
// 'documental_record_reproduce' (apps/admin, logged in admin_action with a reason). This
// handler remakes the PDF from the stored Record Data alone, with a new seal date, checks it
// as any new record is, and replaces the old one at the same storage key, so its name and
// download link stay. The replaced PDF is kept under `replaced/` next to it, with its
// fingerprint in documental_record_reproduction (admin-only). The verification token and
// code, printed in the Record Data, are kept as they are. A new PDF that fails its checks
// replaces nothing. The item and its Transitions are never read or changed.

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

/** Where the PDF with fingerprint `sha256` (hex) is kept once a Re-produce has replaced it. */
export function replacedRecordKey(pdfKey: string, sha256: string): string {
  return pdfKey.replace(/[^/]+$/, `replaced/${sha256}.pdf`);
}

export function reproduceHandler(deps: RecordJobDeps): OutboxHandler {
  const now = deps.now ?? (() => new Date());
  return async (trx, row) => {
    const source = await documentalRecordReproductionSource(trx, row.id);
    if (!source) return;
    const stored = await deps.files.get(source.recordDataKey);
    if (!stored) throw new Error("the Record Data is missing from storage");
    const data = parseRecordData(new TextDecoder().decode(stored));

    // The PDF being replaced: at its key, or already moved aside by an attempt that failed after storing.
    const historyKey = replacedRecordKey(source.pdfKey, source.pdfSha256);
    const current = await deps.files.get(source.pdfKey);
    const replaced = current && hex(await sha256(current)) === source.pdfSha256 ? current : await deps.files.get(historyKey);
    if (!replaced) throw new Error("the PDF being replaced is missing from storage");

    const rendered = await deps.renderer.render(recordHtml(data, await deps.fonts()));
    const sealedAt = now();
    const title = [data.type.code, data.documentNumber ?? data.subject].join(" ");
    const archival = await toPdfA3(rendered, { title, at: sealedAt }, [{ name: "record-data.xml", mimeType: "application/xml", description: "Record Data", bytes: stored }]);
    const pdf = await sealPdf(archival, { signer: await deps.signer(), timestamps: await deps.timestamps(), at: sealedAt });
    const verdict = await checkRecord(pdf, expectationOf(data, await pageCountOf(rendered)), deps.validator ?? environmentValidator());

    if (verdict.passed) {
      await deps.files.put(historyKey, replaced, "application/pdf");
      await deps.files.put(source.pdfKey, pdf, "application/pdf");
    }
    await reproduceDocumentalRecord(trx, row.id, {
      replaced: { storageKey: historyKey, sha256: await sha256(replaced), size: replaced.length },
      next: { sha256: await sha256(pdf), size: pdf.length, sealedAt },
      verdict,
    });
  };
}
