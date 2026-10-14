// Seam 1 for the New item's Type picker (RP-590, spec RP-598): the Submittals
// Types the viewer's Participant may raise, the MAR first; the Form for a SAR and
// a DAR is that Type's; a Type with no Workflow for the viewer's Participant is
// not offered, and its Form is not found.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { FormVersion, RaisableTypes } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, ok, projectMember, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

let c1: Company; // Contractor; its Authorized Person created the Project.
let engineer: Caller; // C1 Engineer: raises.
let k1Engineer: Caller; // Consultant: holds no Draft.
let outsider: Caller;
let projectId = "";

beforeAll(async () => {
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  engineer = await projectMember(api, c1, own, ["engineer"]);
  const k1 = await api.authorizedPerson();
  const k1Participant = await api.addParticipant(c1.caller, projectId, k1.company, "consultant");
  await ok(c1.caller.request("PUT", `/v1/participants/${k1Participant}/visibility`, { trade: all, location: all }));
  k1Engineer = await projectMember(api, k1, k1Participant, ["engineer"]);
  outsider = (await api.member(c1.caller)).caller;
});

/**
 * The test database also holds other tests' Submittals Types (`MARV`, the MAR as it was before
 * RP-437, `HWT` and others from db test-support): only the Rabaed Defaults and this test's `NWF` count.
 */
const raisable = async (by: Caller): Promise<RaisableTypes> => {
  const { types } = (await ok(by.get(`/v1/projects/${projectId}/raisable-types`), 200)).json() as RaisableTypes;
  return { types: types.filter((t) => ["MAR", "SAR", "DAR", "NWF"].includes(t.code)) };
};

describe("the Types a Member may raise", () => {
  it("are the Submittals' three, the MAR first, the SAR and DAR named as the owner decided", async () => {
    const { types } = await raisable(engineer);
    expect(types.map((t) => t.code)).toEqual(["MAR", "SAR", "DAR"]);
    expect(types.slice(1).map((t) => t.name)).toEqual([
      { en: "Supplier Approval Request", ar: "طلب اعتماد مورد" },
      { en: "Document Approval Request", ar: "طلب اعتماد مستند" },
    ]);
  });

  it("don't include a Type the Member's role doesn't raise: a Consultant holds no Draft", async () => {
    expect((await raisable(k1Engineer)).types).toEqual([]);
  });

  it("are not found off the Member's Projects", async () => {
    await expectHidden(outsider.get(`/v1/projects/${projectId}/raisable-types`));
  });

  it("leave out a Type with no published Workflow", async () => {
    const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
    try {
      await sql`
        with d as (insert into workflow_definition (owner_kind, name) values ('rabaed', '{"en": "No Workflow", "ar": "No Workflow"}'::jsonb) returning id)
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        select 'rabaed', 'submittals', 'NWF', '{"en": "No Workflow", "ar": "No Workflow"}'::jsonb, d.id, 'review_code',
          (select form_definition_id from work_item_type where owner_kind = 'rabaed' and code = 'MAR')
        from d
      `.execute(migrator);
    } finally {
      await migrator.destroy();
    }
    expect((await raisable(engineer)).types.map((t) => t.code)).toEqual(["MAR", "SAR", "DAR"]);
    await expectHidden(engineer.get(`/v1/projects/${projectId}/work-item-types/NWF/form`));
  });
});

describe("the Form for a new SAR and DAR", () => {
  it("comes back for each Type", async () => {
    for (const code of ["MAR", "SAR", "DAR"]) {
      const form: FormVersion = (await ok(engineer.get(`/v1/projects/${projectId}/work-item-types/${code}/form`), 200)).json();
      expect(form.schema.sections.length, code).toBeGreaterThan(0);
    }
  });
});
