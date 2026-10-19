// The Tower of the seam 2 suites (RP-980): the setup the visibility suites of packages/db/test copy by
// hand, built once. Seam 1's counterpart is buildTower (apps/api/test/support/tower.ts).
//
//   C1  Contractor, the Project's creator and Admin: an Engineer and a Project Manager.
//   K1  Consultant: an Engineer and a Manager.
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
import { joinProject } from "./index.ts";

const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const bilingual = (en: string) => ({ en, ar: en });

/** The Checklist Template a Tower carries unless told otherwise: two check items. */
export const SEAM_TWO_CHECKLIST_ITEMS = [
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
  /** The Project's Checklist Template (a Version of it, `checklist`): `false` for none. Default: SEAM_TWO_CHECKLIST_ITEMS under "Concrete pour". */
  checklistTemplate?: false | { name?: string; items?: unknown[] };
};

type Other = { id: string; cr: string; ap: string; projectId: string };

export type SeamTwoTower<O extends SeamTwoOptions = SeamTwoOptions> = {
  app: Db;
  migrator: pg.Client;
  projectId: string;
  tradeId: string;
  /** Where the work is. */
  buildingA: string;
  buildingB: string;
  c1: SeamTwoCompany<"engineer" | "project_manager">;
  k1: SeamTwoCompany<"engineer" | "manager">;
  ow: SeamTwoCompany<"representative">;
  c2: SeamTwoCompany<"engineer">;
  /** The Checklist Template and its Version 1, unless `checklistTemplate` is false. */
  checklist: { templateId: string; versionId: string } | undefined;
  /** Runs `query` in a transaction as Member `as`, the app role, and returns its rows. */
  call: <T extends object>(as: string, query: ReturnType<typeof sql<T>>) => Promise<T[]>;
  /** `call` for a query selecting one `outcome`. */
  outcome: (as: string, query: ReturnType<typeof sql<{ outcome: string }>>) => Promise<string>;
  /** `as` takes `transition` on item `id` (confirmed, with the item's own answers hash); returns the outcome. */
  take: (as: string, id: string, transition: string, answers?: object) => Promise<string>;
  /** `as` picks item `id` up at its Step; returns the outcome. */
  pickUp: (as: string, id: string) => Promise<string>;
} & (O["otherProject"] extends true ? { other: Other } : { other?: undefined });

/** Builds a Tower with the `migrator` (a connected client of the test database) and the `app` role's `Db`. */
export async function buildSeamTwoTower<const O extends SeamTwoOptions = {}>(app: Db, migrator: pg.Client, options?: O): Promise<SeamTwoTower<O>> {
  const { projectCode = "RST", tradeCode = "EL", c2OtherLocation = true, ownerOversight = true, otherProject = false, checklistTemplate } = options ?? {};
  const one = async (text: string, values: unknown[]): Promise<string> => (await migrator.query(text, values)).rows[0].id as string;
  const call: SeamTwoTower["call"] = (as, query) => withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));
  const outcome: SeamTwoTower["outcome"] = (as, query) => call(as, query).then((rows) => rows[0]!.outcome);
  const expectSet = async (what: string, result: Promise<string>) => {
    const got = await result;
    if (got !== "set") throw new Error(`${what}: ${got}`);
  };

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
  const k1 = await withMembers("K1", ["engineer", "manager"] as const);
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
      await expectSet(
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
        await expectSet(`visibility of ${position}`, outcome(admin, sql`select app.set_member_visibility(${p}::uuid, ${m}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`));
      }
      await expectSet(`position ${position}`, outcome(admin, sql`select app.set_project_member_positions(${p}::uuid, ${m}::uuid, ${[position]}::text[]) as outcome`));
    }
  }

  let checklist: { templateId: string; versionId: string } | undefined;
  if (checklistTemplate !== false) {
    const { name = "Concrete pour", items = SEAM_TWO_CHECKLIST_ITEMS } = checklistTemplate ?? {};
    const [template] = await call<{ outcome: string; template_id: string }>(
      c1.ap,
      sql`select outcome, template_id from app.create_checklist_template(${projectId}::uuid, ${JSON.stringify(bilingual(name))}::jsonb, ${tradeId}::uuid, ${JSON.stringify(items)}::jsonb, now())`,
    );
    if (template!.outcome !== "created") throw new Error(`checklist template: ${template!.outcome}`);
    checklist = {
      templateId: template!.template_id,
      versionId: await one("select id from checklist_template_version where checklist_template_id = $1 and version_no = 1", [template!.template_id]),
    };
  }

  const take: SeamTwoTower["take"] = (as, id, transition, answers = {}) =>
    outcome(
      as,
      sql`select app.take_transition(${id}::uuid, ${transition}, ${JSON.stringify(answers)}::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
    );
  const pickUp: SeamTwoTower["pickUp"] = (as, id) => outcome(as, sql`select app.pick_up_step(${id}::uuid, now()) as outcome`);

  const tower = {
    app,
    migrator,
    projectId,
    tradeId,
    buildingA,
    buildingB,
    c1: { id: c1.id, cr: c1.cr, ap: c1.ap, participantId: participantId.c1, members: c1.members },
    k1: { id: k1.id, cr: k1.cr, ap: k1.ap, participantId: participantId.k1, members: k1.members },
    ow: { id: ow.id, cr: ow.cr, ap: ow.ap, participantId: participantId.ow, members: ow.members },
    c2: { id: c2.id, cr: c2.cr, ap: c2.ap, participantId: participantId.c2, members: c2.members },
    checklist,
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
  /** Default: the Tower's Trade and Building A. */
  trade?: string;
  location?: string;
  /** The Checklist Template Version it copies. Default: the Tower's. */
  templateVersion?: string;
};

/**
 * C1's Engineer raises a WIR on `options.type` with the Checklist Template picked and its checklist copied, Sends it
 * for review; C1's Project Manager picks it up and Submits it; K1's Engineer picks it up at the Consultant Step.
 * Returns the item's id.
 */
export async function wirAtConsultant(
  tower: Pick<SeamTwoTower, "projectId" | "tradeId" | "buildingA" | "checklist" | "c1" | "k1" | "call" | "outcome" | "take" | "pickUp">,
  options: WirAtConsultantOptions,
): Promise<string> {
  const { type, title, trade = tower.tradeId, location = tower.buildingA, templateVersion = tower.checklist?.versionId } = options;
  if (!templateVersion) throw new Error("wirAtConsultant: the Tower has no Checklist Template; pass templateVersion");
  const { c1, k1, call, outcome, take, pickUp, projectId } = tower;
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, ${type}, ${title}, app.latest_form_version(${type}), ${JSON.stringify({ checklist_template: templateVersion })}::jsonb,
      ${trade}::uuid, ${location}::uuid, now())`,
  );
  const step = async (what: string, got: Promise<string>, wanted: string) => {
    const result = await got;
    if (result !== wanted) throw new Error(`wirAtConsultant ${what}: ${result}`);
  };
  if (created!.outcome !== "created") throw new Error(`wirAtConsultant create: ${created!.outcome}`);
  const id = created!.work_item_id;
  await step("sync", outcome(c1.members.engineer, sql`select app.sync_work_item_checklists(${id}::uuid, now()) as outcome`), "synced");
  await step("send_for_review", take(c1.members.engineer, id, "send_for_review"), "applied");
  await step("pick up (C1 PM)", pickUp(c1.members.project_manager, id), "picked_up");
  await step("submit", take(c1.members.project_manager, id, "submit"), "applied");
  await step("pick up (K1 Engineer)", pickUp(k1.members.engineer, id), "picked_up");
  return id;
}
