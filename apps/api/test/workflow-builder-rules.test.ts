// Seam 1: the builder's rules, actions and notifications (RP-440, WF-17; spec RP-423;
// workflow-engine.md §11). The builder reads the Form for its pickers
// (`GET /v1/workflows/:id/builder`), changes a Transition through @rabaed/domain's rule
// edits, and saves, validates and publishes through WF-4's API (RP-427): every kind of
// rule can be added, edited and removed, and comes back from publish as it was written.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { addRule, removeRule, ruleFieldsOf, setRecipient, transitionRuleFields, updateRule, type RuleEntry, type WorkflowBuilderRead, type WorkflowDefinition, type WorkflowRead } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { buildTower, ok, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const ROUTE = { en: "Tower MAR with rules", ar: "اعتماد المواد بقواعد" };
/** The consultant's closing Transition with Code A: a Step the consultant holds, with an Action Form that asks for remarks. */
const TRANSITION = "approve_a";

let c1: Company;
let at: Tower;
let marDefault = "";
let route = "";

beforeAll(async () => {
  c1 = await api.projectCreator();
  const k1: Company = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "WFR");
  const mar = await sql<{ workflow_definition_id: string }>`
    select workflow_definition_id from work_item_type where owner_kind = 'rabaed' and code = 'MAR'
  `.execute(migrator);
  marDefault = mar.rows[0]!.workflow_definition_id;
  const res = await c1.caller.post(`/v1/workflows/${marDefault}/duplicate`, { projectId: at.projectId, name: ROUTE });
  expect(res.statusCode, res.body).toBe(201);
  route = res.json().id;
});

const builder = async (by: Caller): Promise<WorkflowBuilderRead> => (await ok(by.get(`/v1/workflows/${route}/builder`), 200)).json();
const read = async (by: Caller): Promise<WorkflowRead> => (await ok(by.get(`/v1/workflows/${route}`), 200)).json();
const errorsOf = (problems: { severity: string; code: string }[]) => problems.filter((p) => p.severity === "error");
const save = async (definition: WorkflowDefinition) => {
  await ok(c1.caller.request("PUT", `/v1/workflows/${route}/draft`, { definition }), 200);
  const checked = (await ok(c1.caller.post(`/v1/workflows/${route}/validate`, { definition }), 200)).json();
  expect(checked.issues).toEqual([]);
  return checked.problems as { severity: string; code: string; transition?: string; detail?: string }[];
};

const t = (en: string, ar: string) => ({ en, ar });
const message = t("Check the specification first.", "تحقق من المواصفات أولًا.");

/** One rule of every kind, as the dialog writes them from the Form's own fields. */
const everyKind: RuleEntry[] = [
  { group: "restrict", rule: { type: "condition", condition: { all: [{ field: "sample_checked", op: "=", value: true }, { not: { field: "verification_note", op: "empty" } }] } } },
  { group: "restrict", rule: { type: "positions", positions: ["manager"] } },
  { group: "restrict", rule: { type: "not_same_person", step: "internal_review" } },
  { group: "restrict", rule: { type: "been_through", step: "consultant_review" } },
  { group: "restrict", rule: { type: "all_closed", items: "comments" } },
  { group: "validate", rule: { type: "condition", condition: { field: "verification_note", op: "not_empty" }, message: t("Add a verification note.", "أضف ملاحظة تحقق.") } },
  { group: "validate", rule: { type: "condition", condition: { any: [{ field: "matches_specification", op: "=", value: true }, { field: "manufacturer", op: "in", value: ["acme"] }] }, message } },
  { group: "validate", rule: { type: "form_complete" } },
  { group: "validate", rule: { type: "has_document", field: "datasheet" } },
  { group: "action", rule: { type: "offer_assign_to" } },
  { group: "action", rule: { type: "set_field", field: "remarks", value: "Reviewed" } },
  { group: "action", rule: { type: "copy_field", from: "verification_note", to: "remarks" } },
];

describe("the builder's rule pickers", () => {
  it("list the Type's Form fields that take answers, with their types, and nothing else", async () => {
    const { form } = await builder(c1.caller);
    const fields = ruleFieldsOf(form, null);
    expect(fields.map((f) => f.key)).toEqual(
      expect.arrayContaining(["manufacturer", "datasheet", "sample_checked", "matches_specification", "verification_note", "trade", "location"]),
    );
    expect(fields.find((f) => f.key === "sample_checked")).toMatchObject({ type: "yes_no", source: "form", label: { en: expect.any(String), ar: expect.any(String) } });
    expect(fields.find((f) => f.key === "datasheet")?.type).toBe("attachments");
    // Not the Action Form's fields (they belong to one Transition), nor invented ones.
    expect(fields.map((f) => f.key)).not.toContain("remarks");
  });

  it("list, by group, what publish accepts: a Restrict not the Action Form, an Effect only what the consultant fills", async () => {
    const { form, stages, workflow } = await builder(c1.caller);
    const definition = workflow.draft!.definition;
    const fields = transitionRuleFields(form, definition.transitions.find((x) => x.key === TRANSITION)!, definition, stages);
    const keys = (list: { key: string }[]) => list.map((f) => f.key);
    expect(keys(fields.restrict)).not.toContain("remarks");
    expect(keys(fields.validate)).toEqual(expect.arrayContaining(["remarks", "manufacturer"]));
    expect(keys(fields.write)).toEqual(expect.arrayContaining(["remarks", "verification_note"]));
    // The raiser's answers: the consultant never writes them.
    expect(keys(fields.write)).not.toContain("manufacturer");
  });

  it("a rule naming a field the Form doesn't have is a publish error the builder lists", async () => {
    const start = (await builder(c1.caller)).workflow.draft!.definition;
    const bad = addRule(start, TRANSITION, { group: "validate", rule: { type: "condition", condition: { field: "not_a_field", op: "not_empty" }, message } });
    // Checked without saving, so the draft the next tests build on is untouched.
    const problems = (await ok(c1.caller.post(`/v1/workflows/${route}/validate`, { definition: bad }), 200)).json().problems;
    expect(problems).toContainEqual(expect.objectContaining({ code: "unknown_field", severity: "error", transition: TRANSITION, detail: "not_a_field" }));
  });
});

describe("each kind of rule, action and notification, added, edited and removed", () => {
  let all: WorkflowDefinition;

  it("adds one of every kind to a Transition, and the draft validates with no errors", async () => {
    let definition = (await builder(c1.caller)).workflow.draft!.definition;
    for (const entry of everyKind) definition = addRule(definition, TRANSITION, entry);
    definition = setRecipient(definition, TRANSITION, { to: "raiser" }, true);
    definition = setRecipient(definition, TRANSITION, { to: "watchers" }, true);
    definition = setRecipient(definition, TRANSITION, { to: "position", position: "engineer" }, true);
    all = definition;
    const problems = await save(definition);
    expect(errorsOf(problems), JSON.stringify(problems)).toEqual([]);
  });

  it("publishes it, and the published Version has every rule as written", async () => {
    await ok(c1.caller.post(`/v1/workflows/${route}/publish`), 200);
    const published = await read(c1.caller);
    expect(published).toMatchObject({ publishedVersions: [1], draft: null });
    expect(published.published!.definition).toEqual(all);
    const transition = published.published!.definition.transitions.find((x) => x.key === TRANSITION)!;
    expect(transition.rules?.restrict).toHaveLength(5);
    expect(transition.rules?.validate).toHaveLength(4);
    expect(transition.actions).toHaveLength(3);
    expect(transition.notifications).toEqual([{ to: "raiser" }, { to: "watchers" }, { to: "position", position: "engineer" }]);
  });

  it("edits a rule of each group and a recipient, and the next Version has the edits", async () => {
    let definition = (await read(c1.caller)).published!.definition;
    definition = updateRule(definition, TRANSITION, { group: "restrict", index: 1 }, { group: "restrict", rule: { type: "positions", positions: ["manager", "engineer"] } });
    definition = updateRule(definition, TRANSITION, { group: "validate", index: 0 }, {
      group: "validate",
      rule: { type: "condition", condition: { field: "verification_note", op: "not_empty" }, message: t("A verification note is needed.", "ملاحظة التحقق مطلوبة.") },
    });
    definition = updateRule(definition, TRANSITION, { group: "action", index: 1 }, { group: "action", rule: { type: "set_field", field: "remarks", value: "Reviewed twice" } });
    definition = setRecipient(definition, TRANSITION, { to: "watchers" }, false);
    const problems = await save(definition);
    expect(errorsOf(problems), JSON.stringify(problems)).toEqual([]);
    await ok(c1.caller.post(`/v1/workflows/${route}/publish`), 200);
    const published = (await read(c1.caller)).published!;
    expect(published.versionNo).toBe(2);
    expect(published.definition).toEqual(definition);
    expect(published.definition.transitions.find((x) => x.key === TRANSITION)!.rules!.restrict![1]).toEqual({ type: "positions", positions: ["manager", "engineer"] });
  });

  it("removes every rule, action and notification, and the Transition comes back as it was before any", async () => {
    let definition = (await read(c1.caller)).published!.definition;
    const own = () => definition.transitions.find((x) => x.key === TRANSITION)!;
    while ((own().rules?.restrict ?? []).length > 0) definition = removeRule(definition, TRANSITION, { group: "restrict", index: 0 });
    while ((own().rules?.validate ?? []).length > 0) definition = removeRule(definition, TRANSITION, { group: "validate", index: 0 });
    while ((own().actions ?? []).length > 0) definition = removeRule(definition, TRANSITION, { group: "action", index: 0 });
    definition = setRecipient(setRecipient(definition, TRANSITION, { to: "raiser" }, false), TRANSITION, { to: "position", position: "engineer" }, false);
    expect(own()).not.toHaveProperty("rules");
    expect(own()).not.toHaveProperty("actions");
    expect(own()).not.toHaveProperty("notifications");
    const problems = await save(definition);
    expect(errorsOf(problems), JSON.stringify(problems)).toEqual([]);
    await ok(c1.caller.post(`/v1/workflows/${route}/publish`), 200);
    const published = (await read(c1.caller)).published!;
    expect(published.versionNo).toBe(3);
    expect(published.definition.transitions.find((x) => x.key === TRANSITION)).toEqual(own());
    expect(published.definition.transitions.find((x) => x.key === TRANSITION)).not.toHaveProperty("rules");
  });
});
