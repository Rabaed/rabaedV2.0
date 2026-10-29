// Seam 1: the demo's images on a file store that lacks them (RP-672). UAT's demo was seeded
// with no file store: its Signature, logo and Stamp rows point at keys with nothing stored.
// `demo ensure` with UAT's file store puts back the demo's own images, and nothing else.
// An empty bucket of its own stands in for UAT's R2, so the shared test bucket is untouched.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { restoreDemoImages } from "../src/demo/restore-images.ts";
import { DEMO_ENGINEER_EMAIL } from "../src/demo/seed.ts";
import { createFileStore, ensureLocalBucket, fileStoreSettingsFromEnv } from "../src/documents/file-store.ts";
import { createTestApi } from "./support/harness.ts";

const urls = testDatabaseUrls();
const migrator = createDb(urls.migrator, { max: 1 });
const api = await createTestApi();
const settings = { ...fileStoreSettingsFromEnv(), bucket: `rabaed-rp672-${randomUUID().slice(0, 8)}` };
await ensureLocalBucket(settings);
const files = createFileStore(settings);
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

type Image = { storage_key: string; sha256: Buffer };

/** The images of the Companies the demo's Engineer onboarded: their logos, Stamps and Members' Signatures. */
async function demoImages(): Promise<Image[]> {
  const { rows } = await sql<Image>`
    with demo as (
      select c.* from company c
      join admin_action a on a.target_id = c.id and a.action = 'onboard_company'
      join rabaed_engineer e on e.id = a.engineer_id and e.email = ${DEMO_ENGINEER_EMAIL}
    )
    select f.storage_key, f.sha256 from demo join stored_file f on f.id in (demo.logo_file_id, demo.stamp_file_id)
    union all
    select f.storage_key, f.sha256 from demo
    join member m on m.company_id = demo.id
    join member_signature s on s.member_id = m.id
    join stored_file f on f.id = s.file_id
  `.execute(migrator);
  return rows;
}

// The test database gives every Member a Signature of its own before the seed adds theirs
// (test-defaults.ts): no demo image, so it stays missing and is counted as unmatched.
const isTestDefault = (image: Image) => image.storage_key.endsWith("/test-default.png");

describe("restoring the demo's images (RP-672)", () => {
  it("puts back every demo Signature, logo and Stamp under the key its row records, with the bytes it records", async () => {
    const images = await demoImages();
    const seeded = images.filter((image) => !isTestDefault(image));
    // Four Companies' logos and Stamps, and a Signature for each of their Members.
    expect(seeded.length).toBeGreaterThan(8);
    for (const image of images) expect(await files.stat(image.storage_key), image.storage_key).toBeNull();

    expect(await restoreDemoImages(migrator, files)).toEqual({ restored: seeded.length, unmatched: images.length - seeded.length });

    for (const image of seeded) {
      expect((await files.sha256(image.storage_key))?.equals(image.sha256), image.storage_key).toBe(true);
      expect((await files.stat(image.storage_key))?.contentType, image.storage_key).toBe("image/png");
    }
    for (const image of images.filter(isTestDefault)) expect(await files.stat(image.storage_key), image.storage_key).toBeNull();
  });

  it("puts back nothing on a second run", async () => {
    const unmatched = (await demoImages()).filter(isTestDefault).length;
    expect(await restoreDemoImages(migrator, files)).toEqual({ restored: 0, unmatched });
  });

  it("leaves another Company's Signature and Stamp alone", async () => {
    const { company } = await api.authorizedPerson();
    const { rows } = await sql<{ storage_key: string }>`
      select f.storage_key from member_signature s join stored_file f on f.id = s.file_id where s.member_id = ${company.authorizedPerson.id}::uuid
      union all
      select f.storage_key from company c join stored_file f on f.id = c.stamp_file_id where c.id = ${company.companyId}::uuid
    `.execute(migrator);
    expect(rows).toHaveLength(2);
    const unmatched = (await demoImages()).filter(isTestDefault).length;

    expect(await restoreDemoImages(migrator, files)).toEqual({ restored: 0, unmatched });

    for (const { storage_key } of rows) expect(await files.stat(storage_key), storage_key).toBeNull();
  });
});
