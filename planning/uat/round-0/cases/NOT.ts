import type { Page } from "playwright";
import { pageAs } from "../harness/browser.ts";
import { defineCase } from "../harness/case.ts";
import { Api, go, settle } from "../harness/helpers.ts";
import {
  apis,
  DCL_PEOPLE,
  emailOf,
  mailFull,
  mailsAbout,
  makeMar,
  marContext,
  mustPickUp,
  mustTake,
  notificationsFor,
  toManager,
  toSubmitted,
  tracker,
  until,
  ARABIC_INDIC,
  TMC_PEOPLE,
  issueCode,
} from "../harness/helpers-not.ts";

// Part NOT: notifications, the bell, emails (Mailpit), settings. Every case makes its own items
// ("UAT NOT-nn ..."), and a case that changes a person's notification settings restores them.

type Settings = {
  settings: Record<string, { email: string; outcomes?: string[] }>;
  emailPaused: boolean;
  preferredLanguage: string;
  receivesWeeklyReport: boolean;
  projects: { id: string; code: string; muted: boolean }[];
};

const stamp = () => new Date().toISOString().slice(11, 19).replaceAll(":", "");

async function readSettings(api: Api): Promise<Settings> {
  return (await api.get("/notification-settings")).body as Settings;
}

async function restoreSettings(api: Api, before: Settings): Promise<void> {
  await api.put("/notification-settings", { settings: before.settings, emailPaused: before.emailPaused, preferredLanguage: before.preferredLanguage });
  for (const p of before.projects) await api.request(p.muted ? "PUT" : "DELETE", `/projects/${p.id}/mute`);
}

async function bellCount(page: Page): Promise<number> {
  const name = (await page.getByRole("link", { name: /^Notifications/ }).first().getAttribute("aria-label")) ?? "";
  return Number(/(\d+)\s+unread/.exec(name)?.[1] ?? 0);
}

/** Waits until `who` has a notification about item `id`. */
const waitBell = (who: Api, id: string, ms = 40_000) => until(async () => ((await notificationsFor(who, id)).length > 0 ? true : false), ms, 1500);

defineCase("NOT-01", async (t) => {
  const c = tracker(t);
  const { hafiz, ali } = await apis("hafiz", "ali");
  const ctx = await marContext(hafiz);
  const title = `UAT NOT-01 bell ${stamp()}`;
  const id = await makeMar(hafiz, ctx, title);
  await mustTake(hafiz, id, "send_for_review");
  c.check("Ali's bell gets an entry for the item Hafiz sent him", !!(await waitBell(ali, id)));

  const { page } = await pageAs("ali");
  await go(page, "/");
  await settle(page);
  const badge = await bellCount(page);
  const api = ((await ali.get("/notifications")).body as { unread: number }).unread;
  c.check("the bell badge counts the unread entries", badge > 0 && Math.abs(badge - api) <= 8, `badge ${badge}, api ${api} (others work on the lane at the same time)`);
  await t.shot(page, "home-with-bell-badge");

  await go(page, "/notifications");
  await settle(page);
  const row = page.getByRole("main").locator("li").filter({ hasText: title }).first();
  const rowText = (await row.innerText()).replace(/\s+/g, " ");
  c.check("the entry reads 'Reached you at <Step>'", /Reached you at Contractor PM/.test(rowText), rowText);
  c.check("the entry shows the Document Number", /TWR-MAR-01-\d{4}/.test(rowText), rowText);
  await t.shot(page, "notifications-page");
  await row.getByRole("link").first().click();
  await page.waitForURL(/\/work-items\/[0-9a-f-]{36}/);
  c.check("opening the entry opens the item", page.url().includes(id), page.url());

  await go(page, "/notifications");
  await settle(page);
  const before = await bellCount(page);
  await page.getByRole("button", { name: "Mark all as read" }).click();
  const cleared = await until(async () => ((await bellCount(page).catch(() => 99)) <= 3 ? true : false), 8000, 800);
  await page.reload({ waitUntil: "networkidle" });
  const after = await bellCount(page);
  const mine = (await notificationsFor(ali, id))[0];
  c.check("Mark all as read clears the badge", after <= 3 || !!cleared, `before ${before}, after ${after}; entries arriving from other tests can add a few`);
  c.check("the entry itself is read", !!mine?.readAt, String(mine?.readAt));
  await t.shot(page, "after-mark-all-as-read");

  await go(page, "/profile");
  await settle(page);
  const profile = (await page.getByRole("main").innerText()).replace(/\s+/g, " ");
  c.check("there is no in-app switch (settings are email only)", !/in-app|in app/i.test(profile) && /Email/.test(profile));
});

defineCase("NOT-02", async (t) => {
  const c = tracker(t);
  const { hafiz, ali, ahmed, sara, mohammed } = await apis("hafiz", "ali", "ahmed", "sara", "mohammed");
  const ctx = await marContext(hafiz);
  const title = `UAT NOT-02 pool ${stamp()}`;
  const id = await makeMar(hafiz, ctx, title);
  await mustTake(hafiz, id, "send_for_review");
  await mustPickUp(ali, id);
  await mustTake(ali, id, "submit", { answers: { cover_note: "UAT NOT-02" } });
  c.check("Ahmed (the Consultant Engineer pool) is told", !!(await waitBell(ahmed, id)));
  await new Promise((r) => setTimeout(r, 6000));
  const [a, s, m] = await Promise.all([notificationsFor(ahmed, id), notificationsFor(sara, id), notificationsFor(mohammed, id)]);
  c.check("Ahmed's entry is a Step reached notice", a.some((n) => n.kind === "step_reached"), JSON.stringify(a.map((n) => n.kind)));
  c.check("Mohammed is not told before it reaches him", m.length === 0, JSON.stringify(m.map((n) => n.kind)));
  // FX-K1M narrowed Sara to Mechanical only: she does not see an Electrical item, so she is rightly not in the pool.
  const saraSees = (await sara.get(`/work-items/${id}`)).status === 200;
  c.check("Sara is told exactly when she sees the item (FX-K1M made her Mechanical only, this one is Electrical)", saraSees ? s.length > 0 : s.length === 0, `sees item: ${saraSees}, entries: ${s.length}`);
  t.note(`Sara covers Mechanical only after fixture FX-K1M, so the Electrical MAR is not hers: she sees it ${saraSees}; her entries ${s.length}. The case text ("Ahmed and Sara, the pool") assumed both cover Electrical.`);

  const { page } = await pageAs("ahmed");
  await go(page, "/notifications");
  await settle(page);
  const row = page.getByRole("main").locator("li").filter({ hasText: title }).first();
  const text = (await row.innerText()).replace(/\s+/g, " ");
  c.check("the text names no TMC person", !TMC_PEOPLE.some((n) => text.includes(n)), text);
  c.check("the text says Reached you at the Step", /Reached you at Consultant Engineer/.test(text), text);
  await t.shot(page, "ahmed-bell");

  await mustPickUp(ahmed, id);
  await mustTake(ahmed, id, "send_to_manager", { answers: { sample_checked: true, matches_specification: true }, recommendedCode: "A", internalNote: "UAT NOT-02 note" });
  c.check("Mohammed is told once it reaches him", !!(await waitBell(mohammed, id)));
});

defineCase("NOT-03", async (t) => {
  const c = tracker(t);
  const { hafiz, ali } = await apis("hafiz", "ali");
  const ctx = await marContext(hafiz);
  const title = `UAT NOT-03 mail ${stamp()}`;
  const id = await makeMar(hafiz, ctx, title);
  await mustTake(hafiz, id, "send_for_review");
  const ali1 = await until(async () => {
    const m = await mailsAbout(emailOf.ali!, title);
    return m.length > 0 ? m : false;
  }, 60_000, 2000);
  await mustPickUp(ali, id);
  await mustTake(ali, id, "submit", { answers: { cover_note: "UAT NOT-03 cover note" } });
  const mails = await until(async () => {
    const m = await mailsAbout(emailOf.ahmed!, title);
    return m.length > 0 ? m : false;
  }, 60_000, 2000);
  if (!c.check("Ahmed has an email for the Step reached", !!mails?.length)) return;
  const mail = mails![0]!;
  const bare = mail.subject.replace(/[\u2066-\u2069]/g, "");
  c.check("the Subject holds the Document Number, the Subject and what happened", /^TWR-MAR-01-\d{4} · UAT NOT-03 mail \d+ · Reached you at Consultant Engineer$/.test(bare), bare);
  c.check("the Subject names no person", ![...TMC_PEOPLE, ...DCL_PEOPLE].some((n) => bare.includes(n)), bare);
  c.check("it is sent to the recipient alone", mail.to.length === 1 && mail.to[0] === emailOf.ahmed, mail.to.join(","));
  c.check("the body names no TMC person (the other Company is by name only)", !TMC_PEOPLE.some((n) => mail.text.includes(n) || mail.html.includes(n)), mail.text.slice(0, 300));
  c.check("the body holds no Form answer, cover note or Internal Note", !/UAT NOT-03 cover note|UAT Maker|Najd/.test(mail.text + mail.html));
  const link = /https?:\/\/[^\s"<]+\/work-items\/[0-9a-f-]{36}/.exec(mail.text)?.[0];
  c.check("the body links to the item", !!link && link.includes(id), String(link));
  const { page } = await pageAs("ahmed");
  await page.goto(link!, { waitUntil: "networkidle" });
  await settle(page);
  const h1 = (await page.getByRole("heading", { level: 1 }).first().innerText()).trim();
  c.check("the link opens the item for Ahmed", h1 === title, h1);
  await t.shot(page, "item-from-email-link");
  c.check("Ali, who received it first (Contractor PM), has his own email", !!ali1?.length, ali1?.[0]?.subject);
  const view = await pageAs("ahmed");
  await view.page.goto(`${process.env.MAILPIT_URL ?? `http://127.0.0.1:${process.env.MAILPIT_PORT ?? "8725"}`}/view/${mail.id}`, { waitUntil: "networkidle" });
  await t.shot(view.page, "mailpit-email");
});

defineCase("NOT-04", async (t) => {
  const c = tracker(t);
  const { hafiz, ali } = await apis("hafiz", "ali");
  const before = await readSettings(ali);
  const ctx = await marContext(hafiz);
  const run = stamp();
  const sendOne = async (label: string): Promise<{ id: string; title: string; bell: boolean }> => {
    const title = `UAT NOT-04 ${label} ${run}`;
    const id = await makeMar(hafiz, ctx, title);
    await mustTake(hafiz, id, "send_for_review");
    const bell = !!(await waitBell(ali, id));
    return { id, title, bell };
  };
  try {
    const { page } = await pageAs("ali");
    await go(page, "/profile");
    await settle(page);
    const text = (await page.getByRole("main").innerText()).replace(/\s+/g, " ");
    c.check("the groups are Step reached me or my pool, Items I watch, Sent Back to my Participant", ["Step reached me or my pool", "Items I watch", "Sent Back to my Participant"].every((g) => text.includes(g)));
    c.check("the choices are Off, Immediately and Daily digest", (await page.getByRole("radio", { name: "Off" }).count()) >= 3 && (await page.getByRole("radio", { name: "Immediately" }).count()) >= 3 && (await page.getByRole("radio", { name: "Daily digest" }).count()) >= 3);
    c.check("the Weekly Step Age report row shows exactly for a Member who holds Assign", /Weekly Step Age report/.test(text) === before.receivesWeeklyReport, `receivesWeeklyReport ${before.receivesWeeklyReport}`);
    t.note(`Ali's profile ${before.receivesWeeklyReport ? "has" : "has no"} the Weekly Step Age report row: the row shows only for a Member who holds Assign on a Project, and no demo person does (receivesWeeklyReport is false for all 13), so the 4th group of the expected result could not be seen. Its help text 'Emailed on Sunday mornings.' is in the app messages (apps/web/messages/en.json). Not a product defect: a seed gap; a person must give a Position Assign to see the row.`);
    await t.shot(page, "profile-settings");

    const group = (n: number) => page.getByRole("radio", { name: "Off" }).nth(n); // 0 = Step reached
    const setStep = async (label: "Off" | "Immediately" | "Daily digest", want: string) => {
      await page.getByRole("radio", { name: label }).nth(0).click();
      const saved = await until(async () => ((await readSettings(ali)).settings.step_reached?.email === want ? true : false), 8000, 500);
      return !!saved;
    };
    void group;

    c.check("Step reached set to Off is saved", await setStep("Off", "off"));
    const off = await sendOne("off");
    c.check("Step reached set to Daily digest is saved", await setStep("Daily digest", "digest"));
    const digest = await sendOne("digest");
    c.check("Step reached set to Immediately is saved", await setStep("Immediately", "immediate"));
    const immediate = await sendOne("immediate");
    c.check("Off and Daily digest still fill the bell (in-app is always sent)", off.bell && digest.bell && immediate.bell, `off ${off.bell}, digest ${digest.bell}, immediate ${immediate.bell}`);

    await page.getByRole("switch").first().click();
    c.check("Pause all email is saved", !!(await until(async () => ((await readSettings(ali)).emailPaused ? true : false), 8000, 500)));
    await t.shot(page, "paused");
    const paused = await sendOne("paused");
    await page.getByRole("switch").first().click();
    await until(async () => (!(await readSettings(ali)).emailPaused ? true : false), 8000, 500);

    await page.getByRole("radio", { name: "العربية" }).click();
    c.check("the email language is saved", !!(await until(async () => ((await readSettings(ali)).preferredLanguage === "ar" ? true : false), 8000, 500)));
    const arabic = await sendOne("arabic");
    await page.getByRole("radio", { name: "English" }).click();
    await until(async () => ((await readSettings(ali)).preferredLanguage === "en" ? true : false), 8000, 500);

    const gotImmediate = await until(async () => ((await mailsAbout(emailOf.ali!, immediate.title)).length > 0 ? true : false), 60_000, 2000);
    await until(async () => ((await mailsAbout(emailOf.ali!, arabic.title)).length > 0 ? true : false), 60_000, 2000);
    await new Promise((r) => setTimeout(r, 8000));
    c.check("Immediately: the email arrives", !!gotImmediate);
    c.check("Off: no email", (await mailsAbout(emailOf.ali!, off.title)).length === 0);
    c.check("Daily digest: no immediate email", (await mailsAbout(emailOf.ali!, digest.title)).length === 0);
    c.check("Pause all email: no email, but the bell filled", (await mailsAbout(emailOf.ali!, paused.title)).length === 0 && (await notificationsFor(ali, paused.id)).length > 0);
    const ar = (await mailsAbout(emailOf.ali!, arabic.title))[0];
    c.check("language Arabic: the email comes in Arabic", !!ar && /[؀-ۿ]/.test(ar.text) && /dir="rtl"/.test(ar.html), ar?.subject);
    c.check("... with Latin digits and the Document Number left to right", !!ar && !ARABIC_INDIC.test(ar.text) && /<bdi dir="ltr">TWR-MAR-01-\d{4}/.test(ar.html));
    await t.shot(page, "profile-after");
  } finally {
    await restoreSettings(ali, before);
    const after = await readSettings(ali);
    c.check("Ali's settings are restored", JSON.stringify(after.settings) === JSON.stringify(before.settings) && after.emailPaused === before.emailPaused && after.preferredLanguage === before.preferredLanguage);
  }
});

defineCase("NOT-05", async (t) => {
  const c = tracker(t);
  const { hafiz, ali } = await apis("hafiz", "ali");
  const before = await readSettings(ali);
  const ctx = await marContext(hafiz);
  const title = `UAT NOT-05 muted ${stamp()}`;
  try {
    const { page } = await pageAs("ali");
    await go(page, "/profile");
    await settle(page);
    const sw = page.getByRole("switch").last();
    await sw.click();
    const muted = await until(async () => ((await readSettings(ali)).projects.find((p) => p.code === "TWR")?.muted ? true : false), 8000, 500);
    c.check("Riyadh Gate Tower is muted in the settings", !!muted);
    await t.shot(page, "muted");
    const id = await makeMar(hafiz, ctx, title);
    await mustTake(hafiz, id, "send_for_review");
    // Hafiz is not muted: he is the control that the worker has run.
    await new Promise((r) => setTimeout(r, 14_000));
    c.check("no bell entry for Ali", (await notificationsFor(ali, id)).length === 0);
    c.check("no email for Ali", (await mailsAbout(emailOf.ali!, title)).length === 0);
    const need = (await ali.get(`/projects/${ctx.projectId}/work-items?needMyAction=true`)).body as { items: { id: string }[] };
    const mine = (await ali.get(`/work-items/${id}`)).body as { heldBy?: { memberName?: { en: string } } | null };
    c.check("the item still shows as Ali's under Need My Action", need.items.some((i) => i.id === id) || mine.heldBy?.memberName?.en === "Ali Sonour", `held by ${mine.heldBy?.memberName?.en}`);
    await go(page, `/projects/${ctx.projectId}/work-items?needMyAction=true`);
    await settle(page);
    await t.shot(page, "need-my-action");
  } finally {
    await restoreSettings(ali, before);
    const sw = (await readSettings(ali)).projects.find((p) => p.code === "TWR");
    if (sw?.muted) {
      const { page } = await pageAs("ali");
      await go(page, "/profile");
      await settle(page);
      await page.getByRole("switch").last().click();
      await until(async () => (!(await readSettings(ali)).projects.find((p) => p.code === "TWR")?.muted ? true : false), 8000, 500);
    }
    c.check("Ali's mute is restored (Project not muted)", !(await readSettings(ali)).projects.find((p) => p.code === "TWR")?.muted);
  }
});

defineCase("NOT-06", async (t) => {
  t.blocked("RP-922 UAT test tool not built (no `pnpm uat:run-job`): the 07:00 digest cannot be run on demand");
});

defineCase("NOT-07", async (t) => {
  t.note("Also: no demo person holds Assign, so nobody receives the Weekly Step Age report (receivesWeeklyReport is false for every seeded person).");
  t.blocked("RP-922 UAT test tool not built (no `pnpm uat:age` / `uat:run-job`): aged items and the weekly report job cannot be made on demand");
});

defineCase("NOT-08", async (t) => {
  const c = tracker(t);
  const { hafiz, ali, ahmed, mohammed } = await apis("hafiz", "ali", "ahmed", "mohammed");
  const ctx = await marContext(hafiz);
  const title = `UAT NOT-08 rev ${stamp()}`;
  const id = await makeMar(hafiz, ctx, title);
  await toSubmitted(hafiz, ali, id);
  await toManager(ahmed, mohammed, id, "C");
  await issueCode(mohammed, id, "revise_c");
  const rev = await hafiz.post(`/work-items/${id}/revisions`, { idempotencyKey: crypto.randomUUID() });
  if (!c.check("Hafiz creates Rev 1 of the Code C item", rev.status === 201 || rev.status === 200, `${rev.status} ${rev.text.slice(0, 200)}`)) return;
  const revId = (rev.body as { id: string }).id;
  await new Promise((r) => setTimeout(r, 14_000));
  const draftNotes = await Promise.all([hafiz, ali, ahmed, mohammed].map((a) => notificationsFor(a, revId)));
  c.check("no notice about the Revision while it is a Draft (nobody)", draftNotes.every((n) => n.length === 0), JSON.stringify(draftNotes.map((n) => n.map((x) => x.kind))));
  const sentAt = new Date();
  await mustTake(hafiz, revId, "send_for_review");
  await mustPickUp(ali, revId);
  c.check("Ali is told once it is numbered and reaches him", !!(await waitBell(ali, revId)));
  const hafizNotes = await notificationsFor(hafiz, revId);
  const raw = (await hafiz.get("/notifications")).body as { notifications: { workItemId: string; kind: string; createdAt: string }[] };
  const created = raw.notifications.filter((n) => n.workItemId === revId).map((n) => new Date(n.createdAt).getTime());
  c.check("any Revision notice is dated at or after the send for review", created.every((x) => x >= sentAt.getTime() - 2000), `${created.length} entries for Hafiz`);
  void hafizNotes;
  await new Promise((r) => setTimeout(r, 6000));
  c.check("Ahmed is not told before the Submit", (await notificationsFor(ahmed, revId)).length === 0);
  await mustTake(ali, revId, "submit", { answers: { cover_note: "UAT NOT-08 rev" } });
  c.check("Ahmed is told after the Submit", !!(await waitBell(ahmed, revId)));
  const { page } = await pageAs("ahmed");
  await go(page, "/notifications");
  await settle(page);
  await t.shot(page, "ahmed-bell-after-submit");
});

defineCase("NOT-09", async (t) => {
  const c = tracker(t);
  const { hafiz, ali, ahmed, faisal, yousef } = await apis("hafiz", "ali", "ahmed", "faisal", "yousef");
  const ctx = await marContext(hafiz, 1);
  const title = `UAT NOT-09 sent back ${stamp()}`;
  const id = await makeMar(hafiz, ctx, title);
  await toSubmitted(hafiz, ali, id);
  await mustPickUp(ahmed, id);
  const info = (await ahmed.get(`/work-items/${id}`)).body as { actions: { transitions: { key: string; kind: string; actionForm?: unknown }[] } };
  const sb = info.actions.transitions.find((x) => x.kind === "send_back");
  if (!c.check("the Consultant Engineer has a Send Back on the bound (Comment only) Workflow", !!sb, JSON.stringify(info.actions.transitions.map((x) => x.key)))) return;
  // The Workflow's own Send Back sits at the Consultant Engineer: Mohammed (Manager) has Return to Engineer only.
  await new Promise((r) => setTimeout(r, 8000));
  const priorFaisal = (await notificationsFor(faisal, id)).length;
  const r = await ahmed.transition(id, sb!.key);
  if (!c.check("the Send Back is taken", r.status < 300, `${r.status} ${r.text.slice(0, 200)}`)) return;
  c.check("Hafiz is told it was Sent Back", !!(await until(async () => ((await notificationsFor(hafiz, id)).some((n) => n.kind === "sent_back") ? true : false), 40_000, 1500)));
  await new Promise((r) => setTimeout(r, 6000));
  const tmcNotes = await Promise.all([hafiz, ali].map((a) => notificationsFor(a, id)));
  t.note(`Sent Back notices: Hafiz ${tmcNotes[0].filter((n) => n.kind === "sent_back").length}, Ali ${tmcNotes[1].filter((n) => n.kind === "sent_back").length}. The Send Back is at the Consultant Engineer Step (Ahmed), not Mohammed's Step: Mohammed has "Return to Engineer" only.`);
  const { page } = await pageAs("hafiz");
  await go(page, "/notifications");
  await settle(page);
  const row = page.getByRole("main").locator("li").filter({ hasText: title }).filter({ hasText: /Sent Back/ }).first();
  const text = (await row.innerText().catch(() => "")).replace(/\s+/g, " ");
  c.check("the notice names Design Consultants LLC as a Company, no person", /Design Consultants LLC/.test(text) && !/Ahmed|Mohammed/.test(text), text);
  await t.shot(page, "hafiz-sent-back-notice");
  const fa = await notificationsFor(faisal, id);
  c.check("Faisal (Al Waha) is not told of the Send Back or the moves inside TMC", !fa.some((n) => n.kind === "sent_back") && fa.length <= priorFaisal, JSON.stringify(fa.map((n) => n.kind)));
  c.check("Yousef (Beta Build) is told nothing", (await notificationsFor(yousef, id)).length === 0);
});

defineCase("NOT-10", async (t) => {
  const c = tracker(t);
  const { hafiz, ali, ahmed, mohammed, faisal } = await apis("hafiz", "ali", "ahmed", "mohammed", "faisal");
  const before = await readSettings(faisal);
  const ctx = await marContext(hafiz, 1);
  const title = `UAT NOT-10 arabic ${stamp()}`;
  try {
    await faisal.put("/notification-settings", { settings: { ...before.settings, watched: { ...before.settings.watched!, email: "immediate" } }, emailPaused: false, preferredLanguage: "ar" });
    const id = await makeMar(hafiz, ctx, title);
    await toSubmitted(hafiz, ali, id);
    const w = await faisal.put(`/work-items/${id}/watch`, {});
    c.check("Faisal (Al Waha, Tower 1) sees and watches the Submitted item", w.status < 300, `${w.status}`);
    await toManager(ahmed, mohammed, id, "A");
    await issueCode(mohammed, id, "approve_a");
    c.check("Faisal's bell gets an entry", !!(await waitBell(faisal, id)));
    const mails = await until(async () => {
      const m = await mailsAbout(emailOf.faisal!, title);
      return m.length > 0 ? m : false;
    }, 60_000, 2000);
    if (!c.check("Faisal gets an email", !!mails?.length)) return;
    const mail = mails![0]!;
    c.check("the email is in Arabic, right to left", /[؀-ۿ]/.test(mail.text) && /dir="rtl"/.test(mail.html), mail.subject);
    c.check("the email has Latin digits only", !ARABIC_INDIC.test(mail.subject + mail.text), mail.subject);
    c.check("the Document Number is isolated left to right in the email", /<bdi dir="ltr">TWR-MAR-01-\d{4}/.test(mail.html) && /\u2066TWR-MAR-01-\d{4}\u2069/.test(mail.subject), mail.subject);
    const { page } = await pageAs("faisal", { locale: "ar" });
    await go(page, "/notifications", "ar");
    await settle(page);
    const row = page.getByRole("main").locator("li").filter({ hasText: title }).first();
    const text = (await row.innerText()).replace(/\s+/g, " ");
    c.check("the bell entry is Arabic with Latin digits", /[؀-ۿ]/.test(text) && !ARABIC_INDIC.test(text) && /TWR-MAR-01-\d{4}/.test(text), text);
    c.check("the page is right to left", (await page.evaluate(() => document.documentElement.dir)) === "rtl");
    await t.shot(page, "faisal-bell-ar");
    const view = await pageAs("faisal", { locale: "ar" });
    await view.page.goto(`http://127.0.0.1:${process.env.MAILPIT_PORT ?? "8725"}/view/${mail.id}`, { waitUntil: "networkidle" });
    await t.shot(view.page, "faisal-email-ar");
    void mailFull;
  } finally {
    await restoreSettings(faisal, before);
    const after = await readSettings(faisal);
    c.check("Faisal's settings are restored", JSON.stringify(after.settings) === JSON.stringify(before.settings) && after.preferredLanguage === before.preferredLanguage);
  }
});

defineCase("NOT-11", async (t) => {
  t.notRun("not built: there is no Project close control (no ticket in the five epics). The worker's quiet for a closed Project is covered by apps/api/test/closed-project-quiet.test.ts only.");
});
