// Seam 1: the grouped notification of a Package Submit (RP-643; spec RP-616, stories 17
// and 18; visibility.md scenario RP-588-2, its notification part). The Members a Submit
// Package reaches get one `package_submitted` notification each, instead of one "Step
// reached" per submittal, saying how many of its submittals they see; delivered and
// routed like any other notification (in-app, email or digest, mute, send-time checks).
import { randomUUID } from "node:crypto";
import { createDb, notificationDigestHandler, notificationEmailHandler } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import type { Notification, NotificationDigest, NotificationEmail, NotificationList, NotificationSettingsView, VisibilityGrant } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Caller } from "./support/harness.ts";
import { createTestApi } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, buildTower, memberOnProject, ok, only, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const urls = testDatabaseUrls();
// The worker connects as the app role, with no Member set.
const worker = createDb(urls.app, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

// A submittal Type on the test Workflow: Submit goes to K1's Consultant review pool.
const TYPE = "PKGNT";
const schema = {
  sections: [
    { key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] },
    {
      key: "classification",
      title: bilingual("Classification"),
      fields: [
        { key: "trade", type: "trade", label: bilingual("Trade") },
        { key: "location", type: "location", label: bilingual("Location") },
        { key: "scopes", type: "scopes", label: bilingual("Scopes") },
      ],
    },
  ],
};

type Member = { id: string; caller: Caller; email: string };

let at: Tower;
let c1Name: { en: string; ar: string };
let c1: Company;
let k1: Company;
let k1ParticipantId = "";
let k1All: Member; // A K1 engineer who sees every Trade.
let k1Electrical: Member; // A K1 engineer narrowed to Electrical.

const name = (text: string) => ({ en: text, ar: `${text} ع` });

/** A submittal of `trade` at C1's internal review, picked up by C1's PM: ready for them to Submit. */
async function readyForPm(title: string, trade: string): Promise<string> {
  const res = await ok(
    at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, { type: TYPE, title, answers: { model: title, trade, location: at.buildingA } }),
    201,
  );
  const id = res.json().id as string;
  await take(at.c1Engineer, id, "send_for_review");
  await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
  return id;
}

/** C1's PM builds Package `text` of `electrical` Electrical and `mechanical` Mechanical submittals, ready to Submit. */
async function packageOf(text: string, electrical: number, mechanical: number): Promise<{ id: string; number: string; items: string[] }> {
  const pkg = (await ok(at.c1Pm.post(`/v1/projects/${at.projectId}/packages`, { name: name(text) }), 201)).json();
  const items: string[] = [];
  for (let i = 1; i <= electrical + mechanical; i++) {
    const id = await readyForPm(`${text} ${i}`, i <= electrical ? at.electrical : at.mechanical);
    await ok(at.c1Pm.post(`/v1/packages/${pkg.id}/items`, { workItemId: id }));
    items.push(id);
  }
  return { id: pkg.id, number: pkg.number, items };
}

const submitPackage = (id: string) => ok(at.c1Pm.post(`/v1/packages/${id}/submit`, { confirmed: true, idempotencyKey: randomUUID() }), 200);

async function notifications(by: Member): Promise<Notification[]> {
  const res = await by.caller.get("/v1/notifications");
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as NotificationList).notifications;
}

/** `by` takes "Step reached" (the group a package notification follows) by `email`. */
async function saveStepReached(by: Member, email: "immediate" | "digest") {
  const now = (await ok(by.caller.get("/v1/notification-settings"), 200)).json() as NotificationSettingsView;
  await ok(
    by.caller.request("PUT", "/v1/notification-settings", {
      settings: { ...now.settings, step_reached: { email } },
      emailPaused: now.emailPaused,
      preferredLanguage: now.preferredLanguage,
    }),
  );
}

/** K1's Authorized Person sets `by`'s Trades on the Project (every Location). */
const setTrade = (by: Member, trade: VisibilityGrant) =>
  ok(k1.caller.request("PUT", `/v1/participants/${k1ParticipantId}/members/${by.id}/visibility`, { trade, location: all }));

/** `by`'s notifications of Package `id`. */
const ofPackage = async (by: Member, id: string) => (await notifications(by)).filter((n) => n.kind === "package_submitted" && n.package.id === id);
/** `by`'s notifications about any of `items`. */
const aboutItems = async (by: Member, items: string[]) =>
  (await notifications(by)).filter((n) => n.kind !== "package_submitted" && items.includes(n.workItemId));

beforeAll(async () => {
  await addSendBackType(migrator, TYPE, { en: "Package notification submittal", ar: "اعتماد إشعار الحزمة" }, schema);
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "TWN");
  c1Name = (await sql<{ legal_name: { en: string; ar: string } }>`select legal_name from company where id = ${c1.company.companyId}::uuid`.execute(migrator))
    .rows[0]!.legal_name;
  k1ParticipantId = (await c1.caller.get(`/v1/projects/${at.projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => !p.isOwnCompany).id;
  k1All = await memberOnProject(api, k1, k1ParticipantId, ["engineer"]);
  k1Electrical = await memberOnProject(api, k1, k1ParticipantId, ["engineer"], { trade: only(at.electrical) });
  // Anything earlier test files left in the outbox is not ours to judge.
  await drainOutbox(worker);
});

describe("scenario RP-588-2 (RP-643: notification): one notification per Member for a Package Submit, counting the items whose Step reached them that they still see", () => {
  it("K1's engineer who sees everything hears of 8, the one narrowed to Electrical of 6; neither gets a Step reached per submittal", async () => {
    const pkg = await packageOf("Bathrooms – Tower 1", 6, 2);
    await submitPackage(pkg.id);
    await drainOutbox(worker);

    const all = await ofPackage(k1All, pkg.id);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      kind: "package_submitted",
      package: { id: pkg.id, number: pkg.number, name: name("Bathrooms – Tower 1"), count: 8 },
      readAt: null,
    });
    const electrical = await ofPackage(k1Electrical, pkg.id);
    expect(electrical).toHaveLength(1);
    expect(electrical[0]).toMatchObject({ package: { number: pkg.number, count: 6 } });
    for (const by of [k1All, k1Electrical]) expect(await aboutItems(by, pkg.items)).toEqual([]);
    // C1 is named by its Company only (V14).
    expect(all[0]).toMatchObject({ package: { companyName: c1Name } });
  });
});

describe("a Package Submit's notification", () => {
  it("leaves a single Submit of an item added later notifying as today: one Step reached, no package notification", async () => {
    const pkg = await packageOf("Doors", 2, 0);
    await submitPackage(pkg.id);
    await drainOutbox(worker);
    const later = await readyForPm("Doors, forgotten one", at.electrical);
    await ok(at.c1Pm.post(`/v1/packages/${pkg.id}/items`, { workItemId: later }));
    await take(at.c1Pm, later, "submit");
    await drainOutbox(worker);
    expect(await ofPackage(k1All, pkg.id)).toHaveLength(1);
    expect((await aboutItems(k1All, [later])).map((n) => n.kind)).toEqual(["step_reached"]);
  });

  it("is withdrawn once colleagues have picked up every one of its submittals, as a Step reached is", async () => {
    const pkg = await packageOf("Lighting", 2, 1);
    await submitPackage(pkg.id);
    await drainOutbox(worker);
    const [first, second] = pkg.items as [string, string];
    await ok(k1All.caller.post(`/v1/work-items/${first}/pick-up`));
    expect(await ofPackage(k1Electrical, pkg.id)).toHaveLength(1);
    await ok(k1All.caller.post(`/v1/work-items/${second}/pick-up`));
    // Nothing of it waits on the Electrical engineer any more.
    expect(await ofPackage(k1Electrical, pkg.id)).toEqual([]);
    // The colleague's own stays: two are theirs, one still in the pool.
    expect(await ofPackage(k1All, pkg.id)).toMatchObject([{ package: { count: 3 } }]);
  });

  it("is emailed and digested as a Step reached is, with the count of the items that reached the recipient and they still see", async () => {
    const emails: NotificationEmail[] = [];
    const digests: NotificationDigest[] = [];
    const handlers = {
      email: notificationEmailHandler(async (e) => void emails.push(e)),
      digest: notificationDigestHandler(async (d) => void digests.push(d)),
    };
    // The Electrical engineer takes "Step reached" in the daily digest; the other emails at once (the default).
    await saveStepReached(k1Electrical, "digest");
    const pkg = await packageOf("Switchgear", 2, 1);
    await submitPackage(pkg.id);
    await drainOutbox(worker, handlers);

    const immediate = emails.filter((e) => e.to === k1All.email);
    expect(immediate).toHaveLength(1);
    expect(immediate[0]).toMatchObject({
      kind: "package_submitted",
      content: { workItemId: null, documentNumber: null, package: { id: pkg.id, number: pkg.number, count: 3, companyName: c1Name } },
    });
    expect(emails.filter((e) => e.to === k1Electrical.email)).toEqual([]);

    await sql`select app.enqueue_notification_digests()`.execute(worker);
    await drainOutbox(worker, handlers);
    const entries = digests
      .filter((d) => d.to === k1Electrical.email)
      .flatMap((d) => d.projects.flatMap((p) => p.items))
      .filter((i) => i.packageId === pkg.id);
    expect(entries).toHaveLength(1);
    // C1 by its Company name only (V14), as in the bell and the immediate email.
    expect(entries[0]).toMatchObject({
      workItemId: null,
      documentNumber: null,
      packageNumber: pkg.number,
      entries: [{ kind: "package_submitted", package: { count: 2, companyName: c1Name } }],
    });
    await saveStepReached(k1Electrical, "immediate");
  });

  it("RP-588-2: narrowed between delivery and the send, the email counts what its recipient sees at send time", async () => {
    const emails: NotificationEmail[] = [];
    const send = notificationEmailHandler(async (e) => void emails.push(e));
    const pkg = await packageOf("Busbars", 2, 1);
    await submitPackage(pkg.id);
    // Delivered as K1's engineer who sees everything sees it (3); narrowed to Electrical before the email goes.
    let narrowed = false;
    await drainOutbox(worker, {
      email: async (trx, row) => {
        if (!narrowed) {
          narrowed = true;
          await setTrade(k1All, only(at.electrical));
        }
        await send(trx, row);
      },
    });
    expect(narrowed).toBe(true);
    try {
      const toAll = emails.filter((e) => e.to === k1All.email && e.content.package?.id === pkg.id);
      expect(toAll).toEqual([expect.objectContaining({ kind: "package_submitted", content: expect.objectContaining({ package: expect.objectContaining({ count: 2, companyName: c1Name }) }) })]);
    } finally {
      await setTrade(k1All, all);
    }
  });

  it("RP-588-2: a Member narrowed off every one of its items no longer has it in the bell, nor its email", async () => {
    const pkg = await packageOf("Cable glands", 2, 0);
    await submitPackage(pkg.id);
    await drainOutbox(worker);
    expect(await ofPackage(k1Electrical, pkg.id)).toHaveLength(1);
    await setTrade(k1Electrical, only(at.mechanical));
    try {
      expect(await ofPackage(k1Electrical, pkg.id)).toEqual([]);
      expect(JSON.stringify((await k1Electrical.caller.get("/v1/notifications")).json())).not.toContain(pkg.id);
    } finally {
      await setTrade(k1Electrical, only(at.electrical));
    }
    expect(await ofPackage(k1Electrical, pkg.id)).toHaveLength(1);
  });

  it("RP-588-2: one Member never reads another Member's, nor marks it read", async () => {
    const pkg = await packageOf("Trunking", 1, 0);
    await submitPackage(pkg.id);
    await drainOutbox(worker);
    const [theirs] = await ofPackage(k1All, pkg.id);
    const [mine] = await ofPackage(k1Electrical, pkg.id);
    expect(theirs!.id).not.toBe(mine!.id);
    expect((await notifications(k1Electrical)).map((n) => n.id)).not.toContain(theirs!.id);
    // Neither C1 nor any other Company's Member gets one.
    expect(JSON.stringify((await at.c1Pm.get("/v1/notifications")).json())).not.toContain(pkg.id);
    expect(JSON.stringify((await at.k1Manager.get("/v1/notifications")).json())).not.toContain(theirs!.id);
    // Another Member's id marks nothing of theirs.
    await ok(k1Electrical.caller.post("/v1/notifications/read", { ids: [theirs!.id] }));
    expect((await ofPackage(k1All, pkg.id))[0]!.readAt).toBeNull();
    await ok(k1All.caller.post("/v1/notifications/read", { ids: [theirs!.id] }));
    expect((await ofPackage(k1All, pkg.id))[0]!.readAt).not.toBeNull();
  });

  it("reaches nobody who muted the Project", async () => {
    await ok(k1Electrical.caller.request("PUT", `/v1/projects/${at.projectId}/mute`));
    const pkg = await packageOf("Muted", 1, 0);
    await submitPackage(pkg.id);
    await drainOutbox(worker);
    expect(await ofPackage(k1Electrical, pkg.id)).toEqual([]);
    expect(await ofPackage(k1All, pkg.id)).toHaveLength(1);
    await ok(k1Electrical.caller.request("DELETE", `/v1/projects/${at.projectId}/mute`));
  });
});
