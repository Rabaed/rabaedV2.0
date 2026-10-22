import { renderWithAppendix, type Appendix } from "./appendix.ts";
import type { RecordJobDeps } from "./job.ts";
import { toPdfA3 } from "./pdfa.ts";
import { recordDataXml, type RecordData, type RecordImages } from "./record-data.ts";
import { sealPdf } from "./seal.ts";

/** What the record's PDF is made from. */
export interface RecordSource {
  /** The Record Data; its page pointers and the appendix's pages are placed by rendering. */
  readonly data: RecordData;
  /** Where the logos, Signatures and Stamps it flags are stored (never part of the Record Data). */
  readonly marks: RecordImages;
  /** The data URL of each image the pages print (Form photos, logos, Signatures, Stamps), by storage key. */
  readonly images: ReadonlyMap<string, string>;
  /** The appendix (appendix.ts): its pages, images and the files it carries. */
  readonly appendix: Appendix;
}

/**
 * The record's PDF from its Record Data: the one Rabaed layout rendered with Chromium, with the
 * pages page 1 points to and the appendix's pages placed (renderWithAppendix), made a PDF/A-3
 * with the Record Data attached, then the appendix's carried files, and sealed at `at`. The
 * record job (at closure) and Re-produce (from the stored Record Data) both make it here, so
 * they cannot differ. Returns the Record Data as placed (`data`, and `xml` as attached), and
 * `layoutPages`, how many pages come before the appendix's own.
 */
export async function makeRecordPdf(
  deps: Pick<RecordJobDeps, "renderer" | "fonts" | "signer" | "timestamps">,
  source: RecordSource,
  at: Date,
): Promise<{ pdf: Uint8Array; data: RecordData; xml: Uint8Array; layoutPages: number }> {
  const { archival, data, xml, layoutPages } = await archivalPdf(deps, source, at);
  const pdf = await sealPdf(archival, { signer: await deps.signer(), timestamps: await deps.timestamps(), at });
  return { pdf, data, xml, layoutPages };
}

/**
 * The record's PDF/A-3, before its seal. Its own function so that the drawn document is let go
 * before the seal makes its one copy (RP-957, RP-1006: at the 100 MB limit a copy is about 100 MB).
 */
async function archivalPdf(
  deps: Pick<RecordJobDeps, "renderer" | "fonts">,
  source: RecordSource,
  at: Date,
): Promise<{ archival: Uint8Array; data: RecordData; xml: Uint8Array; layoutPages: number }> {
  const { data, doc, layoutPages } = await renderWithAppendix(deps.renderer, source.data, await deps.fonts(), source.images, source.marks, source.appendix);
  const xml = new TextEncoder().encode(recordDataXml(data));
  const title = [data.type.code, data.documentNumber ?? data.subject].join(" ");
  // The drawn document itself, never saved and opened again: one copy fewer of every page.
  const archival = await toPdfA3(doc, { title, at }, [
    { name: "record-data.xml", mimeType: "application/xml", description: "Record Data", bytes: xml },
    ...source.appendix.attachments,
  ]);
  return { archival, data, xml, layoutPages };
}
