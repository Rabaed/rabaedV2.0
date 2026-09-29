// Seam 1: the demo seed (RP-196). The seam suites' global setup seeds the demo
// Project `pnpm demo` builds (test/support/seed-demo.ts); this suite checks what
// it built and follows the README walkthrough as the demo people: create MAR →
// Send for Review → Return → re-send → Submit → Code A / Code C, with what each
// Company sees at each step. Each run adds its own MARs to the one demo Project.
import { randomUUID } from "node:crypto";
import { createDb, processOutbox } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkItemDetail } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_ENGINEER_EMAIL } from "../src/demo/seed.ts";
import { createTestApi, DEFAULT_PASSWORD, type Caller } from "./support/harness.ts";

const api = await createTestApi();
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

describe("the README walkthrough", () => {
  let mar = "";
  const detail = async (who: Caller): Promise<WorkItemDetail> => {
    const r = await who.get(`/v1/work-items/${mar}`);
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  };
  /** Not in the detail, the list, or (for Beta Build, with no items of its own) any count. */
  const hidden = async (who: Caller, { countsZero = false } = {}) => {
    expect((await who.get(`/v1/work-items/${mar}`)).statusCode).toBe(404);
    const list = (await who.get(`/v1/projects/${projectId}/work-items`)).json();
    expect(list.items.map((i: { id: string }) => i.id)).not.toContain(mar);
    if (countsZero) expect(list.stages.every((s: { count: number }) => s.count === 0)).toBe(true);
  };
  const take = async (who: Caller, transition: string, reason = "") => {
    const r = await who.post(`/v1/work-items/${mar}/transitions`, { transition, reason, idempotencyKey: randomUUID() });
    expect(r.statusCode, r.body).toBe(204);
  };
  const claim = async (who: Caller) => expect((await who.post(`/v1/work-items/${mar}/claim`)).statusCode).toBe(204);
  const raise = async (title: string) => {
    const r = await hafiz.post(`/v1/projects/${projectId}/work-items`, {
      type: "MAR",
      title,
      tradeId: electrical,
      locationId: tower1Floor2,
      description: "",
    });
    expect(r.statusCode, r.body).toBe(201);
    return r.json().id as string;
  };

  it("1. Hafiz creates a MAR: a Draft only TMC sees", async () => {
    mar = await raise("Lighting Fixtures");
    expect((await detail(ali)).stage.key).toBe("draft");
    await hidden(yousef, { countsZero: true });
    for (const who of [ahmed, mohammed, faisal]) await hidden(who);
  });

  it("2. Send for Review reaches Ali, with a notification; still nobody outside TMC", async () => {
    await take(hafiz, "send_for_review");
    await processOutbox(worker);
    const notifications = (await ali.get("/v1/notifications")).json().notifications;
    expect(notifications.map((n: { workItemId: string }) => n.workItemId)).toContain(mar);
    expect((await detail(ali)).documentNumber).toMatch(/^TWR-MAR-01-\d{4}$/);
    await hidden(yousef, { countsZero: true });
    for (const who of [ahmed, mohammed, faisal]) await hidden(who);
  });

  it("3. Ali claims and Returns it with a reason; 4. Hafiz re-sends it", async () => {
    await claim(ali);
    await take(ali, "return", "Add emergency duration");
    expect((await detail(hafiz)).stage.key).toBe("draft");
    await take(hafiz, "send_for_review");
    await claim(ali);
  });

  it("5. Ali Submits it: With Design Consultants LLC; the Consultant and Al Waha see it, Beta Build never does", async () => {
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

  it("6. Mohammed claims it and issues Code A; TMC and Al Waha see the Code and its signer", async () => {
    await claim(mohammed);
    await take(mohammed, "approve_a");
    expect(await detail(hafiz)).toMatchObject({ stage: { key: "approved" }, outcome: "A" });
    for (const who of [hafiz, faisal]) {
      const events = (await who.get(`/v1/work-items/${mar}/history`)).json().events;
      expect(events.at(-1)).toMatchObject({ type: "issue_code", by: { memberName: { en: "Mohammed Al Shamsi" } } });
    }
    await hidden(yousef, { countsZero: true });
  });

  it("7. A second MAR ends Revise & Resubmit with Code C", async () => {
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
    const created = await hafiz.post(`/v1/projects/${projectId}/work-items`, { type: "MAR", title: "Cross-project check", tradeId: electrical });
    expect(created.statusCode, created.body).toBe(201);
    twrItem = created.json().id;
  });

  it("Hafiz (Riyadh Gate Tower) gets 404 on it and on its Work Item, and never sees it listed", async () => {
    expect((await hafiz.get("/v1/projects")).json().projects.map((p: { code: string }) => p.code)).not.toContain("JCV");
    expect((await hafiz.get(`/v1/projects/${jcv}`)).statusCode).toBe(404);
    expect((await hafiz.get(`/v1/projects/${jcv}/work-items`)).statusCode).toBe(404);
    expect((await hafiz.get(`/v1/work-items/${jcvItem}`)).statusCode).toBe(404);
  });

  it("Nasser (Jeddah Corniche Villas) gets 404 on Riyadh Gate Tower and its Work Items", async () => {
    expect((await nasser.get(`/v1/projects/${projectId}`)).statusCode).toBe(404);
    expect((await nasser.get(`/v1/projects/${projectId}/work-items`)).statusCode).toBe(404);
    expect((await nasser.get(`/v1/work-items/${twrItem}`)).statusCode).toBe(404);
  });
});
