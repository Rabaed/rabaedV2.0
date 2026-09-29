// Seam 2: the app role check, which a one-off task runs in AWS after every
// deploy (RP-213). It passes for rabaed_app and names what is wrong otherwise.
import { afterAll, describe, expect, it } from "vitest";
import { checkAppRole } from "../src/app-role-check.ts";
import { createDb } from "../src/client.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const app = createDb(urls.app, { max: 1 });
const admin = createDb(urls.admin, { max: 1 });
const migrator = createDb(urls.migrator, { max: 1 });
afterAll(() => Promise.all([app.destroy(), admin.destroy(), migrator.destroy()]));

describe("the app role check", () => {
  it("passes for rabaed_app: RLS applies, and it cannot change the audit event table", async () => {
    expect(await checkAppRole(app)).toEqual([]);
  });

  it("fails for a role that bypasses row-level security (rabaed_admin)", async () => {
    const failures = await checkAppRole(admin);
    expect(failures).toContainEqual(expect.stringMatching(/rabaed_admin is not rabaed_app/));
    expect(failures).toContainEqual(expect.stringMatching(/bypasses row-level security/));
  });

  it("fails for a role that may rewrite the audit event table (the owner, rabaed_migrator)", async () => {
    const failures = await checkAppRole(migrator);
    expect(failures).toContainEqual(expect.stringMatching(/may update work_item_event/));
    expect(failures).toContainEqual(expect.stringMatching(/may delete from work_item_event/));
    expect(failures).toContainEqual(expect.stringMatching(/may update admin_action/));
  });

  it("changes nothing, even when a statement is allowed", async () => {
    const before = await migrator.selectFrom("work_item_event").select(({ fn }) => fn.countAll<string>().as("n")).executeTakeFirstOrThrow();
    await checkAppRole(migrator);
    const after = await migrator.selectFrom("work_item_event").select(({ fn }) => fn.countAll<string>().as("n")).executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n);
  });
});
