// Seam 1: the demo seed (RP-196). The seam suites' global setup seeds the demo
// Project `pnpm demo` builds (test/support/seed-demo.ts); this suite checks what
// it built and follows the README walkthrough as the demo people: create MAR →
// Send for Review → Return → re-send → Submit → Code A / Code C, with what each
// Company sees at each step. Each run adds its own MARs to the one demo Project.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import type { DocumentList, FormToFill, FormVersion, LinkedFrom, RevisionChain, WorkItemDetail, WorkItemHistory, WorkItemLinks } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CODE_C_TITLE, DEMO_ENGINEER_EMAIL } from "../src/demo/seed.ts";
import { createTestApi, expectHidden, DEFAULT_PASSWORD, uploadDocument, type Caller } from "./support/harness.ts";
import { detail, take } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const urls = testDatabaseUrls();
const migrator = createDb(urls.migrator, { max: 1 });
const worker = createDb(urls.app, { max: 1 });
afterAll(async () => {
  await api.close();
  await Promise.all([migrator.destroy(), worker.destroy()]);
});

// As the README lists them.
const demo = {
  hafiz: "hafiz.hamdan@tmc.demo.rabaed.test",
  ali: "ali.sonour@tmc.demo.rabaed.test",
  yousef: "yousef.karim@betabuild.demo.rabaed.test",
  ahmed: "ahmed.binsaid@designconsultants.demo.rabaed.test",
  sara: "sara@designconsultants.demo.rabaed.test",
  mohammed: "mohammed.alshamsi@designconsultants.demo.rabaed.test",
  faisal: "faisal.alotaibi@alwaha.demo.rabaed.test",
  saeed: "saeed.alqahtani@tmc.demo.rabaed.test",
  nasser: "nasser.aldosari@betabuild.demo.rabaed.test",
  layla: "layla.mansour@designconsultants.demo.rabaed.test",
  hind: "hind.almutairi@alwaha.demo.rabaed.test",
  omar: "omar.alharbi@tmc.demo.rabaed.test",
} as const;
type Who = keyof typeof demo;
const signIn = (who: Who) => api.signIn(demo[who], DEFAULT_PASSWORD);

let hafiz: Caller; // TMC Contractor Engineer
let ali: Caller; // TMC Contractor PM
let yousef: Caller; // Beta Build (second Contractor)
let ahmed: Caller; // Design Consultants LLC Engineer
let mohammed: Caller; // Design Consultants LLC Manager
let faisal: Caller; // Al Waha PMC (Owner Representative)
let omar: Caller; // TMC Contractor Engineer who covers Tower 2 only
let projectId = "";
let electrical = "";
let tower1Floor2 = "";

beforeAll(async () => {
  hafiz = await signIn("hafiz");
  ali = await signIn("ali");
  yousef = await signIn("yousef");
  ahmed = await signIn("ahmed");
  mohammed = await signIn("mohammed");
  faisal = await signIn("faisal");
  omar = await signIn("omar");
  const projects = (await hafiz.get("/v1/projects")).json().projects as { id: string; code: string; name: { en: string } }[];
  projectId = projects.find((p) => p.code === "TWR" && p.name.en === "Riyadh Gate Tower – Phase 2")!.id;
  const dimensions = (await hafiz.get(`/v1/projects/${projectId}/dimensions`)).json();
  electrical = dimensions.trade.find((v: { code: string }) => v.code === "EL").id;
  tower1Floor2 = dimensions.location.find((v: { code: string }) => v.code === "T1F02").id;
});

describe("the demo seed", () => {
  it("onboards the four Companies through Rabaed Admin, each with a reason in admin_action (V9)", async () => {
    const { rows } = await sql<{ action: string; reason: string; name: string }>`
      select a.action, a.reason, c.legal_name ->> 'en' as name
      from admin_action a
      join rabaed_engineer e on e.id = a.engineer_id
      join company c on c.id = a.target_id
      where e.email = ${DEMO_ENGINEER_EMAIL}
      order by a.at
    `.execute(migrator);
    expect(rows.map((r) => r.name)).toEqual(["TMC Constructions", "Beta Build", "Design Consultants LLC", "Al Waha PMC"]);
    expect(rows.every((r) => r.action === "onboard_company" && r.reason.startsWith("Demo seed:"))).toBe(true);
  });

  it("lets every demo person sign in, and shows the Project to its Project Members", async () => {
    for (const who of Object.keys(demo) as Who[]) {
      const caller = await signIn(who);
      if (who === "nasser" || who === "layla" || who === "hind") continue; // Authorized Persons, not Project Members (V15).
      const names = (await caller.get("/v1/projects")).json().projects.map((p: { name: { en: string } }) => p.name.en);
      expect(names, who).toContain("Riyadh Gate Tower – Phase 2");
    }
  });
});

describe("the MAR Form Version 4, as the demo uses it", () => {
  it("lists every field of Version 4, labelled in English and Arabic", async () => {
    const form: FormVersion = (await hafiz.get(`/v1/projects/${projectId}/work-item-types/MAR/form`)).json();
    expect(form.versionNo).toBe(4);
    const fields = form.schema.sections.flatMap((s) => s.fields).filter((f) => "label" in f);
    expect(fields.map((f) => [f.key, f.type])).toEqual([
      ["manufacturer", "text"],
      ["model", "text"],
      ["specification_section", "text"],
      ["description", "textarea"],
      ["items", "table"],
      ["datasheet", "attachments"],
      ["test_certificate", "attachments"],
      ["sample_photo", "photos"],
      ["related_submittals", "work_item_ref"],
      ["sample_checked", "yes_no"],
      ["matches_specification", "yes_no"],
      ["verification_note", "textarea"],
      ["trade", "trade"],
      ["location", "location"],
      ["scopes", "scopes"],
    ]);
    for (const f of fields) {
      expect("label" in f && f.label.en && f.label.ar, f.key).toBeTruthy();
    }
  });

  it("is what the seeded Draft is filled through: Items, a Datasheet and a Sample photo with its time and place", async () => {
    const items = (await hafiz.get(`/v1/projects/${projectId}/work-items`)).json().items as { id: string; title: string }[];
    const id = items.find((i) => i.title === "Emergency lighting – Tower 2")!.id;
    const item: WorkItemDetail = (await hafiz.get(`/v1/work-items/${id}`)).json();
    expect(item.answers).toMatchObject({
      manufacturer: "Zumtobel",
      model: "RESCLITE PRO",
      specification_section: "26 52 13",
      description: expect.any(String),
      items: [
        { fixture_type: "Escape route luminaire", quantity: 36, unit: "pcs" },
        { fixture_type: "Anti-panic luminaire", quantity: 12, unit: "pcs" },
      ],
      trade: electrical,
    });
    const { documents } = (await hafiz.get(`/v1/work-items/${id}/documents`)).json() as DocumentList;
    expect(documents).toMatchObject([
      { fieldKey: "datasheet", fileName: "RESCLITE-PRO-datasheet.pdf", contentType: "application/pdf", frozen: false },
      {
        fieldKey: "sample_photo",
        fileName: "RESCLITE-PRO-sample.jpg",
        takenAt: "2026-09-28T07:15:00.000Z",
        takenWhere: { latitude: expect.closeTo(24.7136, 4), longitude: expect.closeTo(46.6753, 4) },
      },
    ]);
    const link = (await hafiz.get(`/v1/work-items/${id}/documents/${documents[0]!.id}/download`)).json().url as string;
    expect((await (await fetch(link)).text()).startsWith("%PDF-")).toBe(true);
  });
});

// Links (RP-294, spec RP-289): the seed leaves an approved MAR in Tower 1, and a
// MAR on Version 4 in Tower 2 that links it twice: under Related submittals and
// as a free Link. Omar covers Tower 2 only, so he reads the approved MAR as its
// number and Subject, and nothing more (E1).
const APPROVED_TITLE = "Exit signage – Tower 1";
const LINKING_TITLE = "Emergency lighting control panel – Tower 2";
const titled = async (who: Caller, title: string) => {
  const items = (await who.get(`/v1/projects/${projectId}/work-items`)).json().items as { id: string; title: string }[];
  return items.find((i) => i.title === title)?.id;
};
/** The seeded Code C MAR's chain, as Hafiz sees it: the original, then its Rev 1. */
const codeCChain = async () => {
  const id = (await titled(hafiz, CODE_C_TITLE))!;
  return ((await hafiz.get(`/v1/work-items/${id}/revisions`)).json() as RevisionChain).revisions;
};
const links = async (who: Caller, id: string): Promise<WorkItemLinks> => {
  const r = await who.get(`/v1/work-items/${id}/links`);
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
};
const linkedFrom = async (who: Caller, id: string): Promise<LinkedFrom> => {
  const r = await who.get(`/v1/work-items/${id}/linked-from`);
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
};

describe("the seeded Links", () => {
  let approved = "";
  let linking = "";
  let approvedNumber = "";

  beforeAll(async () => {
    approved = (await titled(hafiz, APPROVED_TITLE))!;
    linking = (await titled(hafiz, LINKING_TITLE))!;
    approvedNumber = (await hafiz.get(`/v1/work-items/${approved}`)).json().documentNumber;
  });

  it("include an approved MAR, Code A, in Tower 1", async () => {
    expect((await hafiz.get(`/v1/work-items/${approved}`)).json()).toMatchObject({
      stage: { key: "approved" },
      outcome: "A",
      documentNumber: expect.stringMatching(/^TWR-MAR-01-\d{4}$/),
    });
  });

  it("include a MAR on Version 4, sent to the Consultant, linking it under Related submittals and as a free Link", async () => {
    const form: FormVersion = (await hafiz.get(`/v1/work-items/${linking}/form`)).json();
    expect(form.versionNo).toBe(4);
    const item: WorkItemDetail = (await hafiz.get(`/v1/work-items/${linking}`)).json();
    expect(item).toMatchObject({ stage: { key: "pending_approval" }, answers: { related_submittals: [approved] } });
    const { links: seen } = await links(hafiz, linking);
    expect(seen.map((l) => [l.kind, l.fieldKey, l.documentNumber, l.subject, l.workItemId]).sort()).toEqual(
      [
        ["related", null, approvedNumber, APPROVED_TITLE, approved],
        ["relies_on", "related_submittals", approvedNumber, APPROVED_TITLE, approved],
      ].sort(),
    );
  });

  it("show the approved MAR's Linked from: the MAR linking it, which Hafiz and the Consultant can open", async () => {
    const linkingNumber = (await hafiz.get(`/v1/work-items/${linking}`)).json().documentNumber;
    for (const who of [hafiz, ahmed]) {
      expect((await linkedFrom(who, approved)).items).toEqual([{ documentNumber: linkingNumber, subject: LINKING_TITLE, workItemId: linking }]);
    }
  });

  it("show Omar, who covers Tower 2 only, the approved MAR as its number and Subject only, and 404 on it", async () => {
    const item = (await omar.get(`/v1/work-items/${linking}`)).json();
    expect(item.answers).toMatchObject({ related_submittals: [{ documentNumber: approvedNumber, subject: APPROVED_TITLE }] });
    expect(JSON.stringify(item)).not.toContain(approved);
    const { links: seen } = await links(omar, linking);
    expect(seen).toHaveLength(2);
    for (const link of seen) expect(link).toMatchObject({ documentNumber: approvedNumber, subject: APPROVED_TITLE, workItemId: null });
    expect(JSON.stringify(seen)).not.toContain(approved);
    await expectHidden(omar.get(`/v1/work-items/${approved}`));
    await expectHidden(omar.get(`/v1/work-items/${approved}/linked-from`));
    expect(await titled(omar, APPROVED_TITLE)).toBeUndefined();
  });

  it("are nothing to the other Contractor", async () => {
    for (const id of [approved, linking]) await expectHidden(yousef.get(`/v1/work-items/${id}/links`));
  });
});

describe("the README walkthrough", () => {
  let mar = "";
  /** Not in the detail, the list, or (for Beta Build, with no items of its own) any count. */
  const hidden = async (who: Caller, { countsZero = false } = {}) => {
    await expectHidden(who.get(`/v1/work-items/${mar}`));
    const list = (await who.get(`/v1/projects/${projectId}/work-items`)).json();
    expect(list.items.map((i: { id: string }) => i.id)).not.toContain(mar);
    if (countsZero) expect(list.stages.every((s: { count: number }) => s.count === 0)).toBe(true);
  };
  /** The Consultant's verification, saved over the answers `who` reads, as the web form does. */
  const verify = async (who: Caller, verification: Record<string, unknown>) => {
    const saved = await who.request("PUT", `/v1/work-items/${mar}/answers`, { answers: { ...(await detail(who, mar)).answers, ...verification } });
    expect(saved.statusCode, saved.body).toBe(204);
  };
  const pickUp = async (who: Caller) => expect((await who.post(`/v1/work-items/${mar}/pick-up`)).statusCode).toBe(204);
  // The Form of a complete MAR; a function, as the Trade and Location ids come from beforeAll.
  const filled = () => ({
    manufacturer: "Philips",
    model: "CoreLine Panel",
    specification_section: "26 51 00",
    description: "LED panel fixtures, 600 × 600",
    items: [
      { fixture_type: "Recessed panel", description: "600 × 600, 34 W", quantity: 200, unit: "pcs" },
      { fixture_type: "Surface panel", description: "600 × 600, 34 W", quantity: 40, unit: "pcs" },
    ],
    trade: electrical,
    location: tower1Floor2,
  });
  const raise = async (title: string, answers: Record<string, unknown> = filled()) => {
    const r = await hafiz.post(`/v1/projects/${projectId}/work-items`, { type: "MAR", title, answers });
    expect(r.statusCode, r.body).toBe(201);
    return r.json().id as string;
  };
  /** Uploads a PDF to the item's Datasheet field, as the browser does: a signed URL, the file, then the API told. */
  const attachDatasheet = (who: Caller, fileName: string, body: string) =>
    uploadDocument(who, mar, { fieldKey: "datasheet", fileName, contentType: "application/pdf", body });
  const documents = async (who: Caller): Promise<DocumentList> => (await who.get(`/v1/work-items/${mar}/documents`)).json();

  it("1. Hafiz creates a MAR with the Form half filled: a Draft only TMC sees", async () => {
    mar = await raise("Lighting Fixtures", { manufacturer: "Philips", trade: electrical, location: tower1Floor2 });
    expect((await detail(ali, mar)).stage.key).toBe("draft");
    await hidden(yousef, { countsZero: true });
    for (const who of [ahmed, mohammed, faisal]) await hidden(who);
  });

  it("2. Send for Review is refused while the Form is incomplete, with the list of what is missing", async () => {
    const r = await hafiz.post(`/v1/work-items/${mar}/transitions`, { transition: "send_for_review", reason: "", confirmed: true, idempotencyKey: randomUUID() });
    expect(r.statusCode, r.body).toBe(422);
    expect(r.json()).toEqual({
      error: "form_incomplete",
      fields: [
        { key: "description", code: "required" },
        { key: "datasheet", code: "required" },
      ],
    });
    expect((await detail(hafiz, mar)).stage.key).toBe("draft");
  });

  it("3. Hafiz completes the Form with its Items and a Datasheet, and Saves the Draft", async () => {
    const saved = await hafiz.request("PUT", `/v1/work-items/${mar}/answers`, { answers: filled() });
    expect(saved.statusCode, saved.body).toBe(204);
    await attachDatasheet(hafiz, "CoreLine-datasheet.pdf", "%PDF-1.4 Philips CoreLine Panel 600 x 600 datasheet (demo)");
    expect((await detail(hafiz, mar)).answers).toMatchObject(filled());
    expect((await documents(hafiz)).documents.map((d) => [d.fieldKey, d.fileName])).toEqual([["datasheet", "CoreLine-datasheet.pdf"]]);
    await hidden(yousef, { countsZero: true });
  });

  it("3. Sent for Review, it reaches Ali, with a notification; still nobody outside TMC", async () => {
    await take(hafiz, mar, "send_for_review");
    await drainOutbox(worker);
    const notifications = (await ali.get("/v1/notifications")).json().notifications;
    expect(notifications.map((n: { workItemId: string }) => n.workItemId)).toContain(mar);
    expect((await detail(ali, mar)).documentNumber).toMatch(/^TWR-MAR-01-\d{4}$/);
    await hidden(yousef, { countsZero: true });
    for (const who of [ahmed, mohammed, faisal]) await hidden(who);
  });

  it("4. Ali picks up and Returns it with a reason; 5. Hafiz re-sends it", async () => {
    await pickUp(ali);
    await take(ali, mar, "return", { reason: "Add emergency duration" });
    expect((await detail(hafiz, mar)).stage.key).toBe("draft");
    await take(hafiz, mar, "send_for_review");
    await pickUp(ali);
  });

  it("6. Ali Submits it: With Design Consultants LLC; the Consultant and Al Waha see it, Beta Build never does", async () => {
    await take(ali, mar, "submit");
    expect((await detail(hafiz, mar)).heldBy).toEqual({
      companyName: { en: "Design Consultants LLC", ar: "المصممون الاستشاريون ذ.م.م" },
      memberName: null,
    });
    expect((await detail(ahmed, mar)).actions).toMatchObject({ pickUp: false, transitions: [] });
    expect((await detail(mohammed, mar)).actions.pickUp).toBe(true);
    expect((await detail(faisal, mar)).stage.key).toBe("pending_approval");
    await hidden(yousef, { countsZero: true });
    expect((await ahmed.get(`/v1/work-items/${mar}/history`)).body).not.toContain("Add emergency duration");
  });

  it("7. The Consultant reads the Form's answers and the frozen Datasheet; the other Contractor still sees nothing", async () => {
    expect((await detail(ahmed, mar)).answers).toMatchObject(filled());
    const seen = await documents(ahmed);
    expect(seen).toMatchObject({ canChange: false, documents: [{ fieldKey: "datasheet", fileName: "CoreLine-datasheet.pdf", frozen: true }] });
    const link = (await ahmed.get(`/v1/work-items/${mar}/documents/${seen.documents[0]!.id}/download`)).json().url as string;
    expect(await (await fetch(link)).text()).toBe("%PDF-1.4 Philips CoreLine Panel 600 x 600 datasheet (demo)");
    await expectHidden(yousef.get(`/v1/work-items/${mar}/documents`));
  });

  it("8. Mohammed picks it up and issues Code A; TMC and Al Waha see the Code and its signer", async () => {
    await pickUp(mohammed);
    await verify(mohammed, { sample_checked: true, matches_specification: true });
    await take(mohammed, mar, "approve_a");
    expect(await detail(hafiz, mar)).toMatchObject({ stage: { key: "approved" }, outcome: "A" });
    for (const who of [hafiz, faisal]) {
      const events = (await who.get(`/v1/work-items/${mar}/history`)).json().events;
      expect(events.at(-1)).toMatchObject({ type: "issue_code", by: { memberName: { en: "Mohammed Al Shamsi" } } });
    }
    await hidden(yousef, { countsZero: true });
  });

  it("9. A second MAR ends Revise & Resubmit with Code C", async () => {
    mar = await raise("Cable tray layout – Level 2");
    await attachDatasheet(hafiz, "cable-tray-datasheet.pdf", "%PDF-1.4 Cable tray datasheet (demo)");
    await take(hafiz, mar, "send_for_review");
    await pickUp(ali);
    await take(ali, mar, "submit");
    await pickUp(mohammed);
    await verify(mohammed, { sample_checked: true, matches_specification: false, verification_note: "Wrong datasheet revision" });
    await take(mohammed, mar, "revise_c", { remarks: "Submit the 2020 revision of the datasheet" });
    expect(await detail(hafiz, mar)).toMatchObject({ stage: { key: "revise_resubmit" }, outcome: "C" });
  });

  it("10. Hafiz opens the seeded MAR on Version 4: its Links open the approved MAR, which lists it under Linked from", async () => {
    const linking = (await titled(hafiz, LINKING_TITLE))!;
    const approved = (await titled(hafiz, APPROVED_TITLE))!;
    const seen = await links(hafiz, linking);
    expect(seen.canChange).toBe(false);
    expect(seen.links.map((l) => l.workItemId)).toEqual([approved, approved]);
    expect((await hafiz.get(`/v1/work-items/${approved}`)).statusCode).toBe(200);
    expect((await linkedFrom(hafiz, approved)).items.map((i) => i.workItemId)).toEqual([linking]);
  });

  it("11. Omar opens the same MAR: the approved MAR is a number and a Subject only, and its own page is 404", async () => {
    const linking = (await titled(omar, LINKING_TITLE))!;
    const seen = await links(omar, linking);
    expect(seen.links.every((l) => l.workItemId === null && l.subject === APPROVED_TITLE)).toBe(true);
    await expectHidden(omar.get(`/v1/work-items/${(await titled(hafiz, APPROVED_TITLE))!}`));
  });

  it("12. Hafiz links a new MAR to it under Related submittals; once Submitted, Omar sees it under Linked from as a number and Subject only", async () => {
    const linking = (await titled(hafiz, LINKING_TITLE))!;
    const lightingFixtures = (await titled(hafiz, "Lighting Fixtures"))!;
    // Link search finds it by part of its Subject.
    const found = (await hafiz.get(`/v1/projects/${projectId}/work-items/link-search?q=${encodeURIComponent("control panel")}`)).json();
    expect(found.links.map((l: { id: string }) => l.id)).toContain(linking);
    mar = await raise("Lighting control wiring – Tower 1", { ...filled(), related_submittals: [linking] });
    // And a free Link, from the Links section, to the MAR approved in step 8.
    const free = await hafiz.post(`/v1/work-items/${mar}/links`, { workItemId: lightingFixtures });
    expect(free.statusCode, free.body).toBe(201);
    await attachDatasheet(hafiz, "wiring-datasheet.pdf", "%PDF-1.4 Lighting control wiring datasheet (demo)");
    await take(hafiz, mar, "send_for_review");
    // In TMC's internal review it isn't listed yet, whoever asks.
    expect((await linkedFrom(hafiz, linking)).items).toEqual([]);
    expect((await linkedFrom(omar, linking)).items).toEqual([]);
    await pickUp(ali);
    await take(ali, mar, "submit");
    const documentNumber = (await detail(hafiz, mar)).documentNumber;
    const subject = "Lighting control wiring – Tower 1";
    expect((await linkedFrom(hafiz, linking)).items).toEqual([{ documentNumber, subject, workItemId: mar }]);
    expect((await linkedFrom(omar, linking)).items).toEqual([{ documentNumber, subject, workItemId: null }]);
    await expectHidden(omar.get(`/v1/work-items/${mar}`));
  });

  it("13. The Consultant verification: empty and marked for the Contractor, filled by the Consultant while the Contractor still sees it empty, then Code C with Remarks", async () => {
    mar = await raise("Lighting control – Tower 2");
    await attachDatasheet(hafiz, "lighting-control-datasheet.pdf", "%PDF-1.4 Lighting control datasheet (demo)");
    // The raiser's Draft on Version 4 (scenario 46): the section is read-only and marked.
    const draft: FormToFill = (await hafiz.get(`/v1/work-items/${mar}/form`)).json();
    expect(draft.versionNo).toBe(4);
    expect(draft.editableSections).not.toContain("consultant_verification");
    expect(draft.filledBy.consultant_verification).toMatchObject({ en: "Consultant", ar: expect.any(String) });
    const refused = await hafiz.request("PUT", `/v1/work-items/${mar}/answers`, { answers: { ...filled(), sample_checked: true } });
    expect(refused.statusCode, refused.body).toBe(409);
    await take(hafiz, mar, "send_for_review");
    await pickUp(ali);
    // Leaving Draft and the Contractor's review never needed the Consultant's answers.
    await take(ali, mar, "submit");
    for (const who of [hafiz, ali, faisal]) {
      const form: FormToFill = (await who.get(`/v1/work-items/${mar}/form`)).json();
      expect(form.filledBy.consultant_verification, "marked").toBeDefined();
      expect(form.editableSections).toEqual([]);
    }
    // Ahmed fills it and saves (Sample checked, and Matches specification: No).
    const consultantForm: FormToFill = (await ahmed.get(`/v1/work-items/${mar}/form`)).json();
    expect(consultantForm.editableSections).toEqual(["consultant_verification"]);
    await verify(ahmed, { sample_checked: true, matches_specification: false });
    expect(await detail(ahmed, mar)).toMatchObject({ answers: { sample_checked: true, matches_specification: false } });
    // The Contractor and Al Waha still read it empty, and see no change.
    for (const who of [hafiz, ali, faisal]) {
      const seen = (await detail(who, mar)).answers;
      expect(seen).not.toHaveProperty("sample_checked");
      expect(seen).not.toHaveProperty("matches_specification");
      const history = (await who.get(`/v1/work-items/${mar}/history`)).json() as WorkItemHistory;
      expect(history.events.filter((e) => e.type === "answers_changed")).toEqual([]);
    }
    // The Code is refused while the verification is incomplete (the note is required for No) ...
    await pickUp(mohammed);
    const incomplete = await mohammed.post(`/v1/work-items/${mar}/transitions`, {
      transition: "revise_c",
      answers: { remarks: "Fix the specification mismatch" },
      confirmed: true,
      idempotencyKey: randomUUID(),
    });
    expect(incomplete.statusCode, incomplete.body).toBe(422);
    expect(incomplete.json()).toMatchObject({ error: "form_incomplete", fields: [{ key: "verification_note", code: "required" }] });
    // ... and, once complete, Code C needs its Remarks.
    await verify(mohammed, { verification_note: "Lamp efficacy is below the specified 110 lm/W" });
    const noRemarks = await mohammed.post(`/v1/work-items/${mar}/transitions`, { transition: "revise_c", answers: {}, confirmed: true, idempotencyKey: randomUUID() });
    expect(noRemarks.statusCode, noRemarks.body).toBe(422);
    await take(mohammed, mar, "revise_c", { remarks: "Replace with 110 lm/W luminaires. / استبدلها بوحدات 110 لومن/واط." });
    // Both Companies now read the answers and the Remarks (scenario 48).
    for (const who of [hafiz, faisal]) {
      expect(await detail(who, mar)).toMatchObject({
        stage: { key: "revise_resubmit" },
        outcome: "C",
        answers: { sample_checked: true, matches_specification: false, verification_note: "Lamp efficacy is below the specified 110 lm/W" },
      });
      const history = (await who.get(`/v1/work-items/${mar}/history`)).json() as WorkItemHistory;
      expect(history.events.at(-1)).toMatchObject({ type: "issue_code", remarks: "Replace with 110 lm/W luminaires. / استبدلها بوحدات 110 لومن/واط." });
    }
    await hidden(yousef, { countsZero: true });
  });

  it("14. Hafiz creates Rev 1 of it: his drop-down lists the original and the Draft; the Consultant and Al Waha see only the original", async () => {
    const original = mar;
    const base = (await detail(hafiz, mar)).documentNumber!;
    const created = await hafiz.post(`/v1/work-items/${original}/revisions`, { idempotencyKey: randomUUID() });
    expect(created.statusCode, created.body).toBe(201);
    const rev1 = created.json().id as string;
    const chain = async (who: Caller, id: string) => ((await who.get(`/v1/work-items/${id}/revisions`)).json() as RevisionChain).revisions;
    expect(await chain(hafiz, rev1)).toEqual([
      { id: original, documentNumber: base, revisionNo: 0 },
      { id: rev1, documentNumber: null, revisionNo: 1 },
    ]);
    for (const who of [mohammed, faisal]) {
      expect(await chain(who, original)).toEqual([{ id: original, documentNumber: base, revisionNo: 0 }]);
      expect((await links(who, original)).links).toEqual([]);
      await expectHidden(who.get(`/v1/work-items/${rev1}`));
    }
  });

  it("15. The seeded Code C MAR shows both Companies the verification and its Remarks, in English and Arabic", async () => {
    const id = (await codeCChain())[0]!.id;
    for (const who of [hafiz, ali, faisal, ahmed, mohammed]) {
      const item: WorkItemDetail = (await who.get(`/v1/work-items/${id}`)).json();
      expect(item).toMatchObject({
        stage: { key: "revise_resubmit" },
        outcome: "C",
        answers: { sample_checked: true, matches_specification: false, verification_note: expect.stringMatching(/electro-zinc.*[\u0600-\u06FF]/s) },
      });
      const history = (await who.get(`/v1/work-items/${id}/history`)).json() as WorkItemHistory;
      expect(history.events.at(-1)).toMatchObject({ type: "issue_code", remarks: expect.stringMatching(/EN ISO 1461.*[\u0600-\u06FF]/s) });
    }
    await expectHidden(yousef.get(`/v1/work-items/${id}`));
  });

  it("15. Its Rev 1, Submitted by TMC, reaches the Consultant, whose Revision drop-down lists the original and Rev 1", async () => {
    const [original, rev1] = await codeCChain();
    const base = (await (await mohammed.get(`/v1/work-items/${original!.id}`)).json()).documentNumber as string;
    expect(rev1).toEqual({ id: expect.any(String), documentNumber: `${base} Rev 1`, revisionNo: 1 });
    for (const who of [hafiz, ali, ahmed, mohammed, faisal]) {
      const chain = (await who.get(`/v1/work-items/${rev1!.id}/revisions`)).json() as RevisionChain;
      expect(chain.revisions).toEqual([original, rev1]);
    }
    const revision: WorkItemDetail = (await mohammed.get(`/v1/work-items/${rev1!.id}`)).json();
    expect(revision).toMatchObject({ stage: { key: "pending_approval" }, outcome: null, answers: { model: expect.stringMatching(/HDG/) } });
    expect(revision.answers).not.toHaveProperty("verification_note");
    await expectHidden(yousef.get(`/v1/work-items/${rev1!.id}/revisions`));
  });
});

// The deploy's visibility check (RP-213) asks exactly this of dev, through the
// load balancer (packages/infra/src/smoke.ts).
describe("a second Project: Beta Build's Jeddah Corniche Villas, which no other demo Company is on", () => {
  let nasser: Caller;
  let jcv = "";
  let jcvItem = "";
  let twrItem = "";

  beforeAll(async () => {
    nasser = await signIn("nasser");
    const projects = (await nasser.get("/v1/projects")).json().projects as { id: string; code: string }[];
    expect(projects.map((p) => p.code)).toEqual(["JCV"]);
    jcv = projects[0]!.id;
    const items = (await nasser.get(`/v1/projects/${jcv}/work-items`)).json().items as { id: string }[];
    expect(items).toHaveLength(1);
    jcvItem = items[0]!.id;
    // The seed gives Riyadh Gate Tower one Draft of its own, so a fresh demo has an item to check.
    const twrItems = (await hafiz.get(`/v1/projects/${projectId}/work-items`)).json().items as { id: string; title: string }[];
    twrItem = twrItems.find((i) => i.title === "Emergency lighting – Tower 2")!.id;
    expect(twrItem).toBeDefined();
  });

  it("Hafiz (Riyadh Gate Tower) gets 404 on it and on its Work Item, and never sees it listed", async () => {
    expect((await hafiz.get("/v1/projects")).json().projects.map((p: { code: string }) => p.code)).not.toContain("JCV");
    await expectHidden(hafiz.get(`/v1/projects/${jcv}`));
    await expectHidden(hafiz.get(`/v1/projects/${jcv}/work-items`));
    await expectHidden(hafiz.get(`/v1/work-items/${jcvItem}`));
  });

  it("Nasser (Jeddah Corniche Villas) gets 404 on Riyadh Gate Tower and its Work Items", async () => {
    await expectHidden(nasser.get(`/v1/projects/${projectId}`));
    await expectHidden(nasser.get(`/v1/projects/${projectId}/work-items`));
    await expectHidden(nasser.get(`/v1/work-items/${twrItem}`));
  });
});
