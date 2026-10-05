import { randomUUID } from "node:crypto";
import { createEngineer, onboardCompany } from "@rabaed/admin/services";
import type { Db } from "@rabaed/db";
import type { BaseRole, BilingualText, Locale, StartedDocumentUpload, VisibilityGrant } from "@rabaed/domain";
import type { FastifyInstance } from "fastify";
import { SESSION_COOKIE } from "../app.ts";
import { demoPdf } from "./demo-pdf.ts";
import { jpegWithExif } from "./exif-jpeg.ts";

// The demo Project (RP-196): "Riyadh Gate Tower – Phase 2" with four Companies,
// their Members, Positions and Visibility, and a second Project no other demo
// Company is on (RP-213), built through the API itself (the
// same routes, validation and app.* functions a person would use), never raw
// SQL. A Rabaed Engineer onboards each Company through Rabaed Admin's domain
// service (apps/admin), which writes admin_action with the reason
// (visibility.md V9), as the admin service's own screen does.
//
// The names, emails (on the reserved .test domain), CR and VAT numbers are all
// made up. Every demo person signs in with one password the caller supplies:
// generated on the developer's machine for `pnpm demo`, never in the repo.

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

/** A small photo of a sample luminaire (a JPEG, 96 × 64), for the demo MAR's Sample photo. */
const SAMPLE_PHOTO_JPEG =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCABAAGADASIAAhEBAxEB/8QAGQABAQEBAQEAAAAAAAAAAAAAAAUEAQMG/8QALxAAAQICBgkEAwEAAAAAAAAAAAEEAgMFERIUFdEhUlNUc5GTorETNUbBBiJB8f/EABcBAQEBAQAAAAAAAAAAAAAAAAABAgP/xAAXEQEBAQEAAAAAAAAAAAAAAAAAAQIR/9oADAMBAAIRAxEAPwD60AFQB4uHUltZ9aOzarq0Kvg8cUZ7btXIDYDHijPbdq5DFGe27VyA2Ax4oz23auQxRntu1cgNgMeKM9t2rkekh63cRrBJmWokSuqpU0AaAAAAAE6koUifMIYkRYVmVKipoXTCV7i03WR00JNIe4UfxfuEvE0sZ7i03WR00FxabrI6aGg6c7ris1wabrI6aC4tN1kdNDScUTXTjPcWm6yOmhIly4JX5A5glwQwQpLSqGFKkTRCXyF8jdcNPEJuJW8AGkAABPpD3Cj+L9wl4g0h7hR/F+4S8Z0sDpwVmLOq6cUVgScAhfI3XDTxCXSF8jdcNPEJvKVvABpAAAZnjKW8sepFGliuqyqf3/DNgrbXm80yKQAm4K215vNMhgrbXm80yKQKJuCttebzTIYK215vNMikAJuCttebzTI9mlHymk1ZkuKNVVLP7KmRsBAAAH//2Q==";

/** The MAR the seed ends with Code C and Remarks, after the Consultant's verification (RP-306). */
export const CODE_C_TITLE = "Cable tray risers – Tower 1";

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
const all: VisibilityGrant = { isAll: true, valueIds: [] };
const only = (...valueIds: string[]): VisibilityGrant => ({ isAll: false, valueIds });
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

/** The databases the seed needs besides the customer api's own. */
export interface SeedDatabases {
  /** Creates the Rabaed Engineer, as `pnpm engineer:create` does. */
  migrator: Db;
  /** rabaed_admin, for the Engineer's onboardings, as Rabaed Admin connects. */
  admin: Db;
}

export interface SeedOptions {
  /**
   * The api `app` has a file store, so the seed may upload a MAR's Datasheet and Sample photo.
   * Left off where none is reachable: the migration task has no access to
   * the Project files bucket (only the api does, ADR 0007).
   */
  files?: boolean;
}

// Each invitation is accepted at once.
const INVITATION_TTL_MS = 3_600_000;

/** Seeds the demo Project through `app`, the customer api, and Rabaed Admin's onboarding. */
export async function seedDemo(
  app: FastifyInstance,
  databases: SeedDatabases,
  password: string,
  options: SeedOptions = {},
): Promise<DemoSeed> {
  const people: DemoPerson[] = [];

  const engineer: DemoPerson = {
    key: "rabaed-engineer",
    email: DEMO_ENGINEER_EMAIL,
    name: bi("Rabaed Demo Engineer", "مهندس رابض التجريبي"),
    company: "Rabaed",
    label: "Rabaed Engineer (Rabaed Admin)",
  };
  const engineerId = await createEngineer(databases.migrator, { email: engineer.email, fullName: engineer.name.en, password });

  /** The Engineer onboards a Company; its Authorized Person accepts the invitation. */
  async function onboard(n: number, domain: string, legalName: BilingualText, ap: Person): Promise<Onboarded> {
    // Made-up numbers in a range no real registration uses.
    const crNumber = `99990000${String(n).padStart(2, "0")}`;
    const r = await onboardCompany(
      databases.admin,
      engineerId,
      {
        legalName,
        crNumber,
        vatNumber: `3999900000000${n}3`,
        authorizedPerson: { email: email(ap.local, domain), fullName: ap.name, locale: ap.locale ?? "en" },
        reason: `Demo seed: onboarding ${legalName.en} for the Riyadh Gate Tower – Phase 2 walkthrough`,
      },
      new Date(),
      INVITATION_TTL_MS,
    );
    if (!r.ok) throw new Error(`Demo seed: onboarding ${legalName.en} conflicts on ${r.conflict}`);
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
  const tower1Floors: string[] = [];
  for (const floor of ["01", "02", "03"]) {
    tower1Floors.push(await location(`T1F${floor}`, bi(`Tower 1 Floor ${floor}`, `البرج 1 الطابق ${floor}`), tower1));
  }
  const tower2Floor1 = await location("T2F01", bi("Tower 2 Floor 01", "البرج 2 الطابق 01"), tower2);

  // Scopes of Electrical, chosen in the MAR Form's Scopes field.
  const scope = async (name: BilingualText, parentId: string | null = null) =>
    (await tmc.caller<{ id: string }>("POST", `/v1/projects/${projectId}/scopes`, { tradeId: electrical, parentId, name })).id;
  const lighting = await scope(bi("Lighting", "الإنارة"));
  const emergencyLighting = await scope(bi("Emergency lighting", "إنارة الطوارئ"), lighting);
  await scope(bi("Power distribution", "توزيع الطاقة"));

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
  const grantVisibility = (participantId: string, trades: VisibilityGrant, locations: VisibilityGrant) =>
    tmc.caller("PUT", `/v1/participants/${participantId}/visibility`, { trade: trades, location: locations });
  await grantVisibility(participant.tmc, only(electrical), all);
  await grantVisibility(participant.beta, only(electrical), all);
  await grantVisibility(participant.dcl, only(electrical, mechanical), all);
  await grantVisibility(participant.waha, only(electrical), all);

  /**
   * Invited by their Authorized Person, added to the Project with a Position and
   * all of their Participant's Visibility, or only the Locations in `locations`.
   */
  async function member(company: Onboarded, participantId: string, person: Person, positions: string[], locations: VisibilityGrant = all) {
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
      location: locations,
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
  // A second TMC engineer who covers Tower 2 only: a Link to a Tower 1 item is
  // its Document Number and Subject to him, nothing more (E1, RP-294).
  const omar = {
    key: "tmc-engineer-tower2",
    local: "omar.alharbi",
    name: bi("Omar Al Harbi", "عمر الحربي"),
    label: "Contractor Engineer (Tower 2 only)",
  };
  await member(tmc, participant.tmc, omar, ["engineer"], only(tower2));

  // One Draft of TMC's own, so a fresh demo has a Riyadh Gate Tower Work Item
  // for the deploy's visibility check to try as someone from another Project.
  const hafizCaller = browser(app);
  await hafizCaller("POST", "/v1/session", { email: email(hafiz.local, tmc.domain), password });
  const { id: emergencyLightingId } = await hafizCaller<{ id: string }>("POST", `/v1/projects/${projectId}/work-items`, {
    type: "MAR",
    title: "Emergency lighting – Tower 2",
    // Filled through the MAR Form (Version 3): its Items, and its Built-in Fields; no Related submittals.
    answers: {
      manufacturer: "Zumtobel",
      model: "RESCLITE PRO",
      specification_section: "26 52 13",
      description: "LED emergency luminaires for the Tower 2 escape routes, 3-hour duration, self-test.",
      items: [
        { fixture_type: "Escape route luminaire", description: "Ceiling mounted, 3-hour, self-test", quantity: 36, unit: "pcs" },
        { fixture_type: "Anti-panic luminaire", description: "Wall mounted, 3-hour, self-test", quantity: 12, unit: "pcs" },
      ],
      trade: electrical,
      location: tower2Floor1,
      scopes: [lighting, emergencyLighting],
    },
  });

  // Its Datasheet (a PDF) and a Sample photo, taken on site with its time and
  // place, uploaded as the browser does: a signed URL from the API, the file,
  // then the API told it is there.
  const upload = async (itemId: string, file: { fieldKey: string; fileName: string; contentType: string; body: Buffer }) => {
    const documents = `/v1/work-items/${itemId}/documents`;
    const { body, ...start } = file;
    const started = await hafizCaller<StartedDocumentUpload>("POST", documents, { ...start, sizeBytes: body.byteLength });
    const put = await fetch(started.upload.url, { method: started.upload.method, headers: started.upload.headers, body });
    if (!put.ok) throw new Error(`Demo seed: the file store answered ${put.status} to ${file.fileName}`);
    await hafizCaller("POST", `${documents}/${started.id}/confirm`);
  };
  if (options.files) {
    await upload(emergencyLightingId, {
      fieldKey: "datasheet",
      fileName: "RESCLITE-PRO-datasheet.pdf",
      contentType: "application/pdf",
      body: demoPdf([
        "Zumtobel RESCLITE PRO",
        "LED emergency luminaire for escape routes and anti-panic areas.",
        "Duration: 3 hours. Self-test. IP 65.",
        "Demo datasheet: made up for the Rabaed demo.",
      ]),
    });
    await upload(emergencyLightingId, {
      fieldKey: "sample_photo",
      fileName: "RESCLITE-PRO-sample.jpg",
      contentType: "image/jpeg",
      body: jpegWithExif(
        { takenAt: "2026:09:28 10:15:00", offset: "+03:00", latitude: 24.7136, longitude: 46.6753 },
        Buffer.from(SAMPLE_PHOTO_JPEG, "base64"),
      ),
    });

    // Links (RP-294): an approved MAR in Tower 1, and a MAR on the Form Version 3
    // in Tower 2 that links it under Related submittals and as a free Link,
    // Submitted to the Consultant. Omar, who covers Tower 2 only, reads the
    // approved MAR as its number and Subject. Each MAR needs its Datasheet to
    // leave Draft, so they come only with the file store.
    const signedIn = async (company: Onboarded, person: Person) => {
      const caller = browser(app);
      await caller("POST", "/v1/session", { email: email(person.local, company.domain), password });
      return caller;
    };
    const aliCaller = await signedIn(tmc, ali);
    const mohammedCaller = await signedIn(dcl, mohammed);
    const ahmedCaller = await signedIn(dcl, ahmed);
    const take = (caller: Call, itemId: string, transition: string) =>
      caller("POST", `/v1/work-items/${itemId}/transitions`, { transition, idempotencyKey: randomUUID() });
    /**
     * Hafiz raises the MAR with its Datasheet and its free Links to `freeLinks`, and
     * sends it; Ali claims it and Submits it to the Consultant.
     */
    const submitted = async (title: string, datasheet: string[], answers: Record<string, unknown>, freeLinks: string[] = []) => {
      const { id } = await hafizCaller<{ id: string }>("POST", `/v1/projects/${projectId}/work-items`, { type: "MAR", title, answers });
      for (const target of freeLinks) await hafizCaller("POST", `/v1/work-items/${id}/links`, { workItemId: target });
      await upload(id, { fieldKey: "datasheet", fileName: `${datasheet[0]!.replaceAll(" ", "-")}-datasheet.pdf`, contentType: "application/pdf", body: demoPdf(datasheet) });
      await take(hafizCaller, id, "send_for_review");
      await aliCaller("POST", `/v1/work-items/${id}/claim`);
      await take(aliCaller, id, "submit");
      return id;
    };
    const exitSignage = await submitted(
      "Exit signage – Tower 1",
      ["Thorn Voyager", "LED exit sign, maintained, 3-hour duration.", "Demo datasheet: made up for the Rabaed demo."],
      {
        manufacturer: "Thorn",
        model: "Voyager",
        specification_section: "26 52 13",
        description: "LED exit signs for the Tower 1 escape routes, maintained, 3-hour duration.",
        items: [{ fixture_type: "Exit sign", description: "Ceiling mounted, double sided", quantity: 24, unit: "pcs" }],
        trade: electrical,
        location: tower1Floors[0],
        scopes: [lighting, emergencyLighting],
      },
    );
    // The MAR Form Version 4's Consultant verification: filled in by the Consultant at
    // its review Step (the Contractor reads it empty until the item leaves), then the Code.
    // `answers` over what the Consultant reads, as the web form saves.
    const verify = async (itemId: string, verification: Record<string, unknown>) => {
      const { answers } = await ahmedCaller<{ answers: Record<string, unknown> }>("GET", `/v1/work-items/${itemId}`);
      await ahmedCaller("PUT", `/v1/work-items/${itemId}/answers`, { answers: { ...answers, ...verification } });
    };
    await verify(exitSignage, { sample_checked: true, matches_specification: true });
    await mohammedCaller("POST", `/v1/work-items/${exitSignage}/claim`);
    await take(mohammedCaller, exitSignage, "approve_a");
    // In Tower 2, linking the approved exit signs it supervises twice: under
    // Related submittals (the Form Version 3's link question) and as a free Link.
    await submitted(
      "Emergency lighting control panel – Tower 2",
      ["Zumtobel ONLITE CPS", "Central battery panel for emergency luminaires and exit signs.", "Demo datasheet: made up for the Rabaed demo."],
      {
        manufacturer: "Zumtobel",
        model: "ONLITE CPS",
        specification_section: "26 52 13",
        description: "Central battery panel monitoring the Tower 2 emergency luminaires and exit signs.",
        items: [{ fixture_type: "Central battery panel", description: "Wall mounted, 3-hour", quantity: 1, unit: "set" }],
        trade: electrical,
        location: tower2Floor1,
        scopes: [lighting, emergencyLighting],
        related_submittals: [exitSignage],
      },
      [exitSignage],
    );

    // The part 3 flow (Form Version 4, MAR Workflow Version 2), ending with Code C and
    // Remarks. The Consultant's verification sits empty for the Contractor, marked
    // "Filled in by the Consultant", until the Code is issued; Ahmed fills it at the review
    // Step, and Mohammed issues Code C with Remarks. No Revision follows: create_revision
    // comes with RP-103.
    const cableTray = await submitted(
      CODE_C_TITLE,
      ["Legrand Cablofil CF 54", "Wire mesh cable tray, hot dip galvanised.", "Demo datasheet: made up for the Rabaed demo."],
      {
        manufacturer: "Legrand",
        model: "Cablofil CF 54",
        specification_section: "26 05 36",
        description: "Wire mesh cable trays for the Tower 1 electrical risers.",
        items: [{ fixture_type: "Cable tray", description: "Wire mesh, 300 mm wide, 3 m lengths", quantity: 180, unit: "m" }],
        trade: electrical,
        location: tower1Floors[1],
      },
    );
    await verify(cableTray, {
      sample_checked: true,
      matches_specification: false,
      verification_note:
        "The tray is electro-zinc plated, not hot dip galvanised as the specification requires. / اللوحة مجلفنة كهربائياً وليست مجلفنة بالغمس الساخن كما تشترط المواصفات.",
    });
    await mohammedCaller("POST", `/v1/work-items/${cableTray}/claim`);
    await mohammedCaller("POST", `/v1/work-items/${cableTray}/transitions`, {
      transition: "revise_c",
      answers: {
        remarks:
          "Resubmit with hot dip galvanised trays (EN ISO 1461). / أعد التقديم بلوحات مجلفنة بالغمس الساخن (EN ISO 1461).",
      },
      idempotencyKey: randomUUID(),
    });
  }

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
  await beta.caller("POST", `/v1/projects/${otherProjectId}/work-items`, {
    type: "MAR",
    title: DEMO_LAST_ITEM_TITLE,
    answers: {
      manufacturer: "Geberit",
      description: "PP-R water supply pipes and fittings for the villas.",
      items: [{ fixture_type: "PP-R pipe", description: "25 mm, PN 20", quantity: 120, unit: "m" }],
      trade: plumbing,
    },
  });

  return { projectId, otherProjectId, engineer, people };
}
