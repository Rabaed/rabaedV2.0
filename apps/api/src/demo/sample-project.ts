import { randomUUID } from "node:crypto";
import type { Db } from "@rabaed/db";
import type { BaseRole, BilingualText, DimensionValues, ParticipantMembers, StartedDocumentUpload, Visibility, VisibilityGrant, WorkItemDetail } from "@rabaed/domain";
import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import { demoPdf } from "./demo-pdf.ts";
import { jpegWithExif } from "./exif-jpeg.ts";
import {
  SAMPLE_PROJECT,
  SAMPLE_LOCATIONS,
  SAMPLE_SUPPLIERS,
  SAMPLE_TRADES,
  SAMPLE_CHECKLISTS,
  sampleInspections,
  samplePackages,
  sampleSnags,
  sampleSubmittals,
  type SampleDraft,
  type SampleInspection,
  type SamplePackage,
  type SampleSnag,
  type SampleSubmittal,
  type TradeCode,
} from "./sample-project-plan.ts";
import { browser, demoEmail, SAMPLE_PHOTO_JPEG, type Call } from "./demo-api.ts";

// The sample Project (RP-1217): Al Nakheel District – Block A, a second Project of the demo's
// Companies with a realistic volume of records, added to a database the demo is already in
// (UAT's, without a reset: Riyadh Gate Tower stays as it is). Everything goes through the api's
// own routes as the demo's people, as seed.ts does: the Project Admin builds the Project, each
// Authorized Person adds their own Members, and every item is raised and moved Step by Step by
// whoever holds it. The migrator only reads (which items exist) and holds the lock.
//
// Idempotent: the Project, its Trades, Locations, suppliers, Participants and Members are added
// only where missing, and an item whose Subject is already on the Project is left as it is (a run
// cut short mid-item leaves that one item where it stopped). A second run changes nothing.
// It needs the file store: every Submittal leaves Draft with its Datasheet.

const LOCK_KEY = 718_201_217;

/** The demo people the sample Project needs, as seed.ts creates them. Nasser stays on Jeddah Corniche Villas only. */
const PEOPLE = {
  saeed: ["saeed.alqahtani", "tmc"],
  layla: ["layla.mansour", "designconsultants"],
  hind: ["hind.almutairi", "alwaha"],
  nasser: ["nasser.aldosari", "betabuild"],
  hafiz: ["hafiz.hamdan", "tmc"],
  ali: ["ali.sonour", "tmc"],
  yousef: ["yousef.karim", "betabuild"],
  ahmed: ["ahmed.binsaid", "designconsultants"],
  sara: ["sara", "designconsultants"],
  mohammed: ["mohammed.alshamsi", "designconsultants"],
  faisal: ["faisal.alotaibi", "alwaha"],
  noura: ["noura.alharbi", "alwaha"],
} as const;
type Who = keyof typeof PEOPLE;

// eslint-disable-next-line rabaed/no-avoid-terms -- the Project Manager Position's key, as GLOSSARY.md's Position entry names it.
const PM = "project_manager";

/** Each Company on the Project: its Authorized Person, CR number (seed.ts's made-up ones), Role and Members with their Positions. */
const COMPANIES: { ap: Who; crNumber: string; role: BaseRole; members: [Who, string[]][] }[] = [
  { ap: "saeed", crNumber: "9999000001", role: "contractor", members: [["hafiz", ["engineer"]], ["ali", [PM]]] },
  // Yousef is Beta Build's only Member here, so he also Submits its Packages (RP-1220): Project Manager beside Engineer.
  { ap: "nasser", crNumber: "9999000002", role: "contractor", members: [["yousef", ["engineer", PM]]] },
  { ap: "layla", crNumber: "9999000003", role: "consultant", members: [["ahmed", ["engineer"]], ["sara", ["engineer"]], ["mohammed", ["manager"]]] },
  { ap: "hind", crNumber: "9999000004", role: "owner_representative", members: [["faisal", ["engineer"]], ["noura", [PM]]] },
];

const all: VisibilityGrant = { isAll: true, valueIds: [] };

/** Each Contractor's people for its own submittals and Packages: who raises them, who Submits them (RP-1220). */
const SIDES = {
  tmc: { raiser: "hafiz", pm: "ali", company: "TMC Constructions" },
  beta: { raiser: "yousef", pm: "yousef", company: "Beta Build" },
} as const satisfies Record<SamplePackage["owner"], { raiser: Who; pm: Who; company: string }>;
type Side = keyof typeof SIDES;

export interface SampleProjectResult {
  projectId: string;
  /** Items this run raised (Code B's Comments and Revisions not counted). */
  added: number;
  /** Planned items already on the Project, left as they were. */
  present: number;
  /** Packages this run put together (RP-1220), and those already there, left as they were. */
  packages: { added: number; present: number };
}

/** What the seed builds: the Project's items, then its Packages (which take some of those items in). */
export interface SampleRecords {
  submittals: SampleSubmittal[];
  snags: SampleSnag[];
  /** Its Inspections (RP-1220): items of their own, as the Submittals are. */
  inspections: SampleInspection[];
  packages: SamplePackage[];
}

/** The whole sample Project, as sample-project-plan.ts lays it out. */
export const sampleRecords = (): SampleRecords => ({ submittals: sampleSubmittals(), snags: sampleSnags(), inspections: sampleInspections(), packages: samplePackages() });

/** Which Project: the sample Project itself, or (a seam test) another of the same make. */
export type SampleProjectName = { code: string; name: BilingualText };

/** What the run prints: counts only, never a Subject or an email (the UAT job's log is public). */
export type SampleLog = (line: string) => void;

/**
 * A failure as the public UAT log may print it: a refused api call by its method, path and status only,
 * never the answer's body, which can quote an answer or a Subject (RP-1217 review).
 */
export function publicFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/( answered \d{3})[\s\S]*$/, "$1");
}

export interface SampleProjectOptions {
  log?: SampleLog;
  /** How many items move at once; each needs its own api connection at times. */
  concurrency?: number;
  /** What to build; everything when left out (a seam test passes less). */
  records?: SampleRecords;
  /** Which Project; the sample Project when left out (a seam test names one of its own). */
  project?: SampleProjectName;
}

/**
 * Adds the sample Project through `app` (the customer api, with a file store), signing in as the
 * demo's people with `password`. `migrator` reads which items exist and serialises two runs.
 * Its items first, then its Packages, which take some of those items in (RP-1220).
 */
export async function addSampleProject(
  app: FastifyInstance,
  migrator: Db,
  password: string,
  { log = () => {}, concurrency = 4, records = sampleRecords(), project: which = SAMPLE_PROJECT }: SampleProjectOptions = {},
): Promise<SampleProjectResult> {
  return migrator.connection().execute(async (connection) => {
    await sql`select pg_advisory_lock(${LOCK_KEY})`.execute(connection);
    try {
      const as = await signInAll(app, password);
      const projectId = await project(as.saeed, which);
      const ids = await setUp(as, projectId, which);
      const titled = async (title: string) =>
        (await sql<{ id: string }>`select id from work_item where project_id = ${projectId}::uuid and title = ${title}`.execute(connection)).rows.map((r) => r.id);
      const { rows } = await sql<{ title: string }>`select distinct title from work_item where project_id = ${projectId}::uuid`.execute(connection);
      const existing = new Set(rows.map((r) => r.title));
      const run = new Runner(as, projectId, ids, titled);
      const planned = [
        ...records.submittals.map((item) => ({ title: item.title, move: () => run.submittal(item) })),
        ...records.snags.map((item) => ({ title: item.title, move: () => run.snag(item) })),
        ...records.inspections.map((item) => ({ title: item.title, move: () => run.inspection(item) })),
      ];
      const todo = planned.filter((p) => !existing.has(p.title));
      log(`sample project: ${planned.length - todo.length} of ${planned.length} item(s) already there; adding ${todo.length}`);
      let added = 0;
      await inParallel(
        todo.map((p) => async () => {
          await p.move();
          added++;
        }),
        concurrency,
      );
      log(`sample project: ${added} item(s) added`);

      // Each Contractor's Packages by name, its own Participant's only. One already there is finished if a run
      // stopped half way through it, and left as it is when complete.
      const found = new Map<string, string>();
      for (const side of Object.keys(SIDES) as Side[]) {
        const pm = as[SIDES[side].pm];
        const { participants } = await pm<{ participants: { id: string; isOwnCompany: boolean }[] }>("GET", `/v1/projects/${projectId}/participants`);
        const own = participants.find((p) => p.isOwnCompany)?.id;
        const { packages } = await pm<{ packages: { id: string; name: BilingualText; owner: { participantId: string } }[] }>("GET", `/v1/projects/${projectId}/packages`);
        for (const p of packages) if (p.owner.participantId === own) found.set(`${side}:${p.name.en}`, p.id);
      }
      const already = records.packages.filter((p) => found.has(`${p.owner}:${p.name.en}`)).length;
      log(`sample project: ${already} of ${records.packages.length} Package(s) already there; adding ${records.packages.length - already}`);
      let packagesAdded = 0;
      let packagesFinished = 0;
      await inParallel(
        records.packages.map((p) => async () => {
          const packageId = found.get(`${p.owner}:${p.name.en}`);
          if (!(await run.package(p, packageId))) return;
          if (packageId) packagesFinished++;
          else packagesAdded++;
        }),
        concurrency,
      );
      log(`sample project: ${packagesAdded} Package(s) added${packagesFinished ? `, ${packagesFinished} finished` : ""}`);
      return {
        projectId,
        added,
        present: planned.length - todo.length,
        packages: { added: packagesAdded, present: records.packages.length - packagesAdded - packagesFinished },
      };
    } finally {
      await sql`select pg_advisory_unlock(${LOCK_KEY})`.execute(connection);
    }
  });
}

/** How far the sample Project is on this database, read as the migrator and changing nothing: a dry run's answer. */
export async function sampleProjectStatus(
  migrator: Db,
  { records = sampleRecords(), project: which = SAMPLE_PROJECT }: Pick<SampleProjectOptions, "records" | "project"> = {},
): Promise<{ project: boolean; present: number; planned: number; packages: { present: number; planned: number } }> {
  // Every item it raises by Subject: a Package's own too, so a missing one shows before its Package.
  const titles = [...records.submittals, ...records.snags, ...records.inspections, ...records.packages.flatMap((p) => [...p.submitted, ...p.drafts])].map((p) => p.title);
  const { rows } = await sql<{ title: string }>`
    select distinct w.title from work_item w join project p on p.id = w.project_id
    where p.code = ${which.code} and p.name ->> 'en' = ${which.name.en} and w.title = any(${titles}::text[])
  `.execute(migrator);
  const { rows: projects } = await sql<{ n: number }>`
    select count(*)::int as n from project where code = ${which.code} and name ->> 'en' = ${which.name.en}
  `.execute(migrator);
  const names = records.packages.map((p) => p.name.en);
  const { rows: packages } = await sql<{ name: string }>`
    select distinct k.name ->> 'en' as name from package k join project p on p.id = k.project_id
    where p.code = ${which.code} and p.name ->> 'en' = ${which.name.en} and k.name ->> 'en' = any(${names}::text[])
  `.execute(migrator);
  return { project: projects[0]!.n > 0, present: rows.length, planned: titles.length, packages: { present: packages.length, planned: names.length } };
}

/** Runs `moves`, `n` at a time; after a failure it starts no more, waits for the rest, and throws the first. */
async function inParallel(moves: (() => Promise<void>)[], n: number): Promise<void> {
  let next = 0;
  let failure: { error: unknown } | undefined;
  const worker = async () => {
    while (!failure && next < moves.length) {
      const move = moves[next++]!;
      try {
        await move();
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, moves.length) }, worker));
  if (failure) throw failure.error;
}

type People = Record<Who, Call>;

/** Everyone signs in first, so a password that no longer works stops the run before it writes anything. */
async function signInAll(app: FastifyInstance, password: string): Promise<People> {
  const people = {} as People;
  for (const [who, [local, domain]] of Object.entries(PEOPLE) as [Who, readonly [string, string]][]) {
    const caller = browser(app);
    try {
      await caller("POST", "/v1/session", { email: demoEmail(local, domain), password });
    } catch {
      throw new Error(`Sample project: the demo person "${who}" could not sign in with the demo password; nothing was changed`);
    }
    people[who] = caller;
  }
  return people;
}

/** The Project, created by TMC's Authorized Person (its Project Admin) unless it is there. */
async function project(saeed: Call, which: SampleProjectName): Promise<string> {
  const { projects } = await saeed<{ projects: { id: string; code: string; name: BilingualText }[] }>("GET", "/v1/projects");
  // By its code and English name, as sampleProjectStatus finds it.
  const found = projects.find((p) => p.code === which.code && p.name.en === which.name.en);
  if (found) return found.id;
  const { projectId } = await saeed<{ projectId: string }>("POST", "/v1/projects", { name: which.name, code: which.code, role: "contractor" });
  return projectId;
}

interface Ids {
  trade: Record<TradeCode | "GEN", string>;
  location: Record<string, string>;
  supplier: Record<TradeCode, string>;
  /** Each Trade's Checklist Template: the Version a WIR's `checklist_template` names (RP-1220). */
  checklist: Record<TradeCode, string>;
}

const sameGrant = (a: VisibilityGrant, b: VisibilityGrant) => a.isAll === b.isAll && [...a.valueIds].sort().join() === [...b.valueIds].sort().join();
const sameVisibility = (a: Visibility, b: Visibility) => sameGrant(a.trade, b.trade) && sameGrant(a.location, b.location);

/** Trades, Locations, suppliers, Participants and Members: each added only where it is missing. */
async function setUp(as: People, projectId: string, which: SampleProjectName): Promise<Ids> {
  const admin = as.saeed;
  const dimensions = () => admin<DimensionValues>("GET", `/v1/projects/${projectId}/dimensions`);
  let have = await dimensions();
  for (const t of SAMPLE_TRADES) {
    if (!have.trade.some((v) => v.code === t.code)) await admin("POST", `/v1/projects/${projectId}/trades`, { code: t.code, name: t.name });
  }
  for (const l of SAMPLE_LOCATIONS) {
    if (have.location.some((v) => v.code === l.code)) continue;
    const parentId = l.parent ? (await dimensions()).location.find((v) => v.code === l.parent)!.id : null;
    await admin("POST", `/v1/projects/${projectId}/locations`, { code: l.code, name: l.name, parentId });
  }
  have = await dimensions();
  const byCode = (values: DimensionValues["trade"]) => Object.fromEntries(values.map((v) => [v.code, v.id]));
  const trade = byCode(have.trade) as Ids["trade"];
  const location = byCode(have.location);

  const supplier = {} as Record<TradeCode, string>;
  for (const t of SAMPLE_TRADES) {
    const url = `/v1/projects/${projectId}/approved-suppliers`;
    const { suppliers } = await admin<{ suppliers: { id: string; name: BilingualText }[] }>("GET", `${url}?tradeId=${trade[t.code]}`);
    supplier[t.code] =
      suppliers.find((s) => s.name.en === SAMPLE_SUPPLIERS[t.code].en)?.id ??
      (await admin<{ id: string }>("POST", url, { tradeId: trade[t.code], scopeId: null, name: SAMPLE_SUPPLIERS[t.code] })).id;
  }

  for (const company of COMPANIES) {
    const ap = as[company.ap];
    const participantId = await participantOf(as, ap, projectId, which, company.crNumber, company.role);
    const visibility = await admin<{ visibility: Visibility }>("GET", `/v1/participants/${participantId}/visibility`);
    if (!sameVisibility(visibility.visibility, { trade: all, location: all })) {
      await admin("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all });
    }
    const { members: colleagues } = await ap<{ members: { id: string; email: string }[] }>("GET", "/v1/members");
    for (const [who, positions] of company.members) {
      const email = demoEmail(PEOPLE[who][0], PEOPLE[who][1]);
      const memberId = colleagues.find((m) => m.email === email)?.id;
      if (!memberId) throw new Error(`Sample project: the demo person "${who}" is not a Member of their Company`);
      const onProject = await ap<ParticipantMembers>("GET", `/v1/participants/${participantId}/members`);
      const member = onProject.members.find((m) => m.id === memberId);
      if (!member) await ap("POST", `/v1/participants/${participantId}/members`, { memberId });
      // Sara works Mechanical only, as on Riyadh Gate Tower (RP-1207); everyone else all of their Participant's.
      const wanted: Visibility = who === "sara" ? { trade: { isAll: false, valueIds: [trade.ME] }, location: all } : { trade: all, location: all };
      const current = await ap<{ visibility: Visibility }>("GET", `/v1/participants/${participantId}/members/${memberId}/visibility`);
      if (!sameVisibility(current.visibility, wanted)) await ap("PUT", `/v1/participants/${participantId}/members/${memberId}/visibility`, wanted);
      if (!member || [...member.positions].sort().join() !== [...positions].sort().join()) {
        await ap("PUT", `/v1/participants/${participantId}/members/${memberId}/positions`, { positions });
      }
    }
  }
  // Each Trade's Checklist Template (RP-1220), added by the Project Admin unless one of its name is there: Pass,
  // Fail or N/A, a comment allowed, and a Failed check raises nothing of its own.
  const templates = () => admin<{ templates: { id: string; versionId: string; name: BilingualText; tradeId: string }[] }>("GET", `/v1/projects/${projectId}/checklist-templates`);
  let listed = (await templates()).templates;
  const checklist = {} as Record<TradeCode, string>;
  for (const t of SAMPLE_TRADES) {
    const { name, checks } = SAMPLE_CHECKLISTS[t.code];
    const mine = () => listed.find((x) => x.tradeId === trade[t.code] && x.name.en === name.en);
    if (!mine()) {
      const items = checks.map((c) => ({ key: c.key, text: c.text, comment: "optional", on_negative: "none" }));
      await admin("POST", `/v1/projects/${projectId}/checklist-templates`, { name, tradeId: trade[t.code], items });
      listed = (await templates()).templates;
    }
    checklist[t.code] = mine()!.versionId;
  }
  return { trade, location, supplier, checklist };
}

/** The Company's Participant on the Project: the Project Admin's own, or invited by CR number and accepted by its Authorized Person. */
async function participantOf(as: People, ap: Call, projectId: string, which: SampleProjectName, crNumber: string, role: BaseRole): Promise<string> {
  const mine = async () => (await ap<{ participants: { id: string; project: { id: string } }[] }>("GET", "/v1/participants")).participants.find((p) => p.project.id === projectId)?.id;
  const found = await mine();
  if (found) return found;
  const pending = async () =>
    (await ap<{ invitations: { id: string; project: { name: BilingualText } }[] }>("GET", "/v1/participant-invitations")).invitations.find((i) => i.project.name.en === which.name.en);
  if (!(await pending())) await as.saeed("POST", `/v1/projects/${projectId}/participants`, { crNumber, role });
  const invitation = await pending();
  if (!invitation) throw new Error("Sample project: a Participant invitation did not arrive");
  await ap("POST", `/v1/participant-invitations/${invitation.id}/accept`);
  const accepted = await mine();
  if (!accepted) throw new Error("Sample project: an accepted invitation made no Participant");
  return accepted;
}

const verified = (matches: boolean, why: string) => ({
  sample_checked: true,
  matches_specification: matches,
  // eslint-disable-next-line rabaed/no-avoid-terms -- the Screen's field key, as the MAR Form Version 4 named it.
  ...(matches ? {} : { verification_note: why }),
});

/** The Resolve Screen's answer (a Snag's or a Comment's). */
// eslint-disable-next-line rabaed/no-avoid-terms -- the Screen's field key.
const resolution = (text: string) => ({ resolution_note: text });

/** When an Inspection asks to be inspected: three days after the run, at 09:00 Riyadh time (06:00 UTC). */
const requestedFor = () => {
  const day = new Date(Date.now() + 3 * 24 * 3_600_000);
  day.setUTCHours(6, 0, 0, 0);
  return day.toISOString();
};

/** Moves each item, as whoever holds it. */
class Runner {
  constructor(
    private readonly as: People,
    private readonly projectId: string,
    private readonly ids: Ids,
    /** The ids of the Project's items with this Subject, read as the migrator (a Code B's Comments, by the row's comment). */
    private readonly titled: (title: string) => Promise<string[]>,
  ) {}

  /**
   * `by` takes `transition`, picking the Step up first when it sits in their Step Pool, and naming
   * TMC where the next Step could go to more than one Participant (a Snag's Contractor).
   */
  private async act(by: Call, id: string, transition: string, body: Record<string, unknown> = {}) {
    let detail = await by<WorkItemDetail>("GET", `/v1/work-items/${id}`);
    if (detail.actions.pickUp) {
      await by("POST", `/v1/work-items/${id}/pick-up`);
      detail = await by<WorkItemDetail>("GET", `/v1/work-items/${id}`);
    }
    const offered = detail.actions.transitions.find((t) => t.key === transition);
    if (!offered) throw new Error(`Sample project: ${transition} is not offered on ${detail.documentNumber ?? "a Draft"} (offered: ${detail.actions.transitions.map((t) => t.key).join(", ") || "none"})`);
    const participant = offered.participants?.find((p) => p.companyName.en === SIDES.tmc.company)?.participantId;
    await by("POST", `/v1/work-items/${id}/transitions`, { transition, confirmed: true, idempotencyKey: randomUUID(), ...body, ...(participant ? { participant } : {}) });
  }

  /** Picks the Step up, unless someone holds it already. */
  private async pickUp(by: Call, id: string) {
    const detail = await by<WorkItemDetail>("GET", `/v1/work-items/${id}`);
    if (detail.actions.pickUp) await by("POST", `/v1/work-items/${id}/pick-up`);
  }

  /** A file uploaded as the browser does: a signed URL from the api, the file, then the api told it is there. */
  private async upload(by: Call, itemId: string, fieldKey: string, fileName: string, contentType: string, body: Buffer) {
    const documents = `/v1/work-items/${itemId}/documents`;
    const started = await by<StartedDocumentUpload>("POST", documents, { fieldKey, fileName, contentType, sizeBytes: body.byteLength });
    const put = await fetch(started.upload.url, { method: started.upload.method, headers: started.upload.headers, body });
    if (!put.ok) throw new Error(`Sample project: the file store answered ${put.status}`);
    await by("POST", `${documents}/${started.id}/confirm`);
  }

  private photo(n: number) {
    return jpegWithExif({ takenAt: `2026:10:${String(10 + (n % 18)).padStart(2, "0")} 09:${String(10 + (n % 40)).padStart(2, "0")}:00`, offset: "+03:00", latitude: 24.77, longitude: 46.64 }, Buffer.from(SAMPLE_PHOTO_JPEG, "base64"));
  }

  /** A Submittal's Form answers: a SAR's of its supplier, else a MAR's of its product (a Draft's too). */
  private answers(item: Pick<SampleSubmittal, "trade" | "location" | "product" | "supplier">): Record<string, unknown> {
    const where = { trade: this.ids.trade[item.trade], location: this.ids.location[item.location] };
    const p = item.product;
    if (item.supplier) {
      return {
        supplier_name_en: item.supplier.name.en,
        supplier_name_ar: item.supplier.name.ar,
        commercial_registration_number: item.supplier.crNumber,
        country_of_origin: item.supplier.country,
        proposed_supply: item.supplier.supply,
        past_projects: [{ project_name: "Demo Business Park, Riyadh", year: 2024 }],
        ...where,
      };
    }
    return {
      manufacturer: p.manufacturer,
      supplier: this.ids.supplier[item.trade],
      model: p.model,
      specification_section: p.specificationSection,
      description: p.description,
      items: [p.item],
      ...where,
    };
  }

  /** `side`'s raiser creates the item as a Draft with its Datasheet (or company profile) and any Sample photo. */
  private async draft(item: SampleSubmittal | SampleDraft, side: Side): Promise<string> {
    const raiser = this.as[SIDES[side].raiser];
    const type = "type" in item ? item.type : "MAR";
    const answers = this.answers(item);
    const { id } = await raiser<{ id: string }>("POST", `/v1/projects/${this.projectId}/work-items`, { type, title: item.title, answers });
    const lines = [item.title, item.product.description, "Demo document: made up for the Rabaed demo."];
    if (type === "SAR") await this.upload(raiser, id, "company_profile", "company-profile.pdf", "application/pdf", demoPdf(lines));
    else await this.upload(raiser, id, "datasheet", `${item.product.model.replaceAll(/[^A-Za-z0-9]+/g, "-")}-datasheet.pdf`, "application/pdf", demoPdf(lines));
    if ("samplePhoto" in item && item.samplePhoto) await this.upload(raiser, id, "sample_photo", "sample.jpg", "image/jpeg", this.photo(item.title.length));
    return id;
  }

  async submittal(item: SampleSubmittal) {
    const { hafiz, ali } = this.as;
    const id = await this.draft(item, "tmc");
    await this.act(hafiz, id, "send_for_review");
    if (item.end === "with_pm") return;
    if (item.end === "returned") {
      return this.act(ali, id, "return", { answers: { reason: "Add the model's test certificate and resend. / أضف شهادة اختبار الطراز وأعد الإرسال." } });
    }
    await this.act(ali, id, "submit", { answers: { cover_note: `${item.product.name} for ${item.location}, as specified in ${item.product.specificationSection}.` } });
    await this.reviewed(id, item, "tmc");
  }

  /**
   * A Package (RP-1220): its Contractor's PM puts it together. TMC's take in the Project's Submittals as they
   * stand; Beta Build's own are raised, sent for review and held by Yousef, Submitted together by Submit Package,
   * then each moves on to its own end. An Open one holds Drafts only.
   */
  /**
   * Puts the Package together, or finishes one a run cut short (`packageId`): each submittal it takes in, Draft
   * and own submittal is added only where missing, and its own are Submitted (Submit Package) only while some
   * are still to Submit. Whether it changed anything.
   */
  async package(p: SamplePackage, packageId?: string): Promise<boolean> {
    const { raiser: raiserKey, pm: pmKey } = SIDES[p.owner];
    const raiser = this.as[raiserKey];
    const pm = this.as[pmKey];
    let changed = packageId === undefined;
    const id = packageId ?? (await pm<{ id: string }>("POST", `/v1/projects/${this.projectId}/packages`, { name: p.name })).id;
    const detail = () => pm<{ status: string; items: { id: string; title: string; toSubmit: boolean }[] }>("GET", `/v1/packages/${id}`);
    const inIt = new Set((await detail()).items.map((i) => i.id));
    const add = async (by: Call, workItemId: string) => {
      if (inIt.has(workItemId)) return;
      await by("POST", `/v1/packages/${id}/items`, { workItemId });
      inIt.add(workItemId);
      changed = true;
    };
    /** The item with this Subject: the Project's, else made now by `make`. */
    const item = async (title: string, make?: () => Promise<string>) => {
      const [found] = await this.titled(title);
      if (found) return found;
      if (!make) throw new Error("Sample project: a Package's submittal is not on the Project");
      changed = true;
      return make();
    };
    for (const title of p.existing) await add(pm, await item(title));
    for (const d of p.drafts) await add(raiser, await item(d.title, () => this.draft(d, p.owner)));
    // A run cut short may have left one: still a Draft (never sent), or Submitted but not yet moved on.
    const resume: { id: string; s: SampleSubmittal }[] = [];
    for (const s of p.submitted) {
      const made = await item(s.title, () => this.draft(s, p.owner));
      const at = await raiser<WorkItemDetail>("GET", `/v1/work-items/${made}`);
      if (at.stage.key === "draft") {
        await this.act(raiser, made, "send_for_review");
        changed = true;
      } else if (packageId && at.step?.key === "consultant_engineer" && s.end !== "with_consultant_engineer") resume.push({ id: made, s });
      await add(pm, made);
    }
    for (const { id: stuck, s } of resume) {
      await this.reviewed(stuck, s, p.owner);
      changed = true;
    }
    // Only its own submittals are Submitted: an Open Package's Drafts stay Drafts.
    const own = new Set(p.submitted.map((s) => s.title));
    const toSubmit = (await detail()).items.filter((i) => i.toSubmit && own.has(i.title));
    if (toSubmit.length === 0) return changed;
    for (const i of toSubmit) await this.pickUp(pm, i.id);
    await pm("POST", `/v1/packages/${id}/submit`, { confirmed: true, idempotencyKey: randomUUID() });
    // Each one Submitted now moves on to its own end.
    for (const i of toSubmit) {
      const planned = p.submitted.find((s) => s.title === i.title);
      if (planned) await this.reviewed(i.id, planned, p.owner);
    }
    return true;
  }

  /**
   * An Inspection (RP-1220) on the current WIR Workflow: its Contractor raises it with its Trade's Checklist
   * Template and sends it; its PM Submits it (or returns it); Design Consultants' Engineer answers its Checklist on
   * site and Sends it to Mohammed with a Recommended Code; Mohammed issues the Code (ADR 0025). A Code C is
   * re-inspected as its Rev 1.
   */
  async inspection(i: SampleInspection) {
    const raiser = this.as[SIDES[i.owner].raiser];
    const pm = this.as[SIDES[i.owner].pm];
    const answers = {
      description: i.description,
      // A few days after the run, at 09:00 Riyadh: a Form answer, not a due date.
      requested_for: requestedFor(),
      trade: this.ids.trade[i.trade],
      location: this.ids.location[i.location],
      checklist_template: this.ids.checklist[i.trade],
    };
    const { id } = await raiser<{ id: string }>("POST", `/v1/projects/${this.projectId}/work-items`, { type: "WIR", title: i.title, answers });
    if (i.end === "draft") return;
    await this.act(raiser, id, "send_for_review");
    if (i.end === "with_pm") return;
    if (i.end === "returned") return this.act(pm, id, "return", { answers: { reason: "Clean the work face and photograph the work first. / نظّف الموقع وصوّر العمل أولاً." } });
    await this.act(pm, id, "submit", { answers: { cover_note: "Ready on site from 09:00. / جاهز في الموقع من الساعة 09:00." } });
    await this.inspected(id, i, i.end, i.recommendedCode, i.failing ?? []);
    if (!i.revision) return;
    // Rev 1: the raiser creates it from the closed Inspection, its answers and Checklist copied, and it is
    // inspected again: still with the Consultant Engineer, or passed at Code A.
    const { id: rev1 } = await raiser<{ id: string }>("POST", `/v1/work-items/${id}/revisions`, { idempotencyKey: randomUUID() });
    await this.act(raiser, rev1, "send_for_review");
    await this.act(pm, rev1, "submit", { answers: { cover_note: "Corrected and ready again. / تم التصحيح وجاهز مجدداً." } });
    if (i.revision === "open") await this.inspected(rev1, i, "with_consultant_engineer", undefined, []);
    else await this.inspected(rev1, { ...i, comments: [] }, "code_a", "A", []);
  }

  /** From the Consultant Engineer's Step on, for an Inspection: its Checklist answered, `failing` Failed, then `end`. */
  private async inspected(id: string, i: SampleInspection, end: SampleInspection["end"], code: SampleInspection["recommendedCode"], failing: string[]) {
    const { mohammed } = this.as;
    const engineer = this.as[i.consultantEngineer ?? (i.trade === "ME" ? "sara" : "ahmed")];
    if (end === "with_consultant_engineer") {
      if (i.consultantEngineer) await this.pickUp(engineer, id);
      return;
    }
    await this.pickUp(engineer, id);
    const checks = Object.fromEntries(
      SAMPLE_CHECKLISTS[i.trade].checks.map((c) => [c.key, failing.includes(c.key) ? { answer: "fail", comment: "Not as per the drawing. / غير مطابق للمخطط." } : { answer: "pass" }]),
    );
    await engineer("PUT", `/v1/work-items/${id}/reply-checklists/inspection_checklist`, { answers: checks });
    const matches = code === "A" || code === "B";
    await this.act(engineer, id, "send_to_manager", { recommendedCode: code, internalNote: matches ? "Inspected on site: as per the drawing." : "Inspected on site: see the failed Checklist items." });
    if (end === "with_consultant_manager") {
      if (i.title.length % 2 === 0) await this.pickUp(mohammed, id);
      return;
    }
    const verification = verified(matches, "The work is not as per the drawing. / العمل غير مطابق للمخطط.");
    if (end === "code_a") await this.act(mohammed, id, "approve_a", { answers: verification });
    if (end === "code_b") {
      const comments = (i.comments ?? []).map(({ comment, reference }) => ({ comment, reference }));
      await this.act(mohammed, id, "approve_b", { answers: { ...verification, remarks: "Approved with comments: see the Comments.", items_to_create: comments } });
    }
    if (end === "code_c") await this.act(mohammed, id, "revise_c", { answers: { ...verification, remarks: "Correct the failed Checklist items and ask for a re-inspection. / صحّح البنود المخالفة واطلب إعادة الفحص." } });
    if (end === "code_d") await this.act(mohammed, id, "reject_d", { answers: { ...verification, remarks: "Rejected: redo the work. / مرفوض: أعد تنفيذ العمل." } });
  }

  /** From the Consultant Engineer's Step on: the reply, the Code, a Code B's Comments and a Code C's Revision. */
  private async reviewed(id: string, item: SampleSubmittal, side: Side) {
    const { mohammed } = this.as;
    const raiser = this.as[SIDES[side].raiser];
    const pm = this.as[SIDES[side].pm];
    const engineer = item.consultantEngineer ? this.as[item.consultantEngineer] : undefined;
    if (item.end === "with_consultant_engineer") {
      if (engineer) await this.pickUp(engineer, id);
      return;
    }
    const code = item.recommendedCode!;
    const matches = code === "A" || code === "B";
    const why = "The finish does not match the specification. / التشطيب لا يطابق المواصفات.";
    await this.act(engineer!, id, "send_to_manager", {
      answers: verified(matches, why),
      recommendedCode: code,
      internalNote: matches ? "Checked against the specification." : "Recommend resubmission: see the verification.",
    });
    if (item.end === "with_consultant_manager") {
      // Mohammed, the only Consultant Manager, holds some and leaves the rest waiting.
      if (item.title.length % 2 === 0) await this.pickUp(mohammed, id);
      return;
    }
    const answers = verified(matches, why);
    if (item.end === "code_a") await this.act(mohammed, id, "approve_a", { answers });
    if (item.end === "code_b") {
      const comments = item.comments ?? [];
      await this.act(mohammed, id, "approve_b", { answers: { ...answers, remarks: "Approved as noted: see the Comments.", items_to_create: comments.map(({ comment, reference }) => ({ comment, reference })) } });
      // Each Comment is Open with the raiser's Company; its raiser resolves some, and Mohammed, who raised them, closes some.
      for (const c of comments.filter((c) => c.end !== "open")) {
        const [comment] = await this.titled(c.comment);
        if (!comment) throw new Error("Sample project: a Code B raised no Comment");
        await this.act(raiser, comment, "resolve", { answers: resolution("Done: see the revised shop drawing. / تم: انظر المخطط التنفيذي المعدل.") });
        if (c.end === "closed") await this.act(mohammed, comment, "close");
      }
    }
    if (item.end === "code_c") await this.act(mohammed, id, "revise_c", { answers: { ...answers, remarks: "Revise and resubmit with the specified finish. / أعد التقديم بالتشطيب المحدد." } });
    if (item.end === "code_d") await this.act(mohammed, id, "reject_d", { answers: { ...answers, remarks: "Rejected: the product is not to the specification. / مرفوض: المنتج غير مطابق للمواصفات." } });
    if (item.revision) {
      // Rev 1: the raiser creates it from the closed item, with its answers and Datasheet copied, and sends it.
      const { id: rev1 } = await raiser<{ id: string }>("POST", `/v1/work-items/${id}/revisions`, { idempotencyKey: randomUUID() });
      const { answers: copied } = await raiser<{ answers: Record<string, unknown> }>("GET", `/v1/work-items/${rev1}`);
      await raiser("PUT", `/v1/work-items/${rev1}/answers`, { answers: { ...copied, description: `${item.product.description} Revised to the specified finish.` } });
      await this.act(raiser, rev1, "send_for_review");
      if (item.revision === "returned") await this.act(pm, rev1, "return", { answers: { reason: "Attach the finish sample photo too. / أرفق صورة عينة التشطيب أيضاً." } });
    }
  }

  async snag(item: SampleSnag) {
    const { hafiz } = this.as;
    const raiser = this.as[item.raisedBy];
    const where = { trade: this.ids.trade[item.trade], location: this.ids.location[item.location] };
    const { id } = await raiser<{ id: string }>("POST", `/v1/projects/${this.projectId}/work-items`, { type: item.type, title: item.title, answers: { description: item.description, ...where } });
    for (let i = 0; i < (item.photos ?? 0); i++) await this.upload(raiser, id, "photos", `photo-${i + 1}.jpg`, "image/jpeg", this.photo(i + item.title.length));
    if (item.end === "draft") return;
    await this.act(raiser, id, "raise");
    if (item.end === "open") return;
    if (item.end === "in_progress") return this.act(hafiz, id, "start_work");
    if (item.end === "on_hold") return this.act(hafiz, id, "put_on_hold");
    await this.act(hafiz, id, "resolve", { answers: resolution("Done and checked on site. / تم التنفيذ والتحقق في الموقع.") });
    if (item.end === "closed") await this.act(raiser, id, "close");
  }
}
