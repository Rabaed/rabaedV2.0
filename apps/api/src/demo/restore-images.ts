import { createHash } from "node:crypto";
import type { Db } from "@rabaed/db";
import { sql } from "kysely";
import type { FileStore } from "../documents/file-store.ts";
import { demoLogoPng, demoStampPng } from "./demo-company-images.ts";
import { demoSignaturePng } from "./demo-signature.ts";

// The demo's images on a file store that lacks them (RP-672). A demo seeded with no file store
// (UAT's, before RP-672) recorded each Signature, logo and Stamp with nothing stored under its
// key. The demo command, which builds the api with the file store, puts back each one: the
// demo image whose SHA-256 the row records, under the key it records. stored_file is never
// changed (its trigger refuses it), and nothing else is touched: only the Members on the
// demo's domain, and the Companies whose Authorized Person is one.

type Kind = "signature" | "logo" | "stamp";
const draw: Record<Kind, (seed: number) => Buffer> = { signature: demoSignaturePng, logo: demoLogoPng, stamp: demoStampPng };

/** What a run did: images put back, and demo images missing that no demo image matches (left missing). */
export interface DemoImagesRestored {
  restored: number;
  unmatched: number;
}

type Row = { kind: Kind; storage_key: string; sha256: Buffer; mime: string };

/** Puts back every demo Signature, logo and Stamp whose image `files` lacks; one already stored is left as it is. */
export async function restoreDemoImages(migrator: Db, files: FileStore): Promise<DemoImagesRestored> {
  const { rows } = await sql<Row>`
    select 'signature' as kind, f.storage_key, f.sha256, f.mime
    from member m
    join member_signature s on s.member_id = m.id
    join stored_file f on f.id = s.file_id
    where m.email like '%.demo.rabaed.test'
    union all
    select image.kind, f.storage_key, f.sha256, f.mime
    from company c
    join member ap on ap.id = c.authorized_person_id
    cross join lateral (values ('logo', c.logo_file_id), ('stamp', c.stamp_file_id)) as image (kind, file_id)
    join stored_file f on f.id = image.file_id
    where ap.email like '%.demo.rabaed.test'
  `.execute(migrator);

  // The seed draws image n for its n-th Member or Company, so a kind's images are among its first `count`.
  const drawn = new Map<string, Buffer>();
  const drawnKinds = new Set<Kind>();
  const demoImage = (kind: Kind, sha256: Buffer) => {
    if (!drawnKinds.has(kind)) {
      drawnKinds.add(kind);
      const count = rows.filter((row) => row.kind === kind).length;
      for (let seed = 0; seed < count; seed++) {
        const png = draw[kind](seed);
        drawn.set(createHash("sha256").update(png).digest("hex"), png);
      }
    }
    return drawn.get(sha256.toString("hex"));
  };

  const result: DemoImagesRestored = { restored: 0, unmatched: 0 };
  for (const row of rows) {
    if (await files.stat(row.storage_key)) continue;
    const png = demoImage(row.kind, row.sha256);
    if (!png) {
      result.unmatched++;
      continue;
    }
    await files.put(row.storage_key, png, row.mime);
    result.restored++;
  }
  return result;
}
