/* eslint-disable @typescript-eslint/no-explicit-any -- UAT scripts read api answers as loose JSON */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineCase } from "../harness/case.ts";
import { getBrowser, pageAs, root, sessionsDir, urlOf, webUrl } from "../harness/browser.ts";
import { Api } from "../harness/helpers.ts";
import {
  Crew, emailOf, listAll, mailsWith, memberIdOf, memberVisibility, must, myParticipantId, pageIsNotFound, participantIdByName, participantVisibility, sameGrant, setMemberVisibility, setParticipantVisibility, sleep,
} from "../harness/helpers-vis.ts";

// Part PAR: Participants and Visibility setup. The Project made by PAR-04 (code UATP) is the one the invitations,
// Trades, numbering and Module settings are tried on, so the shared Riyadh Gate Tower keeps its seed.

const bi = (en: string) => ({ en, ar: `${en} (ع)` });
const OTHERS = /Beta Build|Al Waha|Design Consultants/;

async function uatp(crew: Crew): Promise<{ id: string; created: boolean; number: number }> {
  const saeed = await crew.as("saeed");
  const list = ((await saeed.get("/projects")).body as any).projects as any[];
  const have = list.find((p) => p.code === "UATP");
  if (have) return { id: have.id, created: false, number: have.projectNumber };
  const r = await saeed.post("/projects", { name: bi("UAT PAR-04 Project"), code: "UATP", role: "contractor" });
  if (r.status !== 201) throw new Error(`create UATP answered ${r.status}: ${r.text.slice(0, 200)}`);
  return { id: (r.body as any).projectId, created: true, number: (r.body as any).projectNumber };
}

defineCase("PAR-01", async (t) => {
  mkdirSync(sessionsDir, { recursive: true });
  const file = resolve(sessionsDir, "par01-hafiz.json");
  // Its own session (made by the demo script, which reads the password): signing out ends only this one.
  execFileSync(process.execPath, ["--env-file-if-exists=.env", "scripts/demo-session.ts", "hafiz", "--out", file], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  const b = await getBrowser();
  const anon = await b.newContext({ locale: "en-US", viewport: { width: 1366, height: 800 } });
  try {
    const page = await anon.newPage();
    await page.goto(urlOf("/sign-in"), { waitUntil: "networkidle" });
    await page.getByLabel("Email").fill(emailOf.hafiz!);
    await page.getByLabel("Password").fill("UAT-not-the-password-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForTimeout(1200);
    const wrongText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    await t.shot(page, "wrong-password");
    t.check("A wrong password gives the one generic refusal", /That email and password don't match\./.test(wrongText) && !/not found|no such|no account|locked|TMC/i.test(wrongText.replace("don't match", "")), wrongText.slice(0, 200));
    await page.getByLabel("Email").fill("nobody.at.all@tmc.demo.rabaed.test");
    await page.getByLabel("Password").fill("UAT-not-the-password-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForTimeout(1200);
    const unknownText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    t.check("An unknown email gets the very same refusal", /That email and password don't match\./.test(unknownText), unknownText.slice(0, 120));
  } finally {
    await anon.close();
  }
  const signed = await b.newContext({ storageState: file, locale: "en-US", viewport: { width: 1366, height: 800 } });
  try {
    const page = await signed.newPage();
    await page.goto(urlOf("/"), { waitUntil: "networkidle" });
    t.check("With the right password (the harness's demo session) sign-in opens Home", /\/en\/?$/.test(page.url()) && (await page.locator("body").innerText()).includes("Hafiz"), page.url());
    const cookies = await signed.cookies();
    t.check("The session cookie belongs to the lane host (lane7.localhost), not 127.0.0.1", cookies.length > 0 && cookies.every((c) => /lane7\.localhost/.test(c.domain)), cookies.map((c) => c.domain).join(","));
    const crew = await Crew.start();
    await page.getByRole("button", { name: /Hafiz Hamdan/ }).first().click();
    await page.getByRole("menuitem", { name: "Sign out" }).or(page.getByRole("button", { name: "Sign out" })).first().click();
    await page.waitForTimeout(1500);
    await t.shot(page, "after-sign-out");
    await page.goto(`${webUrl}/en/projects/${crew.projectId}`, { waitUntil: "networkidle" });
    t.check("After sign-out a Project URL goes to sign-in", /\/sign-in/.test(page.url()), page.url());
  } finally {
    await signed.close();
  }
  t.note("The right password is typed by the harness's demo:session script (the password is never read here); the wrong-password and sign-out steps are driven in the page.");
});

defineCase("PAR-02", async (t) => {
  const crew = await Crew.start();
  const saeed = await crew.as("saeed");
  const layla = await crew.as("layla");
  const tag = String(Date.now()).slice(-6);
  const email = `uat.par02.${tag}@tmc.demo.rabaed.test`;
  const invite = await saeed.post("/members", { email, fullName: { en: `UAT PAR-02 ${tag}`, ar: `اختبار ${tag}` }, locale: "ar" });
  t.check("Saeed invites a new Member (Arabic)", invite.status === 201, `${invite.status} ${invite.text.slice(0, 120)}`);
  const memberId = (invite.body as any).memberId as string;
  let token = "";
  const list = async (api: Api) => ((await api.get("/members")).body as any).members as any[];
  const invited = (await list(saeed)).find((m) => m.id === memberId);
  t.check("The Member appears as invited", invited?.status === "invited", JSON.stringify(invited?.status));
  let mails = await mailsWith(email, "");
  for (let i = 0; i < 10 && mails.length === 0; i++) {
    await sleep(2000);
    mails = await mailsWith(email, "");
  }
  t.check("The invitation email arrives in Mailpit", mails.length > 0, `${mails.length} mails for ${email}`);
  if (mails[0]) {
    const full = (await (await fetch(`http://127.0.0.1:${process.env.MAILPIT_PORT ?? "8725"}/api/v1/message/${mails[0].id}`)).json()) as { Text?: string; Subject: string };
    t.check("The email is in the chosen language (Arabic)", /[؀-ۿ]/.test(`${full.Subject} ${full.Text ?? ""}`), full.Subject);
    // The one-time token is in the email's link only (RP-1052): the invite answer no longer carries it.
    token = /accept-invitation#token=([\w-]+)/.exec(full.Text ?? "")?.[1] ?? "";
  }
  t.check("The invite answer does not carry the token", !!token && !invite.text.includes(token), "");
  const password = `Uat-${crypto.randomUUID()}`;
  const accept = await fetch(`${process.env.API_URL ?? "http://127.0.0.1:4700"}/v1/invitations/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password, locale: "ar" }) });
  t.check("The new person follows the link's token and sets a password", accept.status < 300, `${accept.status}`);
  const active = (await list(saeed)).find((m) => m.id === memberId);
  t.check("The Member is now active", active?.status === "active", JSON.stringify(active?.status));
  t.check("The new Member belongs to TMC alone: DCL's Members list does not hold them", !(await list(layla)).some((m) => m.email === email) && active.email === email, "");
  const { context, page } = await pageAs("saeed");
  try {
    await page.goto(`${webUrl}/en/members`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await t.shot(page, "saeed-members");
  } finally {
    await context.close();
  }
  t.note("FAIL (PAR-02 email): steps: Saeed invites a made-up .test email (name EN and AR, language Arabic) through Members > Invite (api POST /v1/members), then Mailpit (http://127.0.0.1:8725) is searched for mail to that address for 20 s. Expected: the Test Case says the email arrives in Mailpit in the chosen language (ADR 0009 invitation). Actual: no mail is sent; the api answers 201 with the one-time token and its code comment says email delivery comes later; the person can only accept with that token. Screenshot: evidence/PAR-02-1-saeed-members.jpg (Member invited then active).");
  t.note(`The new Member ${email} stays (active, on no Project). The password was made up at run time and is not kept.`);
});

defineCase("PAR-03", async (t) => {
  const crew = await Crew.start();
  const hind = await crew.as("hind");
  const other = await hind.post("/members", { email: emailOf.hafiz, fullName: bi("UAT PAR-03 Hafiz"), locale: "en" });
  const own = await hind.post("/members", { email: emailOf.faisal, fullName: bi("UAT PAR-03 Faisal"), locale: "en" });
  const fake = await hind.post("/members", { email: `uat.par03.${String(Date.now()).slice(-6)}@alwaha.demo.rabaed.test`, fullName: bi("UAT PAR-03 New"), locale: "en" });
  t.check("Hind inviting Hafiz's email (another Company's) is refused", other.status >= 400, `${other.status} ${other.text}`);
  t.check("The refusal never names TMC, Hafiz or anything of him", !/TMC|Hafiz|Hamdan|Constructions/i.test(other.text), other.text);
  t.check("An email of Hind's own Company gives the ordinary already-a-Member answer, a different one", own.status >= 400 && own.text !== other.text, `${own.status} ${own.text} / ${other.text}`);
  t.check("Positive control: a brand new email of her own Company is accepted", fake.status === 201, `${fake.status} ${fake.text.slice(0, 100)}`);
  const { context, page } = await pageAs("hind");
  try {
    await page.goto(`${webUrl}/en/members`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await t.shot(page, "hind-members");
  } finally {
    await context.close();
  }
  t.note("The positive control invited a made-up uat.par03.<run>@alwaha.demo.rabaed.test (left as invited, Al Waha).");
});

defineCase("PAR-04", async (t) => {
  const crew = await Crew.start();
  const saeed = await crew.as("saeed");
  const p = await uatp(crew);
  const summary = ((await saeed.get("/projects")).body as any).projects.find((x: any) => x.id === p.id);
  t.check(p.created ? "Saeed creates the Project UATP (Contractor)" : "The Project UATP exists from an earlier run (reused)", !!summary, JSON.stringify(summary?.code));
  t.check("It has a Project Number in TMC's own series", Number.isInteger(summary.projectNumber) && summary.projectNumber >= 1, `${summary.projectNumber}`);
  t.check("Saeed is its Project Admin; the Host Company is TMC; his role is Contractor", summary.isProjectAdmin === true && summary.hostCompany.legalName.en === "TMC Constructions" && summary.projectRole.baseRole === "contractor", JSON.stringify([summary.isProjectAdmin, summary.hostCompany.legalName.en]));
  const parts = ((await saeed.get(`/projects/${p.id}/participants`)).body as any).participants as any[];
  t.check("TMC is its first Participant", parts.length >= 1 && parts[0].company.legalName.en === "TMC Constructions", parts.map((x) => x.company.legalName.en).join());
  const other = await (await crew.as("hafiz")).get(`/projects/${p.id}`);
  t.check("Nobody else sees it (Hafiz is not on it: 404)", other.status === 404, `${other.status}`);
  const { context, page } = await pageAs("saeed");
  try {
    await page.goto(`${webUrl}/en/projects/${p.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await t.shot(page, "uatp-project");
  } finally {
    await context.close();
  }
  t.note("Project UATP (UAT PAR-04 Project) is left in place: PAR-05, 06, 08, 10 and 11 work on it.");
});

defineCase("PAR-05", async (t) => {
  const crew = await Crew.start();
  const saeed = await crew.as("saeed");
  const p = await uatp(crew);
  const tag = String(Date.now()).slice(-5);
  const add = async (path: string, body: unknown) => saeed.post(`/projects/${p.id}${path}`, body);
  const trade = await add("/trades", { code: `T${tag}`, name: bi(`UAT PAR-05 Trade ${tag}`) });
  t.check("Saeed adds a Trade", trade.status === 201, `${trade.status} ${trade.text.slice(0, 100)}`);
  const zone = await add("/locations", { code: `Z${tag}`, name: bi(`UAT PAR-05 Zone ${tag}`), parentId: null });
  const building = await add("/locations", { code: `B${tag}`, name: bi(`UAT PAR-05 Building ${tag}`), parentId: (zone.body as any).id });
  const floor = await add("/locations", { code: `F${tag}`, name: bi(`UAT PAR-05 Floor ${tag}`), parentId: (building.body as any).id });
  t.check("Saeed adds a Zone, a Building and a Floor", zone.status === 201 && building.status === 201 && floor.status === 201, `${zone.status} ${building.status} ${floor.status}`);
  const scope = await add("/scopes", { tradeId: (trade.body as any).id, parentId: null, name: bi(`UAT PAR-05 Scope ${tag}`) });
  const sub = await add("/scopes", { tradeId: (trade.body as any).id, parentId: (scope.body as any)?.id, name: bi(`UAT PAR-05 Sub-scope ${tag}`) });
  t.check("Saeed adds a Scope and a Sub-scope", scope.status === 201 && sub.status === 201, `${scope.status} ${sub.status} ${sub.text.slice(0, 100)}`);
  const dims = ((await saeed.get(`/projects/${p.id}/dimensions`)).body as any);
  t.check("Names show in English and Arabic", dims.trade.some((x: any) => x.name.en.includes(`Trade ${tag}`) && x.name.ar) && dims.location.every((x: any) => x.name.en && x.name.ar), "");
  const levels = dims.location.filter((x: any) => x.name.en.includes(tag)).map((x: any) => x.depth);
  t.check("The Locations nest Zone > Building > Floor (depths 1, 2, 3)", levels.sort().join() === "1,2,3", levels.join());
  // Ali reads Tower's Trades, Scopes and Locations and cannot add.
  const ali = await crew.as("ali");
  const tower = crew.projectId;
  const reads = await Promise.all([ali.get(`/projects/${tower}/dimensions`), ali.get(`/projects/${tower}/scopes`)]);
  t.check("Ali (TMC PM, not a Project Admin) reads Tower's Trades, Locations and Scopes", reads.every((r) => r.status === 200), reads.map((r) => r.status).join());
  const adds = [await ali.post(`/projects/${tower}/trades`, { code: "ZZ", name: bi("x") }), await ali.post(`/projects/${tower}/locations`, { code: "ZZ", name: bi("x"), parentId: null }), await ali.post(`/projects/${tower}/scopes`, { tradeId: crew.dims.trade.EL, parentId: null, name: bi("x") })];
  t.check("Ali cannot add a Trade, Location or Scope (refused; the Scope is the plain 404, V16)", adds[0]!.status >= 400 && adds[1]!.status >= 400 && adds[2]!.status === 404, adds.map((r) => r.status).join());
  const { context, page } = await pageAs("ali");
  try {
    await page.goto(`${webUrl}/en/projects/${tower}/settings/trades-locations`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await t.shot(page, "ali-trades-locations");
  } finally {
    await context.close();
  }
});

defineCase("PAR-06", async (t) => {
  const crew = await Crew.start();
  const saeed = await crew.as("saeed");
  const layla = await crew.as("layla");
  const p = await uatp(crew);
  const parts = async () => ((await saeed.get(`/projects/${p.id}/participants`)).body as any).participants as any[];
  const already = (await parts()).some((x) => /Design Consultants/.test(x.company.legalName.en));
  if (already) {
    t.check("DCL is already a Participant of UATP in the role Consultant (an earlier run accepted it)", (await parts()).find((x) => /Design Consultants/.test(x.company.legalName.en)).projectRole.baseRole === "consultant");
    return;
  }
  const inv = await saeed.post(`/projects/${p.id}/participants`, { crNumber: "9999000003", role: "consultant" });
  t.check("Saeed invites CR 9999000003 as Consultant", inv.status === 202, `${inv.status} ${inv.text.slice(0, 100)}`);
  const pending = ((await layla.get("/participant-invitations")).body as any).invitations as any[];
  const mine = pending.find((i) => i.project.name.en === "UAT PAR-04 Project");
  t.check("Layla's Company Projects shows the invitation: name, Host Company, offered role", !!mine && mine.hostCompany.legalName.en === "TMC Constructions" && mine.projectRole.baseRole === "consultant", JSON.stringify(mine));
  const hafiz = await crew.as("hafiz");
  const omar = await crew.as("omar");
  t.check("Until accepted TMC's other Members (Hafiz, Omar) see nothing of it: no Project, no invitation", !JSON.stringify((await hafiz.get("/projects")).body).includes("UATP") && !JSON.stringify((await omar.get("/projects")).body).includes("UATP") && (await hafiz.get(`/projects/${p.id}/invitations`)).status >= 400, "");
  t.check("The Project Admin reads it by CR number only", JSON.stringify(((await saeed.get(`/projects/${p.id}/invitations`)).body as any).invitations).includes("9999000003") && !JSON.stringify(((await saeed.get(`/projects/${p.id}/invitations`)).body as any)).includes("Design"), "");
  const { context, page } = await pageAs("layla");
  try {
    await page.goto(`${webUrl}/en/participants`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await t.shot(page, "layla-invitation");
  } finally {
    await context.close();
  }
  const accept = await layla.post(`/participant-invitations/${mine.id}/accept`);
  t.check("Layla accepts", accept.status === 204, `${accept.status} ${accept.text.slice(0, 100)}`);
  const after = (await parts()).find((x) => /Design Consultants/.test(x.company.legalName.en));
  t.check("DCL is now a Participant in the role Consultant", after?.projectRole.baseRole === "consultant", JSON.stringify(after?.projectRole));
});

defineCase("PAR-07", async (t) => {
  const crew = await Crew.start();
  const saeed = await crew.as("saeed");
  const p = await uatp(crew);
  const dcl = await participantIdByName(saeed, p.id, "Design Consultants").catch(() => null);
  if (!dcl) throw new Error("DCL is not on UATP yet: run PAR-06 first.");
  const dims = ((await saeed.get(`/projects/${p.id}/dimensions`)).body as any);
  const electrical = dims.trade.find((x: any) => /Electrical|T\d+/.test(x.name.en)) ?? dims.trade[0];
  const grant = await setParticipantVisibility(saeed, dcl, { trade: { isAll: false, valueIds: [electrical.id] }, location: { isAll: true, valueIds: [] } });
  t.check("The grant saves: Saeed gives the new Consultant one Trade only", grant.status === 204, `${grant.status} ${grant.text.slice(0, 120)}`);
  t.check("The saved grant reads back", (await participantVisibility(saeed, dcl)).trade.valueIds.join() === electrical.id, "");
  t.notRun("not built: the Visibility Gap warning is not in the Visibility pages or the api (no 'gap' text in apps/web or apps/api). The grant half passed. Steps for later: remove all coverage of one Trade from every Participant and read Settings > Visibility; expected: a Visibility Gap warning names the value no active Participant covers, worked out from Participant grants alone.");
});

defineCase("PAR-08", async (t) => {
  const crew = await Crew.start();
  const saeed = await crew.as("saeed");
  const layla = await crew.as("layla");
  const p = await uatp(crew);
  const dcl = await participantIdByName(saeed, p.id, "Design Consultants").catch(() => null);
  if (!dcl) throw new Error("DCL is not on UATP yet: run PAR-06 first.");
  const sara = await memberIdOf(layla, (await myParticipantId(layla, p.id).then((x) => x)), emailOf.sara!).catch(async () => {
    const all = ((await layla.get("/members")).body as any).members as any[];
    return all.find((m) => m.email === emailOf.sara)!.id as string;
  });
  const add = await layla.post(`/participants/${dcl}/members`, { memberId: sara });
  t.check("Layla adds Sara to the Project as a Project Member", add.status === 204 || add.status === 409, `${add.status} ${add.text.slice(0, 100)}`);
  const pos = await layla.put(`/participants/${dcl}/members/${sara}/positions`, { positions: ["engineer"] });
  t.check("With the Position Engineer", pos.status === 204, `${pos.status} ${pos.text.slice(0, 100)}`);
  const dims = ((await saeed.get(`/projects/${p.id}/dimensions`)).body as any);
  const partVis = await participantVisibility(saeed, dcl);
  const covered = partVis.trade.valueIds;
  const narrow = await setMemberVisibility(layla, dcl, sara, { trade: { isAll: false, valueIds: covered.slice(0, 1) }, location: { isAll: true, valueIds: [] } });
  t.check("Narrowing Sara to one Trade saves", narrow.status === 204, `${narrow.status} ${narrow.text.slice(0, 100)}`);
  const lacking = dims.trade.find((x: any) => !covered.includes(x.id));
  const over = lacking ? await setMemberVisibility(layla, dcl, sara, { trade: { isAll: false, valueIds: [lacking.id] }, location: { isAll: true, valueIds: [] } }) : null;
  t.check("A Trade DCL does not cover is rejected (a Member never covers more than the Participant)", !!over && over.status >= 400, `${over?.status} ${over?.text.slice(0, 100)}`);
  t.check("Sara's grant is unchanged by the rejection", sameGrant((await memberVisibility(layla, dcl, sara)).trade, { isAll: false, valueIds: covered.slice(0, 1) }));
  const members = await layla.get(`/participants/${dcl}/members`);
  t.check("Layla reads DCL's Project Members of UATP", (members.body as any).members.some((m: any) => m.id === sara), `${members.status}`);
  const { context, page } = await pageAs("layla");
  try {
    await page.goto(`${webUrl}/en/participants/${dcl}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await t.shot(page, "layla-uatp-participant");
  } finally {
    await context.close();
  }
  t.note("The Test Case's Mechanical-only narrowing is done on UATP with the Trades its Participant covers there; Sara's grant on Tower is untouched.");
});

defineCase("PAR-09", async (t) => {
  t.manual("Not run by script: the Handover dialog is read by taking Deactivate on a seeded Member, and a call that went through would deactivate Hafiz for every other Part. Steps for a person on a clean seed: 1) Hafiz holds two Tower 2 MARs at Contractor Engineer (Omar covers Tower 2 as well) and one Tower 1 MAR (Omar does not cover it). 2) Saeed: Members > Deactivate Hafiz. Expected: the Handover dialog lists his open Steps and Drafts (Project, Document Number or No number yet, Subject, Step); the Tower 2 Steps pre-fill Omar as the single candidate; the Tower 1 Step has nobody else who can take it, so the change is refused with 'Nobody else can take <Step> on <Project>. Give someone the Position or Visibility first', naming only TMC's own Step and the Project; nothing saves until every Step has a new holder.");
});

defineCase("PAR-10", async (t) => {
  const crew = await Crew.start();
  const saeed = await crew.as("saeed");
  const p = await uatp(crew);
  const numbering = async () => (await saeed.get(`/projects/${p.id}/numbering`)).body as any;
  const n0 = await numbering();
  t.check("Saeed reads the pattern and the examples (the Admin's real next numbers)", n0.canEdit === true && !!n0.example, JSON.stringify(n0.example));
  const parts = ((await saeed.get(`/projects/${p.id}/participants`)).body as any).participants as any[];
  const own = parts.find((x) => x.isOwnCompany);
  const code = `PR${String(Date.now()).slice(-4)}`;
  const set = await saeed.put(`/participants/${own.id}/code`, { code });
  t.check("Saeed sets a Participant Code (2 to 6 letters or digits)", set.status === 204, `${set.status} ${set.text.slice(0, 100)}`);
  const bad = await saeed.put(`/participants/${own.id}/code`, { code: "X" });
  t.check("A code of one character is refused", bad.status >= 400, `${bad.status}`);
  const readBack = ((await saeed.get(`/projects/${p.id}/participants`)).body as any).participants.find((x: any) => x.id === own.id);
  t.check("The code reads back", readBack.code === code, JSON.stringify(readBack.code));
  const noParticipant = { workItemTypeId: null, pattern: { segments: [{ kind: "project" }, { kind: "type" }], separator: "-", seqDigits: 4, countedBy: [0, 1] } };
  const refused = await saeed.request("PUT", `/projects/${p.id}/numbering`, { ...noParticipant, sharedCounterAccepted: false });
  t.check("A pattern that leaves out the Participant Code is refused until the shared-counter warning is accepted", refused.status >= 400 && /shared_counter/.test(refused.text), `${refused.status} ${refused.text.slice(0, 100)}`);
  const accepted = await saeed.request("PUT", `/projects/${p.id}/numbering`, { ...noParticipant, sharedCounterAccepted: true });
  t.check("With the warning accepted it saves (on UATP only)", accepted.status === 204, `${accepted.status} ${accepted.text.slice(0, 100)}`);
  const restore = await saeed.request("PUT", `/projects/${p.id}/numbering`, { workItemTypeId: null, pattern: { segments: [{ kind: "project" }, { kind: "type" }, { kind: "participant" }], separator: "-", seqDigits: 4, countedBy: [0, 1, 2] }, sharedCounterAccepted: false });
  t.check("The default pattern is saved back (counted by the Participant Code)", restore.status === 204, `${restore.status}`);
  const { context, page } = await pageAs("saeed");
  try {
    await page.goto(`${webUrl}/en/projects/${p.id}/settings/numbering`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await t.shot(page, "saeed-numbering");
  } finally {
    await context.close();
  }
  t.note("'A code in use cannot change' needs a numbered item on UATP (raising items there needs Workflow setup); on the Tower the seeded TMC code is locked (codeLocked) and is not touched.");
  const locked = (((await saeed.get(`/projects/${crew.projectId}/participants`)).body as any).participants as any[]).find((x) => x.isOwnCompany);
  const tryChange = await saeed.put(`/participants/${locked.id}/code`, { code: "ZZ9" });
  t.check("On the Tower, TMC's code (in use by numbered items) cannot be changed", locked.codeLocked === true && tryChange.status >= 400 || locked.code === null && tryChange.status >= 400, `${locked.codeLocked} ${tryChange.status} ${tryChange.text.slice(0, 80)}`);
});

defineCase("PAR-11", async (t) => {
  const crew = await Crew.start();
  const saeed = await crew.as("saeed");
  const p = await uatp(crew);
  const flag = async () => ((await saeed.get("/projects")).body as any).projects.find((x: any) => x.id === p.id);
  const before = await flag();
  t.check("UATP shows Inspections in its own tab by default", before.showInspectionsInSubmittals === false && before.modules.includes("inspections"), JSON.stringify([before.showInspectionsInSubmittals, before.modules]));
  const ali = await crew.as("ali");
  const hafiz = await crew.as("hafiz");
  const notAdmin = await hafiz.request("PUT", `/projects/${p.id}/settings/show-inspections-in-submittals`, { show: true });
  t.check("Only a Project Admin changes it: another Member gets the plain 404", notAdmin.status === 404, `${notAdmin.status}`);
  void ali;
  try {
    const on = await saeed.request("PUT", `/projects/${p.id}/settings/show-inspections-in-submittals`, { show: true });
    t.check("Saeed chooses Inside the Submittals tab", on.status === 204, `${on.status}`);
    const after = await flag();
    t.check("The setting reads back on", after.showInspectionsInSubmittals === true, JSON.stringify(after.showInspectionsInSubmittals));
    const { context, page } = await pageAs("saeed");
    try {
      await page.goto(`${webUrl}/en/projects/${p.id}/work-items`, { waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      const tabs = (await page.getByRole("navigation").allInnerTexts()).join(" ");
      await t.shot(page, "uatp-tabs-inside");
      t.check("The Inspections tab is hidden on UATP", !/Inspections/.test(tabs), tabs.replace(/\s+/g, " ").slice(0, 160));
    } finally {
      await context.close();
    }
  } finally {
    const off = await saeed.request("PUT", `/projects/${p.id}/settings/show-inspections-in-submittals`, { show: false });
    t.check("Switching back restores the tab", off.status === 204 && (await flag()).showInspectionsInSubmittals === false, `${off.status}`);
  }
  t.note("The WIR rows in the Submittals List and Kanban (with WIR as one more Type) are proven on the Tower by VIS-46 and INS-07.");
});

defineCase("PAR-12", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const saeed = await crew.as("saeed");
  const hafiz = await crew.as("hafiz");
  const tag = String(Date.now()).slice(-5);
  const me = crew.dims.trade.ME!;
  const add = await saeed.post(`/projects/${pid}/approved-suppliers`, { name: bi(`UAT PAR-12 Mechanical Supplier ${tag}`), tradeId: me, scopeId: null });
  t.check("Saeed adds a supplier for Mechanical", add.status === 201, `${add.status} ${add.text.slice(0, 100)}`);
  const id = (add.body as any).id as string;
  const add2 = await saeed.post(`/projects/${pid}/approved-suppliers`, { name: bi(`UAT PAR-12 Second ${tag}`), tradeId: me, scopeId: null });
  const list = async (api: Api, q = "") => ((await api.get(`/projects/${pid}/approved-suppliers${q}`)).body as any).suppliers as any[];
  const s = (await list(hafiz)).find((x) => x.id === id);
  t.check("Hafiz reads it: name, Trade, Scope and status", !!s && s.status === "approved" && s.tradeId === me && "scopeId" in s && !!s.name.en, JSON.stringify(s));
  const w = await saeed.post(`/approved-suppliers/${(add2.body as any).id}/withdraw`);
  t.check("Saeed withdraws one", w.status === 204, `${w.status}`);
  const withdrawn = (await list(hafiz)).find((x) => x.id === (add2.body as any).id);
  t.check("The withdrawn one stays listed, as withdrawn", withdrawn?.status === "withdrawn", JSON.stringify(withdrawn?.status));
  t.check("The Approved status filter hides it; the withdrawn filter shows it", !(await list(hafiz, "?status=approved")).some((x) => x.id === withdrawn.id) && (await list(hafiz, "?status=withdrawn")).some((x) => x.id === withdrawn.id));
  const tries = [await hafiz.post(`/projects/${pid}/approved-suppliers`, { name: bi("UAT intruder"), tradeId: me, scopeId: null }), await hafiz.post(`/approved-suppliers/${id}/withdraw`)];
  t.check("Hafiz cannot add or withdraw (the plain 404)", tries.every((r) => r.status === 404), tries.map((r) => r.status).join());
  t.check("No source, person or time shows on an entry", Object.keys(s).sort().join() === ["id", "name", "scopeId", "status", "tradeId"].join(), Object.keys(s).join());
  await saeed.post(`/approved-suppliers/${id}/withdraw`);
  const { context, page } = await pageAs("hafiz");
  try {
    await page.goto(`${webUrl}/en/projects/${pid}/settings/approved-suppliers`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await t.shot(page, "hafiz-approved-suppliers");
  } finally {
    await context.close();
  }
  t.note("Both UAT suppliers are left in the list as withdrawn.");
});

defineCase("PAR-13", async (t) => {
  const crew = await Crew.start();
  const layla = await crew.as("layla");
  const hafiz = await crew.as("hafiz");
  const lp = await layla.get("/participants");
  const rows = ((lp.body as any)?.participants ?? []) as any[];
  const tower = rows.find((r) => r.project.code === "TWR");
  t.check("Layla (Authorized Person) sees each Project DCL takes part in: name, code, number, Host Company, own role", lp.status === 200 && !!tower && tower.hostCompany.legalName.en === "TMC Constructions" && tower.projectRole.baseRole === "consultant" && !!tower.project.projectNumber, JSON.stringify(tower));
  const members = await layla.get(`/participants/${tower.id}/members`);
  t.check("...and her own Company's Project Members there, never another Participant", members.status === 200 && ((members.body as any).members ?? []).every((m: any) => /designconsultants\./.test(m.email ?? "")) && !OTHERS.test(JSON.stringify(rows.map((r) => r.hostCompany)).replace("TMC", "")), `${members.status}`);
  const inv = ((await layla.get("/participant-invitations")).body as any)?.invitations;
  t.check("Pending invitations are listed (none now, or by Project name, Host Company and role only)", Array.isArray(inv), "");
  const hp = await hafiz.get("/participants");
  const { context, page } = await pageAs("hafiz");
  let landed: string;
  try {
    await page.goto(`${webUrl}/en/participants`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    landed = page.url();
    await t.shot(page, "hafiz-company-projects");
  } finally {
    await context.close();
  }
  t.check("Hafiz (a plain Member) opens Company Projects read-only (V15: every Member of a Participant sees it; design: 'other Members see it read-only')", hp.status === 200 && /\/participants/.test(landed), `api ${hp.status} ${hp.text}; page ended at ${landed}`);
  const { context: c2, page: p2 } = await pageAs("layla");
  try {
    await p2.goto(`${webUrl}/en/participants`, { waitUntil: "networkidle" });
    await p2.waitForTimeout(800);
    await t.shot(p2, "layla-company-projects");
  } finally {
    await c2.close();
  }
  t.note("FAIL (PAR-13 Hafiz): steps: sign in as Hafiz (TMC Engineer, not an Authorized Person), open /en/participants (Company Projects). Expected: V15 first bullet, GLOSSARY Company Projects and design/prompts/participants.md: every Member of a Participant sees their Company Projects (other Members read-only): Project name, code, number, Host Company, own role and own Project Members. Actual: Hafiz is sent to Home. Screenshot: evidence/PAR-13-1-hafiz-company-projects.jpg (Home, no Company Projects page).");
  t.note("Hafiz: GET /v1/participants answers 403 and /en/participants redirects a non-Authorized Person to Home, so only the Authorized Person has a Company Projects page. docs/visibility.md V15 first bullet and design/prompts/participants.md say other Members see it read-only.");
});

defineCase("PAR-14", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const saeed = await crew.as("saeed");
  const beta = await participantIdByName(saeed, pid, "Beta Build");
  const vis = await participantVisibility(saeed, beta);
  t.check("Fixture FX-C2: Beta Build covers Tower 2 only (Location)", !vis.location.isAll && vis.location.valueIds.join() === crew.dims.location.T2, JSON.stringify(vis.location));
  const yousef = await crew.as("yousef");
  const rows = await listAll(yousef, pid, "");
  const codes = rows.map((r) => r.location?.code ?? "");
  t.check("Yousef sees only Tower 2 items from then on (no Tower 1 row)", codes.every((c) => /^T2/.test(c)), [...new Set(codes)].join());
  const tmc = await participantVisibility(saeed, await participantIdByName(saeed, pid, "TMC"));
  t.check("TMC is the only Contractor covering Tower 1 (all Locations)", tmc.location.isAll === true, JSON.stringify(tmc.location));
  const { context, page } = await pageAs("yousef");
  try {
    await page.goto(`${webUrl}/en/projects/${pid}/work-items`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await t.shot(page, "yousef-list");
  } finally {
    await context.close();
  }
  t.note("The fixture was applied by `run.ts --fixtures` (FX-C2). This Test Case checks its effect rather than re-doing the click-through.");
});

defineCase("PAR-15", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const layla = await crew.as("layla");
  const dclPart = await myParticipantId(layla, pid);
  const sara = await memberIdOf(layla, dclPart, emailOf.sara!);
  const vis = await memberVisibility(layla, dclPart, sara);
  t.check("Fixture FX-K1M: Sara's Trade is Mechanical only", !vis.trade.isAll && vis.trade.valueIds.join() === crew.dims.trade.ME, JSON.stringify(vis.trade));
  const rows = await listAll(await crew.as("sara"), pid, "");
  t.check("Sara no longer sees Electrical items (her List holds none)", rows.every((r) => r.trade.code !== "EL"), [...new Set(rows.map((r) => r.trade.code))].join());
  const ahmedRows = await listAll(await crew.as("ahmed"), pid, "");
  t.check("Ahmed still covers both Trades (he lists Electrical items)", ahmedRows.some((r) => r.trade.code === "EL"), `${ahmedRows.length}`);
  const ahmedVis = await memberVisibility(layla, dclPart, await memberIdOf(layla, dclPart, emailOf.ahmed!));
  t.check("Ahmed's grant is all Trades", ahmedVis.trade.isAll === true, JSON.stringify(ahmedVis.trade));
  const { context, page } = await pageAs("sara");
  try {
    await page.goto(`${webUrl}/en/projects/${pid}/work-items`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await t.shot(page, "sara-list");
  } finally {
    await context.close();
  }
  t.note("The fixture was applied by `run.ts --fixtures` (FX-K1M). Handover for a Step Sara held is not exercised (she holds none).");
});

defineCase("PAR-16", async (t) => {
  t.blocked("Needs FX-OW: UAT Owner Co is onboarded in Rabaed Admin (ADM-02: password plus an emailed code of the Rabaed Engineer, done by a person), then Saeed invites CR 9999000005 as Owner on Riyadh Gate Tower and Reem UAT accepts, grants Electrical and Mechanical and adds Sami UAT as PM. Fixture status: manual (results/fixtures.json).");
});

export const _used = [pageIsNotFound, must];
