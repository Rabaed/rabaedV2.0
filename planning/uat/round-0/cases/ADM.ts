import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sessionFile, webUrl } from "../harness/browser.ts";
import { defineCase } from "../harness/case.ts";
import { tracker } from "../harness/helpers-not.ts";

// Part ADM: Rabaed Admin. Signing in needs the Rabaed Engineer's password and an emailed code, and
// no script may handle that password, so the cases that need a session are for a person. What needs
// no session is checked here: the sign-in page, a wrong code, and the Company app's session at Admin.

const adminUrl = `http://127.0.0.1:${process.env.ADMIN_PORT ?? "4750"}`;
const NEEDS_ENGINEER = "Rabaed Admin sign-in needs the Engineer password and code: run by a person";

/** The Cookie header of a demo person's Company-app session (never printed). */
function companyCookieHeader(person: string): string {
  const state = JSON.parse(readFileSync(resolve(sessionFile(person)), "utf8")) as { cookies: { name: string; value: string }[] };
  return state.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

/** What Admin answers with no session, and with the Company app's session. */
async function noSessionChecks(t: ReturnType<typeof tracker>): Promise<void> {
  const page = await fetch(`${adminUrl}/`);
  const html = await page.text();
  t.check("Rabaed Admin's sign-in page loads on its own address (port 4750)", page.status === 200 && /<form|password|sign/i.test(html), `${page.status}`);
  const me = await fetch(`${adminUrl}/v1/me`);
  t.check("Admin's api refuses a request with no session (401)", me.status === 401, `${me.status}`);
  const wrong = await fetch(`${adminUrl}/v1/sign-in/code`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "000000" }) });
  t.check("a wrong code with no sign-in under way is refused and sets no session", wrong.status === 401 && !/session=/.test(wrong.headers.get("set-cookie") ?? ""), `${wrong.status}`);
  const company = await fetch(`${adminUrl}/v1/me`, { headers: { cookie: companyCookieHeader("hafiz") } });
  t.check("the Company app's session (Hafiz) does not open Admin (401)", company.status === 401, `${company.status}`);
  const workflows = await fetch(`${adminUrl}/v1/workflows`, { headers: { cookie: companyCookieHeader("saeed") } });
  t.check("... nor does a Project Admin's (Saeed) open Admin's Workflows (401)", workflows.status === 401, `${workflows.status}`);
}

defineCase("ADM-01", async (t) => {
  const c = tracker(t);
  await noSessionChecks(c);
  t.manual(
    `${NEEDS_ENGINEER}. Steps: 1) open ${adminUrl}/ 2) enter the Engineer's email and password 3) read the 6-digit code from Mailpit (127.0.0.1:8725) 4) enter a wrong code (refused), request codes repeatedly (limit message), then the right code. Expected: session cookie that is not the Company app's. Script found, without a session: the page loads, a wrong code is refused with no cookie, and the Company app's sessions get 401 at Admin.`,
  );
});

defineCase("ADM-02", async (t) => {
  t.manual(`${NEEDS_ENGINEER}. Steps: onboard UAT Owner Co (legal names EN/AR, CR 9999000005, VAT 399990000000053, Authorized Person Reem UAT on a .demo.rabaed.test address, language, reason); open the invitation in Mailpit; accept as Reem. This also makes fixture FX-OW (PAR-16).`);
});

defineCase("ADM-03", async (t) => {
  t.manual(`${NEEDS_ENGINEER}. Steps: onboard with CR 9999000001 (expect refusal naming the CR number), then a new CR with an existing email (refusal naming the email); check no Company was created.`);
});

defineCase("ADM-04", async (t) => {
  t.manual(`${NEEDS_ENGINEER}. Steps: Saeed invites a CR not on Rabaed (PAR-06 variant); Engineer: Show leads (reason), Close lead (reason); Saeed still sees his invitation pending and both kinds of CR give him the same answer.`);
});

defineCase("ADM-05", async (t) => {
  t.manual(`${NEEDS_ENGINEER}. Steps: create an Option List with three levels; edit and retire an option, each with a reason; check the retired option stays where chosen but is not offered.`);
});

defineCase("ADM-06", async (t) => {
  t.manual(`${NEEDS_ENGINEER}. Steps: Numbering: enter a Project id and a reason, show it; set a pattern, a Participant Code (2 to 6 letters or digits, fixed once used) and a starting number; every read and edit needs a reason.`);
});

defineCase("ADM-07", async (t) => {
  t.manual(`${NEEDS_ENGINEER}. Steps: Workflows: open MAR; Save draft; Publish with a reason; add an outcome and a Stage, rename and reorder; check each change is refused without a reason and logged, and that no Member can open a Rabaed Default draft.`);
});

defineCase("ADM-08", async (t) => {
  t.manual(`${NEEDS_ENGINEER}. Steps: add an outcome to a Type's set; publish a Rabaed Default Version using it while the seeded Project lacks it; expect a refusal with a count and the missing outcomes or Stages, no Project or Company named, nothing published, refusal logged.`);
});

defineCase("ADM-09", async (t) => {
  const c = tracker(t);
  const webPort = new URL(webUrl).port;
  const adminOnWeb = await fetch(`http://127.0.0.1:${webPort}/workflows`);
  const adminOnWeb2 = await fetch(`http://127.0.0.1:${webPort}/records`);
  c.check("Admin pages (/workflows, /records) are not served on the web port", adminOnWeb.status === 404 && adminOnWeb2.status === 404, `${adminOnWeb.status}, ${adminOnWeb2.status}`);
  const webOnAdmin = await fetch(`${adminUrl}/en/projects`);
  c.check("a Company app URL (/en/projects) is not served on the Admin port", webOnAdmin.status === 404, `${webOnAdmin.status}`);
  c.check("the two have different addresses", new URL(webUrl).host !== new URL(adminUrl).host, `${new URL(webUrl).host} vs ${new URL(adminUrl).host}`);
  const adminCookie = await fetch(`${adminUrl}/v1/me`, { headers: { cookie: companyCookieHeader("hafiz") } });
  c.check("the Company app's cookie does not open Admin", adminCookie.status === 401, `${adminCookie.status}`);
  t.manual(`The no-session parts passed by script. A person still signs out of one and checks the other stays signed in (needs an Engineer session: ${NEEDS_ENGINEER}).`);
});

defineCase("ADM-10", async (t) => {
  t.notRun("not built: Rabaed Admin has no item commands (companies, numbering, option lists, Workflows, record jobs only), so an Engineer cannot reassign or reset a Step");
});
