import { randomInt, randomUUID } from "node:crypto";
import type { Db } from "@rabaed/db";
import type { BaseRole, BilingualText, Locale } from "@rabaed/domain";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { SESSION_COOKIE } from "../app.ts";
import { createEngineer } from "../identity/engineers.ts";

// The demo Project (RP-196): "Riyadh Gate Tower – Phase 2" with four Companies,
// their Members, Positions and Visibility, built through the API itself (the
// same routes, validation and app.* functions a person would use), never raw
// SQL. A Rabaed Engineer onboards each Company through Rabaed Admin, which
// writes admin_action with the reason (visibility.md V9).
//
// Every demo person signs in with one password generated on the developer's
// machine (see cli/demo-seed.ts); nothing secret is in the repo.

type Coverage = { isAll: boolean; valueIds: string[] };

export interface DemoPerson {
  /** A stable key for the walkthrough, e.g. "tmc-engineer". */
  key: string;
  email: string;
  name: BilingualText;
  company: string;
  /** What they are in the walkthrough, e.g. "Contractor Engineer". */
  role: string;
}

export interface DemoSeed {
  projectId: string;
  engineer: DemoPerson;
  people: DemoPerson[];
}

export interface SeedOptions {
  /** The one password every demo person signs in with. */
  password: string;
  /**
   * Adds a random tag to emails and uses random CR and VAT numbers, so the seed
   * can run beside other data (tests). The local demo resets the database first
   * and uses the fixed ones.
   */
  unique?: boolean;
}

/** An API call; `T` is the answer's shape where the seed reads it. */
type Call = <T = unknown>(method: "GET" | "POST" | "PUT" | "PATCH", url: string, body?: unknown) => Promise<T>;

/** Calls the API in-process like one browser, keeping its session cookie; any failure stops the seed. */
function browser(app: FastifyInstance): Call {
  let token: string | undefined;
  return async <T>(method: "GET" | "POST" | "PUT" | "PATCH", url: string, body?: unknown): Promise<T> => {
    const res: LightMyRequestResponse = await app.inject({
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

/** Seeds the demo Project through `app`. `migrator` creates the Rabaed Engineer, as `pnpm engineer:create` does. */
export async function seedDemo(app: FastifyInstance, migrator: Db, options: SeedOptions): Promise<DemoSeed> {
  const { password } = options;
  const tag = options.unique ? `-${randomUUID().slice(0, 8)}` : "";
  const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
  const email = (local: string, domain: string) => `${local}@${domain}${tag}.demo.rabaed.test`;
  const people: DemoPerson[] = [];

  // The Rabaed Engineer who onboards the Companies.
  const engineer: DemoPerson = {
    key: "rabaed-engineer",
    email: email("engineer", "rabaed"),
    name: bi("Rabaed Demo Engineer", "مهندس رابض التجريبي"),
    company: "Rabaed",
    role: "Rabaed Engineer (Rabaed Admin)",
  };
  await createEngineer(migrator, { email: engineer.email, fullName: engineer.name.en, password });
  const admin = browser(app);
  await admin("POST", "/admin/v1/session", { email: engineer.email, password });

  async function onboard(
    n: number,
    domain: string,
    legalName: BilingualText,
    ap: { local: string; name: BilingualText; locale: Locale },
  ) {
    const crNumber = options.unique ? digits(10) : `70100000${String(n).padStart(2, "0")}`;
    const vatNumber = options.unique ? `3${digits(13)}3` : `3001000000000${n}3`;
    const r = await admin<{ companyId: string; authorizedPersonId: string; invitation: { token: string } }>("POST", "/admin/v1/companies", {
      legalName,
      crNumber,
      vatNumber,
      authorizedPerson: { email: email(ap.local, domain), fullName: ap.name, locale: ap.locale },
      reason: `Demo seed: onboarding ${legalName.en} for the Riyadh Gate Tower – Phase 2 walkthrough`,
    });
    const caller = browser(app);
    await caller("POST", "/v1/invitations/accept", { token: r.invitation.token, password });
    people.push({
      key: `${domain}-authorized-person`,
      email: email(ap.local, domain),
      name: ap.name,
      company: legalName.en,
      role: "Authorized Person",
    });
    return { caller, companyId: r.companyId, authorizedPersonId: r.authorizedPersonId, crNumber, domain };
  }

  const tmc = await onboard(1, "tmc", bi("TMC Constructions", "تي إم سي للإنشاءات"), {
    local: "saeed.alqahtani",
    name: bi("Saeed Al Qahtani", "سعيد القحطاني"),
    locale: "en",
  });
  const beta = await onboard(2, "betabuild", bi("Beta Build", "بيتا للبناء"), {
    local: "nasser.aldosari",
    name: bi("Nasser Al Dosari", "ناصر الدوسري"),
    locale: "en",
  });
  const dcl = await onboard(3, "designconsultants", bi("Design Consultants LLC", "المصممون الاستشاريون ذ.م.م"), {
    local: "layla.mansour",
    name: bi("Layla Mansour", "ليلى منصور"),
    locale: "en",
  });
  const waha = await onboard(4, "alwaha", bi("Al Waha PMC", "الواحة لإدارة المشاريع"), {
    local: "hind.almutairi",
    name: bi("Hind Al Mutairi", "هند المطيري"),
    locale: "ar",
  });

  // TMC's Authorized Person may create Projects, and creates this one: TMC is its Project Admin.
  await tmc.caller("PATCH", `/v1/members/${tmc.authorizedPersonId}`, { canCreateProjects: true });
  const { projectId } = await tmc.caller<{ projectId: string }>("POST", "/v1/projects", {
    name: bi("Riyadh Gate Tower – Phase 2", "برج بوابة الرياض – المرحلة 2"),
    code: "TWR",
    role: "contractor",
  });

  // Trades and a small Location tree: Zone → Building → Floor.
  const add = async (kind: "trades" | "locations", code: string, name: BilingualText, parentId?: string) =>
    (
      await tmc.caller<{ id: string }>("POST", `/v1/projects/${projectId}/${kind}`, {
        code,
        name,
        ...(kind === "locations" ? { parentId: parentId ?? null } : {}),
      })
    ).id;
  const electrical = await add("trades", "EL", bi("Electrical Works", "الأعمال الكهربائية"));
  const mechanical = await add("trades", "ME", bi("Mechanical Works", "الأعمال الميكانيكية"));
  const zone = await add("locations", "MZ", bi("Main Zone", "المنطقة الرئيسية"));
  const tower1 = await add("locations", "T1", bi("Tower 1", "البرج 1"), zone);
  const tower2 = await add("locations", "T2", bi("Tower 2", "البرج 2"), zone);
  for (const floor of ["01", "02", "03"]) {
    await add("locations", `T1F${floor}`, bi(`Tower 1 Floor ${floor}`, `البرج 1 الطابق ${floor}`), tower1);
  }
  await add("locations", "T2F01", bi("Tower 2 Floor 01", "البرج 2 الطابق 01"), tower2);

  // Participants and what each covers (set by the Project Admin).
  const { participants: onProject } = await tmc.caller<{ participants: { id: string; isOwnCompany: boolean }[] }>(
    "GET",
    `/v1/projects/${projectId}/participants`,
  );
  const tmcParticipant = onProject.find((p) => p.isOwnCompany)!.id;
  const participantOf = async (company: { crNumber: string }, role: BaseRole) =>
    (await tmc.caller<{ participantId: string }>("POST", `/v1/projects/${projectId}/participants`, { crNumber: company.crNumber, role }))
      .participantId;
  const participants = {
    tmc: tmcParticipant,
    beta: await participantOf(beta, "contractor"),
    dcl: await participantOf(dcl, "consultant"),
    waha: await participantOf(waha, "owner_representative"),
  };
  const cover = (participantId: string, trade: Coverage, location: Coverage) =>
    tmc.caller("PUT", `/v1/participants/${participantId}/visibility`, { trade, location });
  await cover(participants.tmc, only(electrical), all);
  await cover(participants.beta, only(electrical), only(tower2));
  await cover(participants.dcl, only(electrical, mechanical), all);
  await cover(participants.waha, only(electrical), all);

  // Members: invited by their Authorized Person, added to the Project with a Position and Visibility.
  async function member(
    company: Awaited<ReturnType<typeof onboard>>,
    participantId: string,
    key: string,
    local: string,
    name: BilingualText,
    role: string,
    positions: string[],
    locale: Locale = "en",
  ) {
    const address = email(local, company.domain);
    const invited = await company.caller<{ memberId: string; invitation: { token: string } }>("POST", "/v1/members", {
      email: address,
      fullName: name,
      locale,
    });
    await browser(app)("POST", "/v1/invitations/accept", { token: invited.invitation.token, password });
    await company.caller("POST", `/v1/participants/${participantId}/members`, { memberId: invited.memberId });
    await company.caller("PUT", `/v1/participants/${participantId}/members/${invited.memberId}/visibility`, {
      trade: all,
      location: all,
    });
    await company.caller("PUT", `/v1/participants/${participantId}/members/${invited.memberId}/positions`, { positions });
    const legalName = people.find((p) => p.key === `${company.domain}-authorized-person`)!.company;
    people.push({ key, email: address, name, company: legalName, role });
  }

  await member(tmc, participants.tmc, "tmc-engineer", "hafiz.hamdan", bi("Hafiz Hamdan", "حافظ حمدان"), "Contractor Engineer", ["engineer"]);
  await member(tmc, participants.tmc, "tmc-pm", "ali.sonour", bi("Ali Sonour", "علي سنور"), "Contractor Project Manager", ["project_manager"]);
  await member(beta, participants.beta, "beta-engineer", "yousef.karim", bi("Yousef Karim", "يوسف كريم"), "Second Contractor Engineer", ["engineer"]);
  await member(dcl, participants.dcl, "dcl-engineer-ahmed", "ahmed.binsaid", bi("Ahmed bin Said", "أحمد بن سعيد"), "Consultant Engineer", ["engineer"]);
  await member(dcl, participants.dcl, "dcl-engineer-sara", "sara.alharbi", bi("Sara Al Harbi", "سارة الحربي"), "Consultant Engineer", ["engineer"]);
  await member(dcl, participants.dcl, "dcl-manager", "mohammed.alshamsi", bi("Mohammed Al Shamsi", "محمد الشامسي"), "Consultant Manager", ["manager"]);
  await member(waha, participants.waha, "waha-engineer", "faisal.alotaibi", bi("Faisal Al Otaibi", "فيصل العتيبي"), "Owner Representative Engineer", ["engineer"], "ar");

  return { projectId, engineer, people };
}
