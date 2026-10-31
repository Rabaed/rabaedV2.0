// The seam-2 id sweep (RP-1166): every `app.*` function the app role may execute, called as each outsider of
// a scenario world, must give no id of a Step, Company, Participant or Member that outsider may not see.
// RP-1138 (the Owner's review holder), RP-1140 (K1's later internal Step) and RP-1079 (reply files) were each a
// database read that handed out what only the api masked, found by chance. The sweep finds them by itself:
// packages/db/test/id-sweep-rls.test.ts builds the worlds and calls the functions; this file has the catalog,
// the call, what counts as a leak and the allow list. Import by path (it is not re-exported).
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type pg from "pg";
import type { Db } from "../src/client.ts";
import { APP_ROLE } from "../src/config.ts";
import { rolledBack } from "./index.ts";

export type IdKind = "step" | "company" | "participant" | "member";

/** An id the world's outsider may not read, with what it is, for the failure. */
export type ForbiddenId = { id: string; kind: IdKind; what: string };

/** Where a forbidden id was found in what a call gave. */
export type IdHit = ForbiddenId & { at: string };

/** An argument of a function: its name (empty when it has none) and type, as `format_type` gives it. */
export type CatalogArgument = { name: string; type: string };

/** A function the app role may execute: `app.name`, its signature `app.name(types)` and its input arguments. */
export type CatalogFunction = { name: string; signature: string; args: CatalogArgument[] };

/** One function called once, as one viewer, in one world. */
export type SweepCall = { name: string; signature: string; world: string; viewer: string; hits: IdHit[]; error: string | null };

/**
 * An allow-list entry. `skip`: the function is not called at all, for that reason. `errors`: it is called, and
 * errors for every caller, for that reason (its error messages are still searched). Otherwise the entry excuses
 * the id `kinds` it names, from this function only, in the `worlds` it names (all when left out), and only the
 * ids its `whats` names (a world's ForbiddenId.what; all of those kinds when left out), for `reason`;
 * `pending` names the ticket that will make it give them no more.
 */
export type AllowEntry =
  | { name: string; skip: string }
  | { name: string; errors: string }
  | { name: string; kinds: readonly IdKind[]; worlds?: readonly string[]; whats?: readonly string[]; reason: string; pending?: string };

/** The functions the allow list says not to call. */
export const skippedNames = (allow: readonly AllowEntry[]) => new Set(allow.filter((e) => "skip" in e).map((e) => e.name));

/**
 * What the sweep allows, each with its reason. A function the app role may execute is either swept or here
 * (the ratchet), and an entry that excuses nothing, or names a function that is gone, fails the sweep too.
 */
export const SWEEP_ALLOW: readonly AllowEntry[] = [
  {
    name: "app.form_participant_choices",
    kinds: ["participant"],
    worlds: ["5"],
    whats: ["C1's Participant (the Host Company's)"],
    reason:
      "a participant field offers the Host Company to every Participant (V15: another Company's name appears as the Host Company; scenario 43); only the item's other Companies need the item, and those C2 never gets",
  },
];

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Every forbidden id anywhere in `value`: a column, a nested object or array, or inside a text (an error's message). */
export function idsIn(value: unknown, forbidden: readonly ForbiddenId[]): IdHit[] {
  const byId = new Map(forbidden.map((f) => [f.id.toLowerCase(), f]));
  const hits: IdHit[] = [];
  const walk = (v: unknown, at: string) => {
    if (typeof v === "string") {
      for (const m of v.matchAll(UUID)) {
        const f = byId.get(m[0].toLowerCase());
        if (f) hits.push({ ...f, at });
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}[${i}]`));
    else if (v !== null && typeof v === "object" && !(v instanceof Date) && !Buffer.isBuffer(v)) {
      for (const [k, x] of Object.entries(v)) walk(x, at === "" ? k : `${at}.${k}`);
    }
  };
  walk(value, "");
  return hits;
}

const reasonOf = (entry: AllowEntry) => ("skip" in entry ? entry.skip : "errors" in entry ? entry.errors : entry.reason);

type Excusing = Extract<AllowEntry, { kinds: readonly IdKind[] }>;
const excusingEntries = (allow: readonly AllowEntry[]) => allow.filter((e): e is Excusing => "kinds" in e);
const excuseFor = (allow: readonly Excusing[], call: SweepCall, hit: IdHit) =>
  allow.find(
    (e) =>
      e.name === call.name &&
      e.kinds.includes(hit.kind) &&
      (e.worlds === undefined || e.worlds.includes(call.world)) &&
      (e.whats === undefined || e.whats.includes(hit.what)),
  );

/** The hits of `call` that no allow entry excuses. */
export function unexcusedHits(call: SweepCall, allow: readonly AllowEntry[]): IdHit[] {
  const excusing = excusingEntries(allow);
  return call.hits.filter((h) => !excuseFor(excusing, call, h));
}

/** One line per leak: a forbidden id a call gave that no allow entry excuses. */
export function leakProblems(calls: readonly SweepCall[], allow: readonly AllowEntry[]): string[] {
  return calls.flatMap((c) => unexcusedHits(c, allow).map((h) => `${c.signature} gave ${c.viewer} ${h.what} (${h.kind} ${h.id}) at ${h.at}, in scenario ${c.world}`));
}

/**
 * One line per problem of the sweep as a whole (the ratchet): a function neither swept nor skipped, one that errored
 * for every caller with no `errors` entry, and an entry that is stale (its function gone, or excusing nothing) or gives no reason.
 */
export function allowProblems(catalog: readonly CatalogFunction[], calls: readonly SweepCall[], allow: readonly AllowEntry[]): string[] {
  const problems: string[] = [];
  const executable = new Set(catalog.map((f) => f.name));
  const skipped = skippedNames(allow);
  const erroring = new Set(allow.filter((e) => "errors" in e).map((e) => e.name));
  const callsOf = new Map<string, SweepCall[]>();
  for (const c of calls) callsOf.set(c.name, [...(callsOf.get(c.name) ?? []), c]);
  const excusing = excusingEntries(allow);
  const used = new Set<AllowEntry>();
  for (const c of calls) {
    for (const h of c.hits) {
      const entry = excuseFor(excusing, c, h);
      if (entry) used.add(entry);
    }
  }
  for (const f of catalog) {
    const made = callsOf.get(f.name) ?? [];
    if (made.length === 0 && !skipped.has(f.name)) {
      problems.push(`${f.signature} is neither swept nor on the allow list: sweep it, or add it to SWEEP_ALLOW in packages/db/test-support/id-sweep.ts with a reason`);
    } else if (made.length > 0 && made.every((c) => c.error !== null) && !erroring.has(f.name)) {
      problems.push(
        `${f.signature} errored for every caller (${made[0]!.error}): give its arguments a value in argumentValue, or add it to SWEEP_ALLOW with \`errors\` and a reason`,
      );
    }
  }
  for (const e of allow) {
    if (reasonOf(e).trim() === "") problems.push(`SWEEP_ALLOW's entry for ${e.name} gives no reason`);
    if (!executable.has(e.name)) problems.push(`SWEEP_ALLOW names ${e.name}, which the app role cannot execute (or is gone): remove the entry`);
    else if ("kinds" in e && !used.has(e)) {
      const fixed = e.pending ? ` (pending ${e.pending} is fixed?)` : "";
      problems.push(`SWEEP_ALLOW excuses ${e.kinds.join(", ")} ids from ${e.name}, but no call gave one${fixed}: remove the entry`);
    } else if ("errors" in e && (callsOf.get(e.name) ?? []).some((c) => c.error === null)) {
      problems.push(`SWEEP_ALLOW says ${e.name} errors for every caller, but a call succeeded: remove the entry`);
    }
  }
  return problems;
}

/** Every problem: the leaks, then the ratchet's. */
export function sweepProblems(catalog: readonly CatalogFunction[], calls: readonly SweepCall[], allow: readonly AllowEntry[]): string[] {
  return [...leakProblems(calls, allow), ...allowProblems(catalog, calls, allow)];
}

/** What a world gives a function's arguments: its item and Project, and ids by argument name. */
export type SweepWorld = { item: string; projectId: string; typeCode: string; title: string; argumentsByName: Record<string, unknown> };

/** The viewer calling: their own Member, Participant, Company and email. */
export type SweepViewer = { member: string; participant: string; company: string; email: string };

/** One random id per sweep, for an argument naming nothing the world has (an idempotency key, a token). */
const unrelatedId = randomUUID();

/**
 * The value a world gives argument `arg` when `viewer` calls: the world's item, Project and named ids by the
 * argument's name, the viewer's own Member, Participant and Company, else a plain value of its type. Null
 * for a type it has none for.
 */
export function argumentValue(arg: CatalogArgument, world: SweepWorld, viewer: SweepViewer): unknown {
  const { name, type } = arg;
  if (name in world.argumentsByName) return world.argumentsByName[name];
  if (type === "uuid") {
    if (/(^|_)(work_)?item_id$|^p_(closed_item|original|source|target)_id$/.test(name)) return world.item;
    if (name === "p_project_id") return world.projectId;
    if (/^p_participant(_id)?$/.test(name)) return viewer.participant;
    if (/^p_((from|to)_)?member_id$|^p_assign_to$/.test(name)) return viewer.member;
    if (name === "p_company_id") return viewer.company;
    return unrelatedId;
  }
  if (type === "uuid[]") {
    if (/^p_(work_item_)?ids$/.test(name)) return [world.item];
    if (name === "p_project_ids") return [world.projectId];
    return [];
  }
  if (type === "text") {
    if (name === "p_type_code") return world.typeCode;
    if (name === "p_q" || name === "p_title") return world.title;
    if (name === "p_email") return viewer.email;
    return "x";
  }
  if (type.endsWith("[]")) return [];
  if (/^timestamp/.test(type) || type === "date") return new Date();
  if (type === "jsonb" || type === "json") return "{}";
  if (type === "boolean") return false;
  if (/^(integer|smallint|bigint|numeric|double precision|real)$/.test(type)) return name === "p_limit" ? 50 : name === "p_arrival" ? 0 : 1;
  if (type === "bytea") return Buffer.from([0]);
  if (type === "interval") return "1 day";
  return null;
}

/** Every function in schema `app` the app role may execute, with its input arguments (not trigger functions). */
export async function readSweepCatalog(db: Db): Promise<CatalogFunction[]> {
  const { rows } = await sql<{ name: string; signature: string; args: CatalogArgument[] }>`
    select 'app.' || p.proname as name,
           'app.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' as signature,
           coalesce((
             select json_agg(json_build_object('name', coalesce(a.name, ''), 'type', pg_catalog.format_type(a.type, null)) order by a.n)
             from unnest(
               coalesce(p.proargnames, pg_catalog.array_fill(null::text, array[coalesce(array_length(p.proallargtypes, 1), p.pronargs)::int])),
               coalesce(p.proargmodes, pg_catalog.array_fill('i'::"char", array[p.pronargs::int])),
               coalesce(p.proallargtypes, p.proargtypes::oid[])
             ) with ordinality as a(name, mode, type, n)
             where a.mode in ('i', 'b', 'v')
           ), '[]'::json) as args
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.prokind = 'f'
      and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
      and pg_catalog.has_function_privilege(${APP_ROLE}, p.oid, 'EXECUTE')
    order by signature`.execute(db);
  return rows;
}

/** What one call gave: its rows, or its error's message (an error can name an id too). */
export type CallResult = { rows: unknown[]; error: string | null };

/** `select * from app.f(...)` with each value cast to its argument's type: a scalar, set or table function alike. */
function callQuery(f: CatalogFunction, values: readonly unknown[]) {
  const args = f.args.length === 0 ? sql.raw("") : sql.join(f.args.map((a, i) => sql`${values[i]}::${sql.raw(a.type)}`));
  const [schema, fn] = f.name.split(".") as [string, string];
  return sql<Record<string, unknown>>`select * from ${sql.id(schema, fn)}(${args})`;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Calls `f` once as Member `as` on `app` (the app role), in a transaction that is always rolled back, so a writer changes nothing. */
export async function callAs(app: Db, as: string, f: CatalogFunction, values: readonly unknown[]): Promise<CallResult> {
  let rows: unknown[] = [];
  try {
    await rolledBack(app, async (trx) => {
      await sql`select set_config('app.member_id', ${as}, true), set_config('statement_timeout', '10s', true)`.execute(trx);
      rows = (await callQuery(f, values).execute(trx)).rows;
    });
  } catch (error) {
    return { rows: [], error: messageOf(error) };
  }
  return { rows, error: null };
}

/**
 * Calls `f` once as Member `as`, as the app role, inside `client`'s open transaction, behind a savepoint it rolls back
 * to: so the call sees what that transaction changed and nobody else does (the sweep's proof puts an old function
 * body back this way). `compiler` is any `Db`, only to compile the query.
 */
export async function callInTransaction(client: pg.Client, compiler: Db, as: string, f: CatalogFunction, values: readonly unknown[]): Promise<CallResult> {
  const { sql: text, parameters } = callQuery(f, values).compile(compiler);
  await client.query("savepoint sweep_call");
  try {
    await client.query(`set local role ${APP_ROLE}`);
    await client.query("select set_config('app.member_id', $1, true), set_config('statement_timeout', '10s', true)", [as]);
    return { rows: (await client.query(text, [...parameters])).rows, error: null };
  } catch (error) {
    return { rows: [], error: messageOf(error) };
  } finally {
    await client.query("rollback to savepoint sweep_call");
  }
}
