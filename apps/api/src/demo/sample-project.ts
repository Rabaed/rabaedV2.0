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
  SAMPLE_SCOPES,
  SAMPLE_SUPPLIERS,
  SAMPLE_TRADES,
  SAMPLE_CHECKLISTS,
  sampleInspections,
  samplePackages,
  sampleSnags,
  sampleSubmittals,
  type SampleDar,
  type SampleDraft,
  type SampleInspection,
  type SamplePackage,
  type SampleScope,
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
  // On the UAT Projects only (RP-1250): the sample Project leaves him off, as before.
  omar: ["omar.alharbi", "tmc"],
  // Gulf Review Consultants' Authorized Person, on UAT 03 only (RP-1264): signed in only for a Project it joins.
  tariq: ["tariq.alshehri", "gulfreview"],
} as const;
/** A demo person the sample Project's runs sign in as. */
export type SampleWho = keyof typeof PEOPLE;
type Who = SampleWho;

/**
 * A Company on the Project, named by its Authorized Person: TMC's Saeed, Beta Build's Nasser, Design Consultants' Layla,
 * Al Waha's Hind; and Gulf Review Consultants' Tariq, only on a Project whose people join it (RP-1264).
 */
export type SampleCompany = "saeed" | "nasser" | "layla" | "hind" | "tariq";

/** Trades and Locations by their codes; all of the Project's where one is left out. */
export interface SampleGrant {
  trades?: TradeCode[];
  /** Location codes; a Zone's covers what is under it. */
  locations?: string[];
}

/**
 * Where a Project's people differ from the sample's (RP-1250): Members added or left off, a Member's or a Participant's
 * Visibility narrowed. The sample Project, Al Nakheel, takes none; the UAT Projects add Omar, and UAT 06 narrows
 * Design Consultants for Layla's cases.
 */
export interface SamplePeople {
  add?: { who: Who; company: SampleCompany; positions: string[]; grant?: SampleGrant }[];
  leaveOff?: Who[];
  grants?: Partial<Record<Who, SampleGrant>>;
  participants?: Partial<Record<SampleCompany, SampleGrant>>;
  /** Companies on this Project only, beside the four on every one (RP-1264): UAT 03's Gulf Review Consultants. */
  join?: SampleCompany[];
}

// eslint-disable-next-line rabaed/no-avoid-terms -- the Project Manager Position's key, as GLOSSARY.md's Position entry names it.
const PM = "project_manager";

/**
 * Each Company on the Project: its Authorized Person, CR number (seed.ts's made-up ones), Role and Members with their
 * Positions. One that `joins` is on a Project only when its people name it (SamplePeople.join).
 */
type Company = { ap: SampleCompany; name: string; crNumber: string; role: BaseRole; members: [Who, string[]][]; joins?: true };
const COMPANIES: Company[] = [
  { ap: "saeed", name: "TMC Constructions", crNumber: "9999000001", role: "contractor", members: [["hafiz", ["engineer"]], ["ali", [PM]]] },
  // Yousef is Beta Build's only Member here, so he also Submits its Packages (RP-1220): Project Manager beside Engineer.
  { ap: "nasser", name: "Beta Build", crNumber: "9999000002", role: "contractor", members: [["yousef", ["engineer", PM]]] },
  { ap: "layla", name: "Design Consultants LLC", crNumber: "9999000003", role: "consultant", members: [["ahmed", ["engineer"]], ["sara", ["engineer"]], ["mohammed", ["manager"]]] },
  { ap: "hind", name: "Al Waha PMC", crNumber: "9999000004", role: "owner_representative", members: [["faisal", ["engineer"]], ["noura", [PM]]] },
  // A second Consultant for PAR-17 (RP-1264): its Authorized Person is its one Member, its Consultant Engineer.
  { ap: "tariq", name: "Gulf Review Consultants", crNumber: "9999000006", role: "consultant", members: [["tariq", ["engineer"]]], joins: true },
];

/** The Company's people: its Authorized Person and its Members. */
const peopleOf = (c: Company): Who[] => [c.ap, ...c.members.map(([who]) => who)];

/** Whether the Company is on a Project of `people`: every Company is, but one that joins only where `people` names it. */
const isOn = (c: Company, people: SamplePeople = {}) => !c.joins || (people.join?.includes(c.ap) ?? false);

/**
 * The Company whose Consultant Engineer holds an item, by name, which its Submit picks where two Consultants cover it:
 * Design Consultants when the plan names no Engineer.
 */
const consultantOf = (engineer: SampleSubmittal["consultantEngineer"] = "ahmed") =>
  COMPANIES.find((c) => c.role === "consultant" && c.members.some(([who]) => who === engineer))!.name;

/** The people of the Companies that join only some Projects: signed in only when a Project being built has them. */
const JOINING = new Set<Who>(COMPANIES.filter((c) => c.joins).flatMap(peopleOf));

/** The demo people a Project of `people` needs signed in beside everyone else: those of the Companies it joins. */
export const joiningPeople = (people: SamplePeople = {}): Who[] => COMPANIES.filter((c) => c.joins && isOn(c, people)).flatMap(peopleOf);

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
  /** Its DARs at the Owner's review (RP-1250, a UAT Project's); none on the sample Project. */
  dars?: SampleDar[];
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
  /** Its people where they differ from the sample's (RP-1250); none when left out. */
  people?: SamplePeople;
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
  options: SampleProjectOptions = {},
): Promise<SampleProjectResult> {
  return withSampleLock(migrator, async (connection) => buildSampleProject(await signInAll(app, password, joiningPeople(options.people)), connection, options));
}

/**
 * Runs `fn` holding the lock that serialises sample Project runs, on one migrator connection, which `fn`
 * reads with. The UAT Projects (RP-1254) build several Projects at once under one lock and one connection.
 */
export async function withSampleLock<T>(migrator: Db, fn: (connection: Db) => Promise<T>): Promise<T> {
  return migrator.connection().execute(async (connection) => {
    await sql`select pg_advisory_lock(${LOCK_KEY})`.execute(connection);
    try {
      return await fn(connection);
    } finally {
      await sql`select pg_advisory_unlock(${LOCK_KEY})`.execute(connection);
    }
  });
}

/** Builds one Project of the sample's make, as people already signed in (signInAll), the lock held (withSampleLock). */
export async function buildSampleProject(
  as: SignedIn,
  connection: Db,
  { log = () => {}, concurrency = 4, records = sampleRecords(), project: which = SAMPLE_PROJECT, people = {} }: SampleProjectOptions = {},
): Promise<SampleProjectResult> {
  const projectId = await sampleProjectId(as, connection, which);
  const ids = await setUp(as, projectId, which, people);
  const titled = async (title: string) =>
    (await sql<{ id: string }>`select id from work_item where project_id = ${projectId}::uuid and title = ${title}`.execute(connection)).rows.map((r) => r.id);
  const { rows } = await sql<{ title: string }>`select distinct title from work_item where project_id = ${projectId}::uuid`.execute(connection);
  const existing = new Set(rows.map((r) => r.title));
  const run = new Runner(as, projectId, ids, titled);
  const planned = [
    ...records.submittals.map((item) => ({ title: item.title, move: () => run.submittal(item) })),
    ...records.snags.map((item) => ({ title: item.title, move: () => run.snag(item) })),
    ...records.inspections.map((item) => ({ title: item.title, move: () => run.inspection(item) })),
    ...(records.dars ?? []).map((item) => ({ title: item.title, move: () => run.dar(item) })),
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
}

/** How far the sample Project is on this database, read as the migrator and changing nothing: a dry run's answer. */
export async function sampleProjectStatus(
  migrator: Db,
  { records = sampleRecords(), project: which = SAMPLE_PROJECT }: Pick<SampleProjectOptions, "records" | "project"> = {},
): Promise<{ project: boolean; present: number; planned: number; packages: { present: number; planned: number } }> {
  // Every item it raises by Subject: a Package's own too, so a missing one shows before its Package.
  const titles = [...records.submittals, ...records.snags, ...records.inspections, ...(records.dars ?? []), ...records.packages.flatMap((p) => [...p.submitted, ...p.drafts])].map((p) => p.title);
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
export async function inParallel(moves: (() => Promise<void>)[], n: number): Promise<void> {
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

/**
 * The demo people, each signed in as one browser (signInAll); several Projects built at once share them (RP-1254).
 * A joining Company's people are there only when signInAll was asked for them.
 */
export type SignedIn = Record<Who, Call>;

/**
 * Everyone signs in first, so a password that no longer works stops the run before it writes anything. The people of a
 * Company that joins only some Projects sign in only when `joining` names them (joiningPeople): a database seeded before
 * that Company was added has no such person, and the sample Project never needs one.
 */
export async function signInAll(app: FastifyInstance, password: string, joining: Who[] = []): Promise<SignedIn> {
  const people = {} as SignedIn;
  for (const [who, [local, domain]] of Object.entries(PEOPLE) as [Who, readonly [string, string]][]) {
    if (JOINING.has(who) && !joining.includes(who)) continue;
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

/**
 * The Project, created by TMC's Authorized Person (its Project Admin) unless it is there. Found as the migrator
 * reads which items exist: Saeed's own list of Projects costs over a hundred queries once the UAT Projects are on it (RP-1254).
 */
export async function sampleProjectId({ saeed }: SignedIn, connection: Db, which: SampleProjectName): Promise<string> {
  // By its code and English name, as sampleProjectStatus finds it.
  const { rows: [found] } = await sql<{ id: string }>`
    select id from project where code = ${which.code} and name ->> 'en' = ${which.name.en} order by created_at, id limit 1
  `.execute(connection);
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

/** Trades, Locations, Scopes, suppliers, Participants and Members: each added only where it is missing, `people`'s changes with them. */
async function setUp(as: SignedIn, projectId: string, which: SampleProjectName, people: SamplePeople): Promise<Ids> {
  const admin = as.saeed;
  const dimensions = () => admin<DimensionValues>("GET", `/v1/projects/${projectId}/dimensions`);
  let have = await dimensions();
  for (const t of SAMPLE_TRADES) {
    if (!have.trade.some((v) => v.code === t.code)) await admin("POST", `/v1/projects/${projectId}/trades`, { code: t.code, name: t.name });
  }
  // Each Location's id by its code as it is added, so a child finds its parent without reading them all again (RP-1254).
  const locationIds = new Map(have.location.map((v) => [v.code, v.id]));
  for (const l of SAMPLE_LOCATIONS) {
    if (locationIds.has(l.code)) continue;
    const parentId = l.parent ? locationIds.get(l.parent)! : null;
    const { id } = await admin<{ id: string }>("POST", `/v1/projects/${projectId}/locations`, { code: l.code, name: l.name, parentId });
    locationIds.set(l.code, id);
  }
  have = await dimensions();
  const byCode = (values: DimensionValues["trade"]) => Object.fromEntries(values.map((v) => [v.code, v.id]));
  const trade = byCode(have.trade) as Ids["trade"];
  const location = byCode(have.location);

  // Each Trade's Scopes and Sub-scopes (RP-1305), the General Trade's too: each added only where its English name is missing.
  const scopesUrl = `/v1/projects/${projectId}/scopes`;
  const { scopes: haveScopes } = await admin<{ scopes: { id: string; tradeId: string; parentId: string | null; name: BilingualText }[] }>("GET", scopesUrl);
  const scopeOf = async (tradeId: string, parentId: string | null, name: BilingualText) =>
    haveScopes.find((s) => s.tradeId === tradeId && s.parentId === parentId && s.name.en === name.en)?.id ??
    (await admin<{ id: string }>("POST", scopesUrl, { tradeId, parentId, name })).id;
  for (const [code, scopes] of Object.entries(SAMPLE_SCOPES) as [keyof typeof SAMPLE_SCOPES, SampleScope[]][]) {
    for (const s of scopes) {
      const parentId = await scopeOf(trade[code], null, s.name);
      for (const sub of s.subScopes ?? []) await scopeOf(trade[code], parentId, sub);
    }
  }

  const supplier = {} as Record<TradeCode, string>;
  for (const t of SAMPLE_TRADES) {
    const url = `/v1/projects/${projectId}/approved-suppliers`;
    const { suppliers } = await admin<{ suppliers: { id: string; name: BilingualText }[] }>("GET", `${url}?tradeId=${trade[t.code]}`);
    supplier[t.code] =
      suppliers.find((s) => s.name.en === SAMPLE_SUPPLIERS[t.code].en)?.id ??
      (await admin<{ id: string }>("POST", url, { tradeId: trade[t.code], scopeId: null, name: SAMPLE_SUPPLIERS[t.code] })).id;
  }

  /** A grant of `people`'s by codes, as the Project's value ids: every value where it names none. */
  const grantOf = (g: SampleGrant = {}): Visibility => ({
    trade: g.trades ? { isAll: false, valueIds: g.trades.map((c) => trade[c]) } : all,
    location: g.locations ? { isAll: false, valueIds: g.locations.map((c) => location[c]!) } : all,
  });
  for (const company of COMPANIES.filter((c) => isOn(c, people))) {
    const ap = as[company.ap];
    const participantId = await participantOf(as, ap, projectId, which, company.crNumber, company.role);
    const own = grantOf(people.participants?.[company.ap]);
    const visibility = await admin<{ visibility: Visibility }>("GET", `/v1/participants/${participantId}/visibility`);
    if (!sameVisibility(visibility.visibility, own)) await admin("PUT", `/v1/participants/${participantId}/visibility`, own);
    const { members: colleagues } = await ap<{ members: { id: string; email: string }[] }>("GET", "/v1/members");
    /** A Member on this Project: who, their Positions, and their own grant when narrower than their Participant's. */
    type OnProject = [Who, string[], SampleGrant | undefined];
    const members: OnProject[] = [
      ...company.members.filter(([who]) => !people.leaveOff?.includes(who)).map(([who, positions]): OnProject => [who, positions, people.grants?.[who]]),
      ...(people.add ?? []).filter((a) => a.company === company.ap).map((a): OnProject => [a.who, a.positions, a.grant]),
    ];
    // Read once: adding one Member changes no other's entry (RP-1254).
    const onProject = await ap<ParticipantMembers>("GET", `/v1/participants/${participantId}/members`);
    for (const [who, positions, grant] of members) {
      const email = demoEmail(PEOPLE[who][0], PEOPLE[who][1]);
      const memberId = colleagues.find((m) => m.email === email)?.id;
      if (!memberId) throw new Error(`Sample project: the demo person "${who}" is not a Member of their Company`);
      const member = onProject.members.find((m) => m.id === memberId);
      if (!member) await ap("POST", `/v1/participants/${participantId}/members`, { memberId });
      // Sara works Mechanical only, as on Riyadh Gate Tower (RP-1207); everyone else all of their Participant's, unless `people` narrows them.
      const wanted: Visibility = grant ? grantOf(grant) : who === "sara" ? { trade: { isAll: false, valueIds: [trade.ME] }, location: all } : own;
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
async function participantOf(as: SignedIn, ap: Call, projectId: string, which: SampleProjectName, crNumber: string, role: BaseRole): Promise<string> {
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
    private readonly as: SignedIn,
    private readonly projectId: string,
    private readonly ids: Ids,
    /** The ids of the Project's items with this Subject, read as the migrator (a Code B's Comments, by the row's comment). */
    private readonly titled: (title: string) => Promise<string[]>,
  ) {}

  /**
   * `by` takes `transition`, picking the Step up first when it sits in their Step Pool, and naming `pick` (TMC by
   * default) where the next Step could go to more than one Participant: a Snag's Contractor, or UAT 03's two
   * Consultants (RP-1264).
   */
  private async act(by: Call, id: string, transition: string, body: Record<string, unknown> = {}, pick: string = SIDES.tmc.company) {
    // Taken straight away when `by` already holds the Step and no Participant is to be picked: the item's page costs
    // some 28 queries, a third of the seed's (RP-1254). Anything else is refused before it writes anything (not_holder,
    // participant_not_picked, …), and then it goes as it always did: read, pick up, read, take.
    try {
      await by("POST", `/v1/work-items/${id}/transitions`, { transition, confirmed: true, idempotencyKey: randomUUID(), ...body });
      return;
    } catch (error) {
      if (!/ answered 4\d\d /.test(String(error))) throw error;
    }
    let detail = await by<WorkItemDetail>("GET", `/v1/work-items/${id}`);
    if (detail.actions.pickUp) {
      await by("POST", `/v1/work-items/${id}/pick-up`);
      detail = await by<WorkItemDetail>("GET", `/v1/work-items/${id}`);
    }
    const offered = detail.actions.transitions.find((t) => t.key === transition);
    if (!offered) throw new Error(`Sample project: ${transition} is not offered on ${detail.documentNumber ?? "a Draft"} (offered: ${detail.actions.transitions.map((t) => t.key).join(", ") || "none"})`);
    const participant = offered.participants?.find((p) => p.companyName.en === pick)?.participantId;
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

  /**
   * `side`'s raiser creates the item as a Draft with its Datasheet (or company profile) and any Sample photo; a `bare`
   * one with its Manufacturer, supplier, Trade and Location only. Its `links` go under Related submittals and as free Links.
   */
  private async draft(item: SampleSubmittal | SampleDraft, side: Side): Promise<string> {
    const raiser = this.as[SIDES[side].raiser];
    const type = "type" in item ? item.type : "MAR";
    const bare = "bare" in item && item.bare;
    const links: string[] = [];
    for (const title of ("links" in item && item.links) || []) {
      const [target] = await this.titled(title);
      if (!target) throw new Error("Sample project: a linked submittal is not on the Project");
      links.push(target);
    }
    const full = this.answers(item);
    const answers = bare
      ? { manufacturer: full.manufacturer, supplier: full.supplier, trade: full.trade, location: full.location }
      : { ...full, ...(links.length ? { related_submittals: links } : {}) };
    const { id } = await raiser<{ id: string }>("POST", `/v1/projects/${this.projectId}/work-items`, { type, title: item.title, answers });
    for (const target of links) await raiser("POST", `/v1/work-items/${id}/links`, { workItemId: target });
    if (bare) return id;
    const lines = [item.title, item.product.description, "Demo document: made up for the Rabaed demo."];
    if (type === "SAR") await this.upload(raiser, id, "company_profile", "company-profile.pdf", "application/pdf", demoPdf(lines));
    else await this.upload(raiser, id, "datasheet", `${item.product.model.replaceAll(/[^A-Za-z0-9]+/g, "-")}-datasheet.pdf`, "application/pdf", demoPdf(lines));
    if ("samplePhoto" in item && item.samplePhoto) await this.upload(raiser, id, "sample_photo", "sample.jpg", "image/jpeg", this.photo(item.title.length));
    return id;
  }

  async submittal(item: SampleSubmittal) {
    const side = item.owner ?? "tmc";
    const raiser = this.as[SIDES[side].raiser];
    const pm = this.as[SIDES[side].pm];
    const id = await this.draft(item, side);
    if (item.end === "draft") return;
    await this.act(raiser, id, "send_for_review");
    if (item.end === "with_pm") return;
    // The PM's Internal Review Step names its Cancel cancel_review (the Contractor Engineer's is cancel).
    if (item.end === "cancelled") return this.act(pm, id, "cancel_review");
    if (item.end === "returned") {
      return this.act(pm, id, "return", { answers: { reason: "Add the model's test certificate and resend. / أضف شهادة اختبار الطراز وأعد الإرسال." } });
    }
    await this.act(pm, id, "submit", { answers: { cover_note: `${item.product.name} for ${item.location}, as specified in ${item.product.specificationSection}.` } }, consultantOf(item.consultantEngineer));
    await this.reviewed(id, item, side);
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

  /**
   * A DAR (RP-1250) on the 1→1 Workflow with the Owner's review: Hafiz raises it with its document and sends it, Ali
   * Submits it, Mohammed recommends its Code to the Owner (a B with its Comments), and it waits at the Owner's review.
   */
  async dar(d: SampleDar) {
    const { hafiz, ali, mohammed } = this.as;
    const answers = {
      document_type: d.documentType,
      document_title: d.title,
      document_revision: "R0",
      specification_section: "26 05 19",
      trade: this.ids.trade[d.trade],
      location: this.ids.location[d.location],
    };
    const { id } = await hafiz<{ id: string }>("POST", `/v1/projects/${this.projectId}/work-items`, { type: "DAR", title: d.title, answers });
    await this.upload(hafiz, id, "document", "document.pdf", "application/pdf", demoPdf([d.title, "Demo document: made up for the Rabaed demo."]));
    await this.act(hafiz, id, "send_for_review");
    await this.act(ali, id, "submit", { answers: { cover_note: `${d.title}, for the Owner's review.` } });
    const matches = d.recommendedCode === "A" || d.recommendedCode === "B";
    const remarks = matches ? "Recommended for approval. / موصى باعتماده." : "Recommended for resubmission. / موصى بإعادة تقديمه.";
    await this.act(mohammed, id, `recommend_${d.recommendedCode.toLowerCase()}`, {
      answers: {
        ...verified(matches, "The document does not meet the specification. / المستند لا يطابق المواصفات."),
        remarks,
        ...(d.recommendedCode === "B" ? { items_to_create: (d.comments ?? []).map(({ comment, reference }) => ({ comment, reference })) } : {}),
      },
    });
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
    if (item.end === "returned_to_open") await this.act(raiser, id, "return_to_open", { answers: { reason: "Two breakers are still unlabelled. / قاطعان ما زالا بلا ملصقات." } });
  }
}
