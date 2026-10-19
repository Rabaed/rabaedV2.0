import { pageCountOf } from "./checks.ts";
import type { RecordJobDeps } from "./job.ts";
import { recordHtml } from "./layout.ts";
import { toPdfA3 } from "./pdfa.ts";
import type { RecordData } from "./record-data.ts";
import { sealPdf } from "./seal.ts";

/**
 * The record's PDF from its Record Data: the one Rabaed layout rendered with Chromium, made a
 * PDF/A-3 with the Record Data (\`xml\`) attached, then sealed at \`at\`. The record job (at
 * closure) and Re-produce (from the stored Record Data) both make it here, so they cannot
 * differ. \`layoutPages\` is how many pages the layout rendered, before anything is appended.
 */
export async function makeRecordPdf(
  deps: Pick<RecordJobDeps, "renderer" | "fonts" | "signer" | "timestamps">,
  data: RecordData,
  xml: Uint8Array,
  images: ReadonlyMap<string, string>,
  at: Date,
): Promise<{ pdf: Uint8Array; layoutPages: number }> {
  const rendered = await deps.renderer.render(recordHtml(data, await deps.fonts(), images));
  const title = [data.type.code, data.documentNumber ?? data.subject].join(" ");
  const archival = await toPdfA3(rendered, { title, at }, [{ name: "record-data.xml", mimeType: "application/xml", description: "Record Data", bytes: xml }]);
  const pdf = await sealPdf(archival, { signer: await deps.signer(), timestamps: await deps.timestamps(), at });
  return { pdf, layoutPages: await pageCountOf(rendered) };
}
