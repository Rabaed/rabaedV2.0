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
  sampleSnags,
  sampleSubmittals,
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

const TMC = "TMC Constructions";

// eslint-disable-next-line rabaed/no-avoid-terms -- the Project Manager Position's key, as GLOSSARY.md's Position entry names it.
const PM = "project_manager";

/** Each Company on the Project: its Authorized Person, CR number (seed.ts's made-up ones), Role and Members with their Positions. */
const COMPANIES: { ap: Who; crNumber: string; role: BaseRole; members: [Who, string[]][] }[] = [
  { ap: "saeed", crNumber: "9999000001", role: "contractor", members: [["hafiz", ["engineer"]], ["ali", [PM]]] },
  { ap: "nasser", crNumber: "9999000002", role: "contractor", members: [["yousef", ["engineer"]]] },
  { ap: "layla", crNumber: "9999000003", role: "consultant", members: [["ahmed", ["engineer"]], ["sara", ["engineer"]], ["mohammed", ["manager"]]] },
  { ap: "hind", crNumber: "9999000004", role: "owner_representative", members: [["faisal", ["engineer"]], ["noura", [PM]]] },
];

const all: VisibilityGrant = { isAll: true, valueIds: [] };

export interface SampleProjectResult {
  projectId: string;
  /** Items this run raised (Code B's Comments and Revisions not counted). */
  added: number;
  /** Planned items already on the Project, left as they were. */
  present: number;
}

/** What the run prints: counts only, never a Subject or an email (the UAT job's log is public). */
export type SampleLog = (line: string) => void;

export interface SampleProjectOptions {
  log?: SampleLog;
  /** How many items move at once; each needs its own api connection at times. */
  concurrency?: number;
}

/**
 * Adds the sample Project through `app` (the customer api, with a file store), signing in as the
 * demo's people with `password`. `migrator` reads which items exist and serialises two runs.
 */
export async function addSampleProject(app: FastifyInstance, migrator: Db, password: string, { log = () => {}, concurrency = 4 }: SampleProjectOptions = {}): Promise<SampleProjectResult> {
  return migrator.connection().execute(async (connection) => {
    await sql`select pg_advisory_lock(${LOCK_KEY})`.execute(connection);
    try {
      const as = await signInAll(app, password);
      const projectId = await project(as.saeed);
      const ids = await setUp(as, projectId);
      const titled = async (title: string) =>
        (await sql<{ id: string }>`select id from work_item where project_id = ${projectId}::uuid and title = ${title}`.execute(connection)).rows.map((r) => r.id);
      const { rows } = await sql<{ title: string }>`select distinct title from work_item where project_id = ${projectId}::uuid`.execute(connection);
      const existing = new Set(rows.map((r) => r.title));
      const run = new Runner(as, projectId, ids, titled);
      const planned = [
        ...sampleSubmittals().map((item) => ({ title: item.title, move: () => run.submittal(item) })),
        ...sampleSnags().map((item) => ({ title: item.title, move: () => run.snag(item) })),
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
      return { projectId, added, present: planned.length - todo.length };
    } finally {
      await sql`select pg_advisory_unlock(${LOCK_KEY})`.execute(connection);
    }
  });
}

/** How far the sample Project is on this database, read as the migrator and changing nothing: a dry run's answer. */
export async function sampleProjectStatus(migrator: Db): Promise<{ project: boolean; present: number; planned: number }> {
  const titles = [...sampleSubmittals(), ...sampleSnags()].map((p) => p.title);
  const { rows } = await sql<{ title: string }>`
    select distinct w.title from work_item w join project p on p.id = w.project_id
    where p.code = ${SAMPLE_PROJECT.code} and p.name ->> 'en' = ${SAMPLE_PROJECT.name.en} and w.title = any(${titles}::text[])
  `.execute(migrator);
  const { rows: projects } = await sql<{ n: number }>`
    select count(*)::int as n from project where code = ${SAMPLE_PROJECT.code} and name ->> 'en' = ${SAMPLE_PROJECT.name.en}
  `.execute(migrator);
  return { project: projects[0]!.n > 0, present: rows.length, planned: titles.length };
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
async function project(saeed: Call): Promise<string> {
  const { projects } = await saeed<{ projects: { id: string; code: string }[] }>("GET", "/v1/projects");
  const found = projects.find((p) => p.code === SAMPLE_PROJECT.code);
  if (found) return found.id;
  const { projectId } = await saeed<{ projectId: string }>("POST", "/v1/projects", { name: SAMPLE_PROJECT.name, code: SAMPLE_PROJECT.code, role: "contractor" });
  return projectId;
}

interface Ids {
  trade: Record<TradeCode | "GEN", string>;
  location: Record<string, string>;
  supplier: Record<TradeCode, string>;
}

const sameGrant = (a: VisibilityGrant, b: VisibilityGrant) => a.isAll === b.isAll && [...a.valueIds].sort().join() === [...b.valueIds].sort().join();
const sameVisibility = (a: Visibility, b: Visibility) => sameGrant(a.trade, b.trade) && sameGrant(a.location, b.location);

/** Trades, Locations, suppliers, Participants and Members: each added only where it is missing. */
async function setUp(as: People, projectId: string): Promise<Ids> {
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
    const participantId = await participantOf(as, ap, projectId, company.crNumber, company.role);
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
  return { trade, location, supplier };
}

/** The Company's Participant on the Project: the Project Admin's own, or invited by CR number and accepted by its Authorized Person. */
async function participantOf(as: People, ap: Call, projectId: string, crNumber: string, role: BaseRole): Promise<string> {
  const mine = async () => (await ap<{ participants: { id: string; project: { id: string } }[] }>("GET", "/v1/participants")).participants.find((p) => p.project.id === projectId)?.id;
  const found = await mine();
  if (found) return found;
  const pending = async () =>
    (await ap<{ invitations: { id: string; project: { name: BilingualText } }[] }>("GET", "/v1/participant-invitations")).invitations.find((i) => i.project.name.en === SAMPLE_PROJECT.name.en);
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
    const participant = offered.participants?.find((p) => p.companyName.en === TMC)?.participantId;
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

  private answers(item: SampleSubmittal): Record<string, unknown> {
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

  async submittal(item: SampleSubmittal) {
    const { hafiz, ali, mohammed } = this.as;
    const { id } = await hafiz<{ id: string }>("POST", `/v1/projects/${this.projectId}/work-items`, { type: item.type, title: item.title, answers: this.answers(item) });
    const lines = [item.title, item.product.description, "Demo document: made up for the Rabaed demo."];
    if (item.type === "SAR") await this.upload(hafiz, id, "company_profile", "company-profile.pdf", "application/pdf", demoPdf(lines));
    else await this.upload(hafiz, id, "datasheet", `${item.product.model.replaceAll(/[^A-Za-z0-9]+/g, "-")}-datasheet.pdf`, "application/pdf", demoPdf(lines));
    if (item.samplePhoto) await this.upload(hafiz, id, "sample_photo", "sample.jpg", "image/jpeg", this.photo(item.title.length));
    await this.act(hafiz, id, "send_for_review");
    if (item.end === "with_pm") return;
    if (item.end === "returned") {
      return this.act(ali, id, "return", { answers: { reason: "Add the model's test certificate and resend. / أضف شهادة اختبار الطراز وأعد الإرسال." } });
    }
    await this.act(ali, id, "submit", { answers: { cover_note: `${item.product.name} for ${item.location}, as specified in ${item.product.specificationSection}.` } });
    const engineer = item.consultantEngineer ? this.as[item.consultantEngineer] : undefined;
    if (item.end === "with_consultant_engineer") {
      if (engineer) await this.pickUp(engineer, id);
      return;
    }
    const code = { with_consultant_manager: "A", code_a: "A", code_b: "B", code_c: "C", code_d: "D" }[item.end];
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
      // Each Comment is Open with Hafiz (the raiser's Company); he resolves some, and Mohammed, who raised them, closes some.
      for (const c of comments.filter((c) => c.end !== "open")) {
        const [comment] = await this.titled(c.comment);
        if (!comment) throw new Error("Sample project: a Code B raised no Comment");
        await this.act(hafiz, comment, "resolve", { answers: resolution("Done: see the revised shop drawing. / تم: انظر المخطط التنفيذي المعدل.") });
        if (c.end === "closed") await this.act(mohammed, comment, "close");
      }
    }
    if (item.end === "code_c") await this.act(mohammed, id, "revise_c", { answers: { ...answers, remarks: "Revise and resubmit with the specified finish. / أعد التقديم بالتشطيب المحدد." } });
    if (item.end === "code_d") await this.act(mohammed, id, "reject_d", { answers: { ...answers, remarks: "Rejected: the product is not to the specification. / مرفوض: المنتج غير مطابق للمواصفات." } });
    if (item.revision) {
      // Rev 1: Hafiz raises it from the closed item, with its answers and Datasheet copied, and sends it.
      const { id: rev1 } = await hafiz<{ id: string }>("POST", `/v1/work-items/${id}/revisions`, { idempotencyKey: randomUUID() });
      const { answers: copied } = await hafiz<{ answers: Record<string, unknown> }>("GET", `/v1/work-items/${rev1}`);
      await hafiz("PUT", `/v1/work-items/${rev1}/answers`, { answers: { ...copied, description: `${item.product.description} Revised to the specified finish.` } });
      await this.act(hafiz, rev1, "send_for_review");
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
