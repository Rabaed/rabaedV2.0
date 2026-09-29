// Seam 1: the demo seed (RP-196). The seed builds "Riyadh Gate Tower – Phase 2"
// through the API; this suite checks what it built and then follows the README
// walkthrough as the demo people: create MAR → Send for Review → Return →
// re-send → Submit → Code A / Code C, with what each Company sees at each step.
import { randomUUID } from "node:crypto";
import { createDb, processOutbox } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkItemDetail } from "@rabaed/domain";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, SESSION_COOKIE } from "../src/app.ts";
import { seedDemo, type DemoSeed } from "../src/demo/seed.ts";
import { testConfig } from "./support/harness.ts";

const urls = testDatabaseUrls();
const db = createDb(urls.app);
const adminDb = createDb(urls.admin, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });
const worker = createDb(urls.app, { max: 1 });
const app: FastifyInstance = await buildApp({ db, adminDb, config: testConfig, logger: false });
afterAll(async () => {
  await app.close();
  await Promise.all([db.destroy(), adminDb.destroy(), migrator.destroy(), worker.destroy()]);
});

const password = `demo-${randomUUID()}`;
let seed: DemoSeed;

type Caller = (method: "GET" | "POST", url: string, body?: unknown) => Promise<LightMyRequestResponse>;

async function signIn(key: string): Promise<Caller> {
  const person = seed.people.find((p) => p.key === key)!;
  const res = await app.inject({ method: "POST", url: "/v1/session", payload: { email: person.email, password } });
  expect(res.statusCode, `${key}: ${res.body}`).toBe(204);
  const token = res.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
  return (method, url, body) =>
    app.inject({
      method,
      url,
      cookies: { [SESSION_COOKIE]: token },
      ...(body === undefined ? {} : { payload: body as object }),
    });
}

let hafiz: Caller; // TMC Contractor Engineer
let ali: Caller; // TMC Contractor PM
let yousef: Caller; // Beta Build (second Contractor)
let ahmed: Caller; // Design Consultants LLC Engineer
let mohammed: Caller; // Design Consultants LLC Manager
let faisal: Caller; // Al Waha PMC (Owner Representative)
let electrical = "";
let tower1Floor2 = "";

beforeAll(async () => {
  seed = await seedDemo(app, migrator, { password, unique: true });
  hafiz = await signIn("tmc-engineer");
  ali = await signIn("tmc-pm");
  yousef = await signIn("beta-engineer");
  ahmed = await signIn("dcl-engineer-ahmed");
  mohammed = await signIn("dcl-manager");
  faisal = await signIn("waha-engineer");
  const dimensions = (await hafiz("GET", `/v1/projects/${seed.projectId}/dimensions`)).json();
  electrical = dimensions.trade.find((v: { code: string }) => v.code === "EL").id;
  tower1Floor2 = dimensions.location.find((v: { code: string }) => v.code === "T1F02").id;
});

describe("the demo seed", () => {
  it("onboards the four Companies through Rabaed Admin, each with a reason in admin_action (scenario 13)", async () => {
    const { rows } = await sql<{ action: string; reason: string; name: string }>`
      select a.action, a.reason, c.legal_name ->> 'en' as name
      from admin_action a
      join rabaed_engineer e on e.id = a.engineer_id
      join company c on c.id = a.target_id
      where e.email = ${seed.engineer.email}
      order by a.at
    `.execute(migrator);
    expect(rows.map((r) => r.name)).toEqual(["TMC Constructions", "Beta Build", "Design Consultants LLC", "Al Waha PMC"]);
    expect(rows.every((r) => r.action === "onboard_company" && r.reason.startsWith("Demo seed:"))).toBe(true);
  });

  it("lets every demo person sign in with the one demo password, and shows each the Project", async () => {
    for (const person of seed.people) {
      const caller = await signIn(person.key);
      const projects = (await caller("GET", "/v1/projects")).json().projects;
      if (person.role === "Authorized Person" && person.company !== "TMC Constructions") continue;
      expect(projects.map((p: { name: { en: string } }) => p.name.en), person.key).toContain("Riyadh Gate Tower – Phase 2");
    }
  });
});

describe("the README walkthrough", () => {
  let mar = "";
  const detail = async (who: Caller): Promise<WorkItemDetail> => {
    const r = await who("GET", `/v1/work-items/${mar}`);
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  };
  const hidden = async (who: Caller) => {
    expect((await who("GET", `/v1/work-items/${mar}`)).statusCode).toBe(404);
    const list = (await who("GET", `/v1/projects/${seed.projectId}/work-items`)).json();
    expect(list.items.map((i: { id: string }) => i.id)).not.toContain(mar);
  };
  const take = async (who: Caller, transition: string, reason = "") => {
    const r = await who("POST", `/v1/work-items/${mar}/transitions`, { transition, reason, idempotencyKey: randomUUID() });
    expect(r.statusCode, r.body).toBe(204);
  };
  const claim = async (who: Caller) => expect((await who("POST", `/v1/work-items/${mar}/claim`)).statusCode).toBe(204);

  it("1. Hafiz creates a MAR: a Draft only TMC sees", async () => {
    const r = await hafiz("POST", `/v1/projects/${seed.projectId}/work-items`, {
      type: "MAR",
      title: "Lighting Fixtures",
      tradeId: electrical,
      locationId: tower1Floor2,
      description: "4 fixture types, Zumtobel",
    });
    expect(r.statusCode, r.body).toBe(201);
    mar = r.json().id;
    expect((await detail(ali)).stage.key).toBe("draft");
    for (const who of [yousef, ahmed, mohammed, faisal]) await hidden(who);
  });

  it("2. Send for Review reaches Ali, with a notification; still nobody outside TMC", async () => {
    await take(hafiz, "send_for_review");
    await processOutbox(worker);
    const notifications = (await ali("GET", "/v1/notifications")).json().notifications;
    expect(notifications.map((n: { workItemId: string }) => n.workItemId)).toContain(mar);
    expect((await detail(ali)).documentNumber).toMatch(/^TWR-MAR-01-\d{4}$/);
    for (const who of [yousef, ahmed, mohammed, faisal]) await hidden(who);
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
    expect((await detail(hafiz)).heldBy).toEqual({ companyName: { en: "Design Consultants LLC", ar: "المصممون الاستشاريون ذ.م.م" }, memberName: null });
    expect((await detail(ahmed)).actions.claim).toBe(false);
    expect((await detail(mohammed)).actions.claim).toBe(true);
    expect((await detail(faisal)).stage.key).toBe("pending_approval");
    await hidden(yousef);
    const history = JSON.stringify((await ahmed("GET", `/v1/work-items/${mar}/history`)).json());
    expect(history).not.toContain("Add emergency duration");
  });

  it("6. Mohammed claims it and issues Code A; TMC sees the Code and its signer", async () => {
    await claim(mohammed);
    await take(mohammed, "approve_a");
    const d = await detail(hafiz);
    expect(d).toMatchObject({ stage: { key: "approved" }, outcome: "A" });
    const events = (await hafiz("GET", `/v1/work-items/${mar}/history`)).json().events;
    expect(events.at(-1)).toMatchObject({ type: "issue_code", by: { memberName: { en: "Mohammed Al Shamsi" } } });
    expect((await detail(faisal)).outcome).toBe("A");
    await hidden(yousef);
  });

  it("7. A second MAR ends Revise & Resubmit with Code C", async () => {
    const r = await hafiz("POST", `/v1/projects/${seed.projectId}/work-items`, {
      type: "MAR",
      title: "Cable tray layout – Level 2",
      tradeId: electrical,
      locationId: tower1Floor2,
      description: "",
    });
    mar = r.json().id;
    await take(hafiz, "send_for_review");
    await claim(ali);
    await take(ali, "submit");
    await claim(mohammed);
    await take(mohammed, "revise_c");
    expect(await detail(hafiz)).toMatchObject({ stage: { key: "revise_resubmit" }, outcome: "C" });
  });
});
