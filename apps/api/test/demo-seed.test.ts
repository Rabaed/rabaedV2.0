// Seam 1: the demo seed (RP-196). The seam suites' global setup seeds the demo
// Project `pnpm demo` builds (test/support/seed-demo.ts); this suite checks what
// it built and follows the README walkthrough as the demo people: create MAR →
// Send for Review → Return → re-send → Submit → Code A / Code C, with what each
// Company sees at each step. Each run adds its own MARs to the one demo Project.
import { randomUUID } from "node:crypto";
import { createDb, processOutbox } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { DocumentList, FormVersion, StartedDocumentUpload, WorkItemDetail } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_ENGINEER_EMAIL } from "../src/demo/seed.ts";
import { createTestApi, expectHidden, DEFAULT_PASSWORD, type Caller } from "./support/harness.ts";

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
} as const;
type Who = keyof typeof demo;
const signIn = (who: Who) => api.signIn(demo[who], DEFAULT_PASSWORD);

let hafiz: Caller; // TMC Contractor Engineer
let ali: Caller; // TMC Contractor PM
let yousef: Caller; // Beta Build (second Contractor)
let ahmed: Caller; // Design Consultants LLC Engineer
let mohammed: Caller; // Design Consultants LLC Manager
let faisal: Caller; // Al Waha PMC (Owner Representative)
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

describe("the MAR Form Version 1, as the demo uses it", () => {
  it("lists every field of Version 1, labelled in English and Arabic, with the quantity as a number with its unit", async () => {
    const form: FormVersion = (await hafiz.get(`/v1/projects/${projectId}/work-item-types/MAR/form`)).json();
    expect(form.versionNo).toBe(1);
    const fields = form.schema.sections.flatMap((s) => s.fields).filter((f) => "label" in f);
    expect(fields.map((f) => [f.key, f.type])).toEqual([
      ["manufacturer", "text"],
      ["model", "text"],
      ["quantity", "number"],
      ["specification_section", "text"],
      ["trade", "trade"],
      ["location", "location"],
      ["scopes", "scopes"],
      ["description", "textarea"],
    ]);
    for (const f of fields) {
      expect("label" in f && f.label.en && f.label.ar, f.key).toBeTruthy();
    }
    expect(fields.find((f) => f.key === "quantity")).toMatchObject({ unit: "pcs" });
  });

  it("is what the seeded Draft is filled through, with an Attachment", async () => {
    const items = (await hafiz.get(`/v1/projects/${projectId}/work-items`)).json().items as { id: string; title: string }[];
    const id = items.find((i) => i.title === "Emergency lighting – Tower 2")!.id;
    const item: WorkItemDetail = (await hafiz.get(`/v1/work-items/${id}`)).json();
    expect(item.answers).toMatchObject({
      manufacturer: "Zumtobel",
      model: "RESCLITE PRO",
      quantity: 48,
      specification_section: "26 52 13",
      description: expect.any(String),
      trade: electrical,
    });
    expect((await hafiz.get(`/v1/work-items/${id}/documents`)).json()).toMatchObject({
      documents: [{ fileName: "RESCLITE-PRO-datasheet.txt", frozen: false }],
    });
  });
});

describe("the README walkthrough", () => {
  let mar = "";
  const detail = async (who: Caller): Promise<WorkItemDetail> => {
    const r = await who.get(`/v1/work-items/${mar}`);
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  };
  /** Not in the detail, the list, or (for Beta Build, with no items of its own) any count. */
  const hidden = async (who: Caller, { countsZero = false } = {}) => {
    await expectHidden(who.get(`/v1/work-items/${mar}`));
    const list = (await who.get(`/v1/projects/${projectId}/work-items`)).json();
    expect(list.items.map((i: { id: string }) => i.id)).not.toContain(mar);
    if (countsZero) expect(list.stages.every((s: { count: number }) => s.count === 0)).toBe(true);
  };
  const take = async (who: Caller, transition: string, reason = "") => {
    const r = await who.post(`/v1/work-items/${mar}/transitions`, { transition, reason, idempotencyKey: randomUUID() });
    expect(r.statusCode, r.body).toBe(204);
  };
  const claim = async (who: Caller) => expect((await who.post(`/v1/work-items/${mar}/claim`)).statusCode).toBe(204);
  // The Form of a complete MAR; a function, as the Trade and Location ids come from beforeAll.
  const filled = () => ({
    manufacturer: "Philips",
    model: "CoreLine Panel",
    quantity: 240,
    specification_section: "26 51 00",
    description: "LED panel fixtures, 600 × 600",
    trade: electrical,
    location: tower1Floor2,
  });
  const raise = async (title: string, answers: Record<string, unknown> = filled()) => {
    const r = await hafiz.post(`/v1/projects/${projectId}/work-items`, { type: "MAR", title, answers });
    expect(r.statusCode, r.body).toBe(201);
    return r.json().id as string;
  };
  /** Uploads a file to the item's Attachments, as the browser does: a signed URL, the file, then the API told. */
  const attach = async (who: Caller, fileName: string, body: string) => {
    const documents = `/v1/work-items/${mar}/documents`;
    const started: StartedDocumentUpload = (await who.post(documents, { fileName, contentType: "text/plain", sizeBytes: body.length })).json();
    const stored = await fetch(started.upload.url, { method: started.upload.method, headers: started.upload.headers, body });
    expect(stored.status).toBe(200);
    expect((await who.post(`${documents}/${started.id}/confirm`)).statusCode).toBe(204);
  };
  const documents = async (who: Caller): Promise<DocumentList> => (await who.get(`/v1/work-items/${mar}/documents`)).json();

  it("1. Hafiz creates a MAR with the Form half filled: a Draft only TMC sees", async () => {
    mar = await raise("Lighting Fixtures", { manufacturer: "Philips", trade: electrical, location: tower1Floor2 });
    expect((await detail(ali)).stage.key).toBe("draft");
    await hidden(yousef, { countsZero: true });
    for (const who of [ahmed, mohammed, faisal]) await hidden(who);
  });

  it("2. Send for Review is refused while the Form is incomplete, with the list of what is missing", async () => {
    const r = await hafiz.post(`/v1/work-items/${mar}/transitions`, { transition: "send_for_review", reason: "", idempotencyKey: randomUUID() });
    expect(r.statusCode, r.body).toBe(422);
    expect(r.json()).toEqual({ error: "form_incomplete", fields: [{ key: "description", code: "required" }] });
    expect((await detail(hafiz)).stage.key).toBe("draft");
  });

  it("3. Hafiz completes the Form with a quantity and a datasheet, and Saves the Draft", async () => {
    const saved = await hafiz.request("PUT", `/v1/work-items/${mar}/answers`, { answers: filled() });
    expect(saved.statusCode, saved.body).toBe(204);
    await attach(hafiz, "CoreLine-datasheet.txt", "Philips CoreLine Panel 600 x 600 datasheet (demo)");
    expect((await detail(hafiz)).answers).toMatchObject(filled());
    expect((await documents(hafiz)).documents.map((d) => d.fileName)).toEqual(["CoreLine-datasheet.txt"]);
    await hidden(yousef, { countsZero: true });
  });

  it("3. Sent for Review, it reaches Ali, with a notification; still nobody outside TMC", async () => {
    await take(hafiz, "send_for_review");
    await processOutbox(worker);
    const notifications = (await ali.get("/v1/notifications")).json().notifications;
    expect(notifications.map((n: { workItemId: string }) => n.workItemId)).toContain(mar);
    expect((await detail(ali)).documentNumber).toMatch(/^TWR-MAR-01-\d{4}$/);
    await hidden(yousef, { countsZero: true });
    for (const who of [ahmed, mohammed, faisal]) await hidden(who);
  });

  it("4. Ali claims and Returns it with a reason; 5. Hafiz re-sends it", async () => {
    await claim(ali);
    await take(ali, "return", "Add emergency duration");
    expect((await detail(hafiz)).stage.key).toBe("draft");
    await take(hafiz, "send_for_review");
    await claim(ali);
  });

  it("6. Ali Submits it: With Design Consultants LLC; the Consultant and Al Waha see it, Beta Build never does", async () => {
    await take(ali, "submit");
    expect((await detail(hafiz)).heldBy).toEqual({
      companyName: { en: "Design Consultants LLC", ar: "المصممون الاستشاريون ذ.م.م" },
      memberName: null,
    });
    expect((await detail(ahmed)).actions).toMatchObject({ claim: false, transitions: [] });
    expect((await detail(mohammed)).actions.claim).toBe(true);
    expect((await detail(faisal)).stage.key).toBe("pending_approval");
    await hidden(yousef, { countsZero: true });
    expect((await ahmed.get(`/v1/work-items/${mar}/history`)).body).not.toContain("Add emergency duration");
  });

  it("7. The Consultant reads the Form's answers and the frozen Attachments; the other Contractor still sees nothing", async () => {
    expect((await detail(ahmed)).answers).toMatchObject(filled());
    const seen = await documents(ahmed);
    expect(seen).toMatchObject({ canChange: false, documents: [{ fileName: "CoreLine-datasheet.txt", frozen: true }] });
    const link = (await ahmed.get(`/v1/work-items/${mar}/documents/${seen.documents[0]!.id}/download`)).json().url as string;
    expect(await (await fetch(link)).text()).toBe("Philips CoreLine Panel 600 x 600 datasheet (demo)");
    await expectHidden(yousef.get(`/v1/work-items/${mar}/documents`));
  });

  it("8. Mohammed claims it and issues Code A; TMC and Al Waha see the Code and its signer", async () => {
    await claim(mohammed);
    await take(mohammed, "approve_a");
    expect(await detail(hafiz)).toMatchObject({ stage: { key: "approved" }, outcome: "A" });
    for (const who of [hafiz, faisal]) {
      const events = (await who.get(`/v1/work-items/${mar}/history`)).json().events;
      expect(events.at(-1)).toMatchObject({ type: "issue_code", by: { memberName: { en: "Mohammed Al Shamsi" } } });
    }
    await hidden(yousef, { countsZero: true });
  });

  it("9. A second MAR ends Revise & Resubmit with Code C", async () => {
    mar = await raise("Cable tray layout – Level 2");
    await take(hafiz, "send_for_review");
    await claim(ali);
    await take(ali, "submit");
    await claim(mohammed);
    await take(mohammed, "revise_c");
    expect(await detail(hafiz)).toMatchObject({ stage: { key: "revise_resubmit" }, outcome: "C" });
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
