// The Tower of the seam 2 suites (RP-980): the setup the visibility suites of packages/db/test copy by
// hand, built once. Seam 1's counterpart is buildTower (apps/api/test/support/tower.ts).
//
//   C1  Contractor, the Project's creator and Admin: an Engineer and a Project Manager.
//   K1  Consultant: an Engineer, and a Manager with the option `k1Manager`.
//   OW  Owner: a Representative; sees everything unless `ownerOversight` is false (V2).
//   C2  Another Contractor of the same Trade: an Engineer; covers Building B only unless
//       `c2OtherLocation` is false (V3).
//   OT  (option `otherProject`) the Authorized Person of a Company on another Project (layer 1).
// Every Company has an Authorized Person (`ap`), who is its Admin; every Member is on the Project with
// Trade and Location Visibility of all and their Position. Companies, Members and codes are new on every
// call, so one test database serves any number of Towers.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import type pg from "pg";
import { withMember, type Db } from "../src/client.ts";
import { joinProject } from "./join-project.ts";

/** `n` random digits, for a code that is new on every call. */
export const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
/** A name with the same text in both languages. */
export const bilingual = (en: string) => ({ en, ar: en });

/** The Tower's Checklist Template: two check items. */
const CHECKLIST_ITEMS = [
  { key: "formwork", text: bilingual("Formwork tight"), answers: "pass_fail_na", comment: "required_on_negative", photo: "required_on_negative", on_negative: "create_snag" },
  { key: "cover", text: bilingual("Rebar cover"), answers: "pass_fail_na", comment: "optional", photo: "optional", on_negative: "none" },
];

/** A Company of the Tower: its Authorized Person, its Participant on the Project and its Members by Position. */
export type SeamTwoCompany<Position extends string = string> = {
  id: string;
  cr: string;
  /** The Authorized Person (a Member); the Company's Admin. */
  ap: string;
  /** The Company's Participant on the Tower's Project. */
  participantId: string;
  members: Record<Position, string>;
};

export type SeamTwoOptions = {
  /** The Project's code (three letters). Default "RST". */
  projectCode?: string;
  /** The Trade's code. Default "EL". */
  tradeCode?: string;
  /** C2 covers Building B only, not Building A, where the work is. Default true. */
  c2OtherLocation?: boolean;
  /** OW sees every Trade and Location (an Owner with oversight, V2). When false it sees none. Default true. */
  ownerOversight?: boolean;
  /** Adds `other`: the Authorized Person of a Company that has its own Project, which the Tower's Members are not on. Default false. */
  otherProject?: boolean;
  /** K1 has a Manager besides its Engineer, so its Steps wait to be picked up. Default false: the Engineer is K1's only Member and holds each Step as it arrives. */
  k1Manager?: boolean;
  /** `false`: the Project has no Checklist Template. Default: one ("Concrete pour") with two check items. */
  checklistTemplate?: false;
};

type Other = { id: string; cr: string; ap: string; projectId: string };

export type SeamTwoTower<O extends SeamTwoOptions = SeamTwoOptions> = {
  projectId: string;
  tradeId: string;
  /** Where the work is. */
  buildingA: string;
  buildingB: string;
  c1: SeamTwoCompany<"engineer" | "project_manager">;
  k1: SeamTwoCompany<O["k1Manager"] extends true ? "engineer" | "manager" : "engineer">;
  ow: SeamTwoCompany<"representative">;
  c2: SeamTwoCompany<"engineer">;
  /** Version 1 of the Project's Checklist Template; undefined when `checklistTemplate` is false. */
  checklistVersionId: string | undefined;
  /** Runs `query` in a transaction as Member `as`, the app role, and returns its rows. */
  call: <T extends object>(as: string, query: ReturnType<typeof sql<T>>) => Promise<T[]>;
  /** `call` for a query selecting one `outcome`. */
  outcome: (as: string, query: ReturnType<typeof sql<{ outcome: string }>>) => Promise<string>;
  /** `as` takes `transition` on item `id` (confirmed, with the item's own answers hash); returns the outcome. */
  take: (as: string, id: string, transition: string, answers?: object) => Promise<string>;
  /** `as` picks item `id` up at its Step; returns the outcome. */
  pickUp: (as: string, id: string) => Promise<string>;
} & (O["otherProject"] extends true ? { other: Other } : { other?: undefined });

/** Waits for `result` and throws, naming `what`, unless it is the `wanted` outcome. */
async function expectOutcome(what: string, result: Promise<string>, wanted = "set"): Promise<void> {
  const got = await result;
  if (got !== wanted) throw new Error(`${what}: ${got}`);
}

/** Builds a Tower with the `migrator` (a connected client of the test database) and the `app` role's `Db`. */
export async function buildSeamTwoTower<const O extends SeamTwoOptions = SeamTwoOptions>(app: Db, migrator: pg.Client, options?: O): Promise<SeamTwoTower<O>> {
  const { projectCode = "RST", tradeCode = "EL", c2OtherLocation = true, ownerOversight = true, otherProject = false, k1Manager = false, checklistTemplate } = options ?? {};
  const one = async (text: string, values: unknown[]): Promise<string> => (await migrator.query(text, values)).rows[0].id as string;
  const call: SeamTwoTower["call"] = (as, query) => withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));
  const outcome: SeamTwoTower["outcome"] = (as, query) => call(as, query).then((rows) => rows[0]!.outcome);

  const member = (companyId: string, who: string, creator = false) =>
    one("insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', $4) returning id", [
      companyId,
      email(who),
      JSON.stringify({ en: who, ar: who }),
      creator,
    ]);
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  async function company(name: string): Promise<{ id: string; cr: string; ap: string }> {
    const cr = digits(10);
    const id = await one("insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id", [
      JSON.stringify(bilingual(name)),
      cr,
      `3${digits(13)}3`,
      engineer,
    ]);
    const ap = await member(id, "ap", true);
    await migrator.query("update company set authorized_person_id = $1 where id = $2", [ap, id]);
    return { id, cr, ap };
  }
  const withMembers = async <P extends string>(name: string, positions: readonly P[]) => {
    const base = await company(name);
    const members = {} as Record<P, string>;
    for (const position of positions) members[position] = await member(base.id, position);
    return { ...base, members };
  };

  const c1 = await withMembers("C1", ["engineer", "project_manager"] as const);
  // A second K1 Member makes K1's Steps open to pick up (the lone Engineer holds them as they arrive).
  const k1 = await withMembers("K1", k1Manager ? (["engineer", "manager"] as const) : (["engineer"] as const));
  const ow = await withMembers("OW", ["representative"] as const);
  const c2 = await withMembers("C2", ["engineer"] as const);

  let other: Other | undefined;
  if (otherProject) {
    const base = await company("OT");
    const [created] = await call<{ project_id: string }>(
      base.ap,
      sql`select project_id from app.create_project('{"en": "Elsewhere", "ar": "مكان آخر"}'::jsonb, 'RCO', 'contractor')`,
    );
    other = { ...base, projectId: created!.project_id };
  }

  const [created] = await call<{ project_id: string }>(
    c1.ap,
    sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, ${projectCode}, 'contractor')`,
  );
  const projectId = created!.project_id;
  const participantId = {
    c1: (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string,
    k1: await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap),
    ow: await joinProject(app, projectId, { adminId: c1.ap, crNumber: ow.cr, role: "owner" }, ow.ap),
    c2: await joinProject(app, projectId, { adminId: c1.ap, crNumber: c2.cr, role: "contractor" }, c2.ap),
  };

  const value = async (kind: string, code: string): Promise<string> =>
    (
      await call<{ value_id: string }>(
        c1.ap,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, null, ${code}, ${JSON.stringify(bilingual(code))}::jsonb)`,
      )
    )[0]!.value_id;
  const tradeId = await value("trade", tradeCode);
  const buildingA = await value("location", "BA");
  const buildingB = await value("location", "BB");

  for (const [side, p] of Object.entries(participantId)) {
    for (const kind of ["trade", "location"]) {
      const onlyB = side === "c2" && kind === "location" && c2OtherLocation;
      const none = side === "ow" && !ownerOversight;
      await expectOutcome(
        `visibility of ${side}`,
        outcome(c1.ap, sql`select app.set_participant_visibility(${p}::uuid, ${kind}, ${!onlyB && !none}, ${onlyB ? [buildingB] : []}::uuid[], now()) as outcome`),
      );
    }
  }

  const people: [string, string, Record<string, string>][] = [
    [c1.ap, participantId.c1, c1.members],
    [k1.ap, participantId.k1, k1.members],
    [ow.ap, participantId.ow, ow.members],
    [c2.ap, participantId.c2, c2.members],
  ];
  for (const [admin, p, members] of people) {
    for (const [position, m] of Object.entries(members)) {
      await call(admin, sql<{ outcome: string }>`select app.add_project_member(${p}::uuid, ${m}::uuid, now())`);
      for (const kind of ["trade", "location"]) {
        await expectOutcome(`visibility of ${position}`, outcome(admin, sql`select app.set_member_visibility(${p}::uuid, ${m}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`));
      }
      await expectOutcome(`position ${position}`, outcome(admin, sql`select app.set_project_member_positions(${p}::uuid, ${m}::uuid, ${[position]}::text[]) as outcome`));
    }
  }

  let checklistVersionId: string | undefined;
  if (checklistTemplate !== false) {
    const [template] = await call<{ outcome: string; template_id: string }>(
      c1.ap,
      sql`select outcome, template_id from app.create_checklist_template(${projectId}::uuid, ${JSON.stringify(bilingual("Concrete pour"))}::jsonb, ${tradeId}::uuid, ${JSON.stringify(CHECKLIST_ITEMS)}::jsonb, now())`,
    );
    if (template!.outcome !== "created") throw new Error(`checklist template: ${template!.outcome}`);
    checklistVersionId = await one("select id from checklist_template_version where checklist_template_id = $1 and version_no = 1", [template!.template_id]);
  }

  const take: SeamTwoTower["take"] = (as, id, transition, answers = {}) =>
    outcome(
      as,
      sql`select app.take_transition(${id}::uuid, ${transition}, ${JSON.stringify(answers)}::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
    );
  const pickUp: SeamTwoTower["pickUp"] = (as, id) => outcome(as, sql`select app.pick_up_step(${id}::uuid, now()) as outcome`);

  const tower = {
    projectId,
    tradeId,
    buildingA,
    buildingB,
    c1: { ...c1, participantId: participantId.c1 },
    k1: { ...k1, participantId: participantId.k1 },
    ow: { ...ow, participantId: participantId.ow },
    c2: { ...c2, participantId: participantId.c2 },
    checklistVersionId,
    call,
    outcome,
    take,
    pickUp,
    ...(other ? { other } : {}),
  };
  return tower as unknown as SeamTwoTower<O>;
}

/** What `wirAtConsultant` takes. */
export type WirAtConsultantOptions = {
  /** The Work Item Type: its Form is the WIR Form document, with a `checklist_template` field. */
  type: string;
  title: string;
};

/**
 * C1's Engineer raises a WIR on `options.type` (the Tower's Trade and Building A) with the Tower's Checklist Template
 * picked and its checklist copied, Sends it for review; C1's Project Manager picks it up and Submits it. K1's Engineer
 * then holds it at the Consultant Step: with a K1 `manager` (option `k1Manager`) the Step waits and the Engineer
 * picks it up; as K1's only Member the Engineer holds it as it arrives, so there is nothing to pick up.
 * Returns the item's id.
 */
export async function wirAtConsultant(
  tower: Pick<SeamTwoTower, "projectId" | "tradeId" | "buildingA" | "checklistVersionId" | "c1" | "k1" | "call" | "outcome" | "take" | "pickUp">,
  options: WirAtConsultantOptions,
): Promise<string> {
  const { type, title } = options;
  const { c1, k1, call, outcome, take, pickUp, projectId, checklistVersionId } = tower;
  if (!checklistVersionId) throw new Error("wirAtConsultant: the Tower has no Checklist Template");
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, ${type}, ${title}, app.latest_form_version(${type}), ${JSON.stringify({ checklist_template: checklistVersionId })}::jsonb,
      ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  if (created!.outcome !== "created") throw new Error(`wirAtConsultant create: ${created!.outcome}`);
  const id = created!.work_item_id;
  await expectOutcome("wirAtConsultant sync", outcome(c1.members.engineer, sql`select app.sync_work_item_checklists(${id}::uuid, now()) as outcome`), "synced");
  await expectOutcome("wirAtConsultant send_for_review", take(c1.members.engineer, id, "send_for_review"), "applied");
  await expectOutcome("wirAtConsultant pick up (C1 PM)", pickUp(c1.members.project_manager, id), "picked_up");
  await expectOutcome("wirAtConsultant submit", take(c1.members.project_manager, id, "submit"), "applied");
  if ("manager" in k1.members) await expectOutcome("wirAtConsultant pick up (K1 Engineer)", pickUp(k1.members.engineer, id), "picked_up");
  return id;
}
