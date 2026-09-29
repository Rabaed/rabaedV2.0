import type { Db } from "@rabaed/db";
import type { BaseRole, BilingualText, Locale } from "@rabaed/domain";
import type { FastifyInstance } from "fastify";
import { SESSION_COOKIE } from "../app.ts";
import { createEngineer } from "../identity/engineers.ts";

// The demo Project (RP-196): "Riyadh Gate Tower – Phase 2" with four Companies,
// their Members, Positions and Visibility, and a second Project no other demo
// Company is on (RP-213), built through the API itself (the
// same routes, validation and app.* functions a person would use), never raw
// SQL. A Rabaed Engineer onboards each Company through Rabaed Admin, which
// writes admin_action with the reason (visibility.md V9).
//
// The names, emails (on the reserved .test domain), CR and VAT numbers are all
// made up. Every demo person signs in with one password the caller supplies:
// generated on the developer's machine for `pnpm demo`, never in the repo.

type Coverage = { isAll: boolean; valueIds: string[] };

export interface DemoPerson {
  /** A stable key, e.g. "tmc-engineer". */
  key: string;
  email: string;
  name: BilingualText;
  company: string;
  /** Who they are in the walkthrough, e.g. "Contractor Engineer". */
  label: string;
}

export interface DemoSeed {
  projectId: string;
  /** Beta Build's own Jeddah Corniche Villas, with one Draft MAR; only Nasser is on it. */
  otherProjectId: string;
  engineer: DemoPerson;
  people: DemoPerson[];
}

/** The Rabaed Engineer's email: created first, so whether a seed started can be told from it. */
export const DEMO_ENGINEER_EMAIL = "engineer@rabaed.demo.rabaed.test";

/** The Draft the seed creates last: whether a seed finished can be told from it. */
export const DEMO_LAST_ITEM_TITLE = "Pump room ventilation";

type Method = "GET" | "POST" | "PUT" | "PATCH";
/** An API call; `T` is the answer's shape where the seed reads it. */
type Call = <T = unknown>(method: Method, url: string, body?: unknown) => Promise<T>;

/** Calls the API in-process like one browser, keeping its session cookie; any failure stops the seed. */
function browser(app: FastifyInstance): Call {
  let token: string | undefined;
  return async <T>(method: Method, url: string, body?: unknown): Promise<T> => {
    const res = await app.inject({
      method,
      url,
      cookies: token ? { [SESSION_COOKIE]: token } : {},
      ...(body === undefined ? {} : { payload: body as object }),
    });
    const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
    if (set) token = set.value || undefined;
    if (res.statusCode >= 400) throw new Error(`Demo seed: ${method} ${url} answered ${res.statusCode} ${res.body}`);
    return (res.body ? res.json() : null) as T;
  };
}

const bi = (en: string, ar: string): BilingualText => ({ en, ar });
const all: Coverage = { isAll: true, valueIds: [] };
const only = (...valueIds: string[]): Coverage => ({ isAll: false, valueIds });
const email = (local: string, domain: string) => `${local}@${domain}.demo.rabaed.test`;

interface Person {
  key: string;
  local: string;
  name: BilingualText;
  label: string;
  locale?: Locale;
}

interface Onboarded {
  caller: Call;
  authorizedPersonId: string;
  crNumber: string;
  domain: string;
  legalName: BilingualText;
}

/** Seeds the demo Project through `app`. `migrator` creates the Rabaed Engineer, as `pnpm engineer:create` does. */
export async function seedDemo(app: FastifyInstance, migrator: Db, password: string): Promise<DemoSeed> {
  const people: DemoPerson[] = [];

  const engineer: DemoPerson = {
    key: "rabaed-engineer",
    email: DEMO_ENGINEER_EMAIL,
    name: bi("Rabaed Demo Engineer", "مهندس رابض التجريبي"),
    company: "Rabaed",
    label: "Rabaed Engineer (Rabaed Admin)",
  };
  await createEngineer(migrator, { email: engineer.email, fullName: engineer.name.en, password });
  const admin = browser(app);
  await admin("POST", "/admin/v1/session", { email: engineer.email, password });

  /** The Engineer onboards a Company; its Authorized Person accepts the invitation. */
  async function onboard(n: number, domain: string, legalName: BilingualText, ap: Person): Promise<Onboarded> {
    // Made-up numbers in a range no real registration uses.
    const crNumber = `99990000${String(n).padStart(2, "0")}`;
    const r = await admin<{ authorizedPersonId: string; invitation: { token: string } }>("POST", "/admin/v1/companies", {
      legalName,
      crNumber,
      vatNumber: `3999900000000${n}3`,
      authorizedPerson: { email: email(ap.local, domain), fullName: ap.name, locale: ap.locale ?? "en" },
      reason: `Demo seed: onboarding ${legalName.en} for the Riyadh Gate Tower – Phase 2 walkthrough`,
    });
    const caller = browser(app);
    await caller("POST", "/v1/invitations/accept", { token: r.invitation.token, password });
    people.push({ key: ap.key, email: email(ap.local, domain), name: ap.name, company: legalName.en, label: ap.label });
    return { caller, authorizedPersonId: r.authorizedPersonId, crNumber, domain, legalName };
  }

  const authorizedPerson = (key: string, local: string, name: BilingualText, locale?: Locale): Person => ({
    key,
    local,
    name,
    label: "Authorized Person",
    locale,
  });
  const tmc = await onboard(
    1,
    "tmc",
    bi("TMC Constructions", "تي إم سي للإنشاءات"),
    authorizedPerson("tmc-authorized-person", "saeed.alqahtani", bi("Saeed Al Qahtani", "سعيد القحطاني")),
  );
  const beta = await onboard(
    2,
    "betabuild",
    bi("Beta Build", "بيتا للبناء"),
    authorizedPerson("beta-authorized-person", "nasser.aldosari", bi("Nasser Al Dosari", "ناصر الدوسري")),
  );
  const dcl = await onboard(
    3,
    "designconsultants",
    bi("Design Consultants LLC", "المصممون الاستشاريون ذ.م.م"),
    authorizedPerson("dcl-authorized-person", "layla.mansour", bi("Layla Mansour", "ليلى منصور")),
  );
  const waha = await onboard(
    4,
    "alwaha",
    bi("Al Waha PMC", "الواحة لإدارة المشاريع"),
    authorizedPerson("waha-authorized-person", "hind.almutairi", bi("Hind Al Mutairi", "هند المطيري"), "ar"),
  );

  // TMC's Authorized Person may create Projects, and creates this one: TMC is its Project Admin.
  await tmc.caller("PATCH", `/v1/members/${tmc.authorizedPersonId}`, { canCreateProjects: true });
  const { projectId } = await tmc.caller<{ projectId: string }>("POST", "/v1/projects", {
    name: bi("Riyadh Gate Tower – Phase 2", "برج بوابة الرياض – المرحلة 2"),
    code: "TWR",
    role: "contractor",
  });

  // Trades and a small Location tree: Zone → Building → Floor.
  const trade = async (code: string, name: BilingualText) =>
    (await tmc.caller<{ id: string }>("POST", `/v1/projects/${projectId}/trades`, { code, name })).id;
  const location = async (code: string, name: BilingualText, parentId: string | null) =>
    (await tmc.caller<{ id: string }>("POST", `/v1/projects/${projectId}/locations`, { code, name, parentId })).id;
  const electrical = await trade("EL", bi("Electrical Works", "الأعمال الكهربائية"));
  const mechanical = await trade("ME", bi("Mechanical Works", "الأعمال الميكانيكية"));
  const zone = await location("MZ", bi("Main Zone", "المنطقة الرئيسية"), null);
  const tower1 = await location("T1", bi("Tower 1", "البرج 1"), zone);
  const tower2 = await location("T2", bi("Tower 2", "البرج 2"), zone);
  for (const floor of ["01", "02", "03"]) {
    await location(`T1F${floor}`, bi(`Tower 1 Floor ${floor}`, `البرج 1 الطابق ${floor}`), tower1);
  }
  const tower2Floor1 = await location("T2F01", bi("Tower 2 Floor 01", "البرج 2 الطابق 01"), tower2);

  // Participants, each invited by the Project Admin and accepted by its own
  // Authorized Person (ADR 0009), and what each covers (set by the Project Admin). Beta Build
  // covers exactly what TMC does: only the Company boundary keeps TMC's items from it (V3).
  const { participants } = await tmc.caller<{ participants: { id: string; isOwnCompany: boolean }[] }>(
    "GET",
    `/v1/projects/${projectId}/participants`,
  );
  const participantOf = async (company: Onboarded, role: BaseRole) => {
    await tmc.caller("POST", `/v1/projects/${projectId}/participants`, { crNumber: company.crNumber, role });
    const { invitations } = await company.caller<{ invitations: { id: string }[] }>("GET", "/v1/participant-invitations");
    await company.caller("POST", `/v1/participant-invitations/${invitations[0]!.id}/accept`);
    return invitations[0]!.id;
  };
  const participant = {
    tmc: participants.find((p) => p.isOwnCompany)!.id,
    beta: await participantOf(beta, "contractor"),
    dcl: await participantOf(dcl, "consultant"),
    waha: await participantOf(waha, "owner_representative"),
  };
  const cover = (participantId: string, trades: Coverage, locations: Coverage) =>
    tmc.caller("PUT", `/v1/participants/${participantId}/visibility`, { trade: trades, location: locations });
  await cover(participant.tmc, only(electrical), all);
  await cover(participant.beta, only(electrical), all);
  await cover(participant.dcl, only(electrical, mechanical), all);
  await cover(participant.waha, only(electrical), all);

  /** Invited by their Authorized Person, added to the Project with a Position and all of their Participant's Visibility. */
  async function member(company: Onboarded, participantId: string, person: Person, positions: string[]) {
    const address = email(person.local, company.domain);
    const invited = await company.caller<{ memberId: string; invitation: { token: string } }>("POST", "/v1/members", {
      email: address,
      fullName: person.name,
      locale: person.locale ?? "en",
    });
    await browser(app)("POST", "/v1/invitations/accept", { token: invited.invitation.token, password });
    await company.caller("POST", `/v1/participants/${participantId}/members`, { memberId: invited.memberId });
    await company.caller("PUT", `/v1/participants/${participantId}/members/${invited.memberId}/visibility`, {
      trade: all,
      location: all,
    });
    await company.caller("PUT", `/v1/participants/${participantId}/members/${invited.memberId}/positions`, { positions });
    people.push({ key: person.key, email: address, name: person.name, company: company.legalName.en, label: person.label });
  }

  const hafiz = { key: "tmc-engineer", local: "hafiz.hamdan", name: bi("Hafiz Hamdan", "حافظ حمدان"), label: "Contractor Engineer" };
  await member(tmc, participant.tmc, hafiz, ["engineer"]);
  const ali = { key: "tmc-pm", local: "ali.sonour", name: bi("Ali Sonour", "علي سنور"), label: "Contractor Project Manager" };
  await member(tmc, participant.tmc, ali, ["project_manager"]);
  const yousef = { key: "beta-engineer", local: "yousef.karim", name: bi("Yousef Karim", "يوسف كريم"), label: "Second Contractor Engineer" };
  await member(beta, participant.beta, yousef, ["engineer"]);
  const ahmed = { key: "dcl-engineer-ahmed", local: "ahmed.binsaid", name: bi("Ahmed bin Said", "أحمد بن سعيد"), label: "Consultant Engineer" };
  await member(dcl, participant.dcl, ahmed, ["engineer"]);
  const sara = { key: "dcl-engineer-sara", local: "sara", name: bi("Sara", "سارة"), label: "Consultant Engineer" };
  await member(dcl, participant.dcl, sara, ["engineer"]);
  const mohammed = { key: "dcl-manager", local: "mohammed.alshamsi", name: bi("Mohammed Al Shamsi", "محمد الشامسي"), label: "Consultant Manager" };
  await member(dcl, participant.dcl, mohammed, ["manager"]);
  const faisal: Person = {
    key: "waha-engineer",
    local: "faisal.alotaibi",
    name: bi("Faisal Al Otaibi", "فيصل العتيبي"),
    label: "Owner Representative Engineer",
    locale: "ar",
  };
  await member(waha, participant.waha, faisal, ["engineer"]);

  // One Draft of TMC's own, so a fresh demo has a Riyadh Gate Tower Work Item
  // for the deploy's visibility check to try as someone from another Project.
  const hafizCaller = browser(app);
  await hafizCaller("POST", "/v1/session", { email: email(hafiz.local, tmc.domain), password });
  await hafizCaller("POST", `/v1/projects/${projectId}/work-items`, {
    type: "MAR",
    title: "Emergency lighting – Tower 2",
    tradeId: electrical,
    locationId: tower2Floor1,
  });

  // A second Project: Beta Build's own, with only its Authorized Person on it
  // and one Draft. Nobody on Riyadh Gate Tower is on it, and Nasser is on
  // nothing else, so each sees only their own Project (the deploy's
  // visibility check in dev, packages/infra/src/smoke.ts).
  await beta.caller("PATCH", `/v1/members/${beta.authorizedPersonId}`, { canCreateProjects: true });
  const { projectId: otherProjectId } = await beta.caller<{ projectId: string }>("POST", "/v1/projects", {
    name: bi("Jeddah Corniche Villas", "فلل كورنيش جدة"),
    code: "JCV",
    role: "contractor",
  });
  const plumbing = (await beta.caller<{ id: string }>("POST", `/v1/projects/${otherProjectId}/trades`, { code: "PL", name: bi("Plumbing Works", "أعمال السباكة") })).id;
  const { participants: betaParticipants } = await beta.caller<{ participants: { id: string; isOwnCompany: boolean }[] }>(
    "GET",
    `/v1/projects/${otherProjectId}/participants`,
  );
  const betaOwn = betaParticipants.find((p) => p.isOwnCompany)!.id;
  await beta.caller("PUT", `/v1/participants/${betaOwn}/visibility`, { trade: only(plumbing), location: all });
  await beta.caller("PUT", `/v1/participants/${betaOwn}/members/${beta.authorizedPersonId}/visibility`, { trade: all, location: all });
  await beta.caller("PUT", `/v1/participants/${betaOwn}/members/${beta.authorizedPersonId}/positions`, { positions: ["engineer"] });
  // Last: ensureDemo takes this Draft as the sign that the seed finished.
  await beta.caller("POST", `/v1/projects/${otherProjectId}/work-items`, { type: "MAR", title: DEMO_LAST_ITEM_TITLE, tradeId: plumbing });

  return { projectId, otherProjectId, engineer, people };
}
