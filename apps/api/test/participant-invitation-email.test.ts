// Seam 1: the Participant Invitation email (RP-1072; ADR 0009; visibility.md V15, scenarios 31, 38
// and RP-1072-1). A Project Admin invites a Company by its CR number and gets one answer whether or
// not the CR number is a Company on Rabaed. When it is, the worker later emails that Company's
// Authorized Person, in their language, what they see of the invitation before accepting: the
// Project's name, the Host Company and the offered Project Role. An unknown CR number sends nothing,
// and neither does an invitation withdrawn before the worker sends it.
import { createDb, participantInvitationHandler, processOutbox } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { ParticipantInvitationEmail } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, uniqueCr, uniqueEmail, type Caller, type OnboardedCompany } from "./support/harness.ts";

const api = await createTestApi();
const urls = testDatabaseUrls();
// The worker connects as the app role, with no Member set.
const worker = createDb(urls.app, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });

/** Every Participant Invitation email the worker sent. */
const sent: ParticipantInvitationEmail[] = [];
const handler = participantInvitationHandler(async (email) => void sent.push(email));
/** Sends every Participant Invitation email due, as the worker does. */
async function drain() {
  for (;;) {
    const run = await processOutbox(worker, { handlers: { participant_invitation: handler }, kinds: ["participant_invitation"] });
    if (run.processed + run.failed + run.dead === 0) return;
  }
}
afterAll(async () => {
  await drain();
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

const to = (email: string) => sent.filter((m) => m.to === email);

let host: Caller;
let projectId: string;

beforeAll(async () => {
  host = (await api.projectCreator()).caller;
  projectId = (await api.createProject(host, { role: "owner" })).id;
});

/** A Company on Rabaed whose Authorized Person has signed in once, in `locale`. */
async function customer(locale: "en" | "ar" = "en"): Promise<OnboardedCompany> {
  const company = await api.onboardCompany({
    authorizedPerson: { email: uniqueEmail("authorized-person"), fullName: { en: "Invited Person", ar: "المدعو" }, locale },
  });
  await api.acceptInvitation(company.invitationToken);
  return company;
}

const invite = (crNumber: string, role = "consultant") => host.post(`/v1/projects/${projectId}/participants`, { crNumber, role });

/** What the Project Admin can observe of an answer. */
const seen = (res: Awaited<ReturnType<typeof invite>>) => ({
  status: res.statusCode,
  body: res.body,
  cookies: res.cookies,
  contentType: res.headers["content-type"],
  contentLength: res.headers["content-length"],
});

const pendingId = async (crNumber: string) =>
  ((await host.get(`/v1/projects/${projectId}/invitations`)).json().invitations as { id: string; crNumber: string }[]).find(
    (i) => i.crNumber === crNumber,
  )!.id;

describe("inviting a Company by CR number (scenario RP-1072-1)", () => {
  it("answers a customer's CR number and an unknown one alike, and sends nothing before the worker runs", async () => {
    const k1 = await customer();
    await drain();
    const before = sent.length;
    const known = await invite(k1.crNumber);
    const unknown = await invite(uniqueCr());
    expect(seen(known)).toEqual({ status: 202, body: "", cookies: [], contentType: undefined, contentLength: "0" });
    expect(seen(unknown)).toEqual(seen(known));
    // Asynchronous: the answer went back before any email.
    expect(sent.length).toBe(before);
    await drain();
    // One email, the customer's; the unknown CR number stays an onboarding lead and sends none.
    expect(sent.slice(before)).toEqual([expect.objectContaining({ to: k1.authorizedPerson.email })]);
  });

  it("emails the Authorized Person only the Project's name, the Host Company and the offered Project Role", async () => {
    const k1 = await customer();
    expect((await invite(k1.crNumber, "consultant")).statusCode).toBe(202);
    await drain();
    expect(to(k1.authorizedPerson.email)).toEqual([
      {
        to: k1.authorizedPerson.email,
        language: "en",
        projectName: { en: "Riyadh Gate Tower", ar: "برج بوابة الرياض" },
        hostCompanyName: { en: "Test Constructions", ar: "إنشاءات الاختبار" },
        roleName: { en: "Consultant", ar: "الاستشاري" },
      },
    ]);
  });

  it("writes in the Authorized Person's language", async () => {
    const k1 = await customer("ar");
    expect((await invite(k1.crNumber)).statusCode).toBe(202);
    await drain();
    expect(to(k1.authorizedPerson.email)).toEqual([expect.objectContaining({ language: "ar" })]);
  });

  it("keeps only ids in the outbox: no CR number, email or name", async () => {
    const k1 = await customer();
    expect((await invite(k1.crNumber)).statusCode).toBe(202);
    const participantId = await pendingId(k1.crNumber);
    const { rows } = await sql<{ payload: Record<string, unknown> }>`
      select payload from outbox where kind = 'participant_invitation' and payload ->> 'participantId' = ${participantId}
    `.execute(migrator);
    expect(rows).toEqual([{ payload: { participantId, invitedAt: expect.any(String) } }]);
    await drain();
  });

  it("emails nobody for a Company whose Authorized Person has never signed in", async () => {
    const k1 = await api.onboardCompany();
    expect(seen(await invite(k1.crNumber))).toEqual(seen(await invite(uniqueCr())));
    await drain();
    expect(to(k1.authorizedPerson.email)).toEqual([]);
  });
});

describe("withdrawing an invitation (scenario 38)", () => {
  it("sends nothing for an invitation withdrawn before the worker ran, and answers both kinds alike", async () => {
    const k1 = await customer();
    const lead = uniqueCr();
    expect((await invite(k1.crNumber)).statusCode).toBe(202);
    expect((await invite(lead)).statusCode).toBe(202);
    const withdraw = async (crNumber: string) =>
      seen(await host.post(`/v1/projects/${projectId}/invitations/${await pendingId(crNumber)}/withdraw`));
    expect(await withdraw(k1.crNumber)).toEqual(await withdraw(lead));
    await drain();
    expect(to(k1.authorizedPerson.email)).toEqual([]);
  });

  it("sends nothing more once withdrawn, and one email for each invitation sent again", async () => {
    const k1 = await customer();
    expect((await invite(k1.crNumber)).statusCode).toBe(202);
    await drain();
    expect(to(k1.authorizedPerson.email)).toHaveLength(1);
    expect((await host.post(`/v1/projects/${projectId}/invitations/${await pendingId(k1.crNumber)}/withdraw`)).statusCode).toBe(204);
    await drain();
    expect(to(k1.authorizedPerson.email)).toHaveLength(1);
    // Invited again, in another Project Role: the new invitation's email, once.
    expect((await invite(k1.crNumber, "contractor")).statusCode).toBe(202);
    await drain();
    expect(to(k1.authorizedPerson.email).map((m) => m.roleName.en)).toEqual(["Consultant", "Contractor"]);
  });

  it("sends only the newest invitation when the Project Admin changes the offered Project Role before the worker runs", async () => {
    const k1 = await customer();
    expect((await invite(k1.crNumber, "consultant")).statusCode).toBe(202);
    expect((await invite(k1.crNumber, "contractor")).statusCode).toBe(202);
    await drain();
    expect(to(k1.authorizedPerson.email).map((m) => m.roleName.en)).toEqual(["Contractor"]);
  });
});
