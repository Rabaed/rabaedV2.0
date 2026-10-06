import { z } from "zod";
import { workItemOutcome, workItemTypeCode } from "./work-item.ts";

/**
 * The work item query's filter model (spec RP-344): what the List shows, and
 * later the Kanban, the Dashboard's drill-downs, Need My Action counts and
 * Search. It lives in the URL, so a view can be bookmarked or shared: every
 * filter is a query parameter, a list of values joined by commas. A value left
 * at its default is left out of the URL.
 *
 * Later filters (`needMyAction`, `q`, `submittedFrom`/`submittedTo`, `codeC`)
 * are new keys of the same object, so nothing that builds or reads a query
 * changes when they come.
 */

/** The List's page size. */
export const workItemPageSize = 50;

/** Sort by Step Age, the oldest first and closed items (which don't age) last, or by Document Number, items with no number yet last. */
export const workItemSorts = ["stepAge", "documentNumber"] as const;
export type WorkItemSort = (typeof workItemSorts)[number];

/** The Step Age filter: open items in at least their 2nd, 3rd or 4th week at their Step. */
export const stepAgeMinimums = [2, 3, 4] as const;

const uuid = z.uuid();
const stageKey = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);

/**
 * Who an item is with (the "With" column, V14):
 * - `me`: a Step of my own Company that I have claimed;
 * - `unclaimed`: a Step of my own Company nobody has claimed yet;
 * - `step:<key>`: my own Company's Step `key`, claimed or not;
 * - `company:<participant id>`: another Company holds it, as one.
 */
export type WithFilterValue = "me" | "unclaimed" | `step:${string}` | `company:${string}`;
export const withFilterValue = z
  .string()
  .refine(
    (v) => v === "me" || v === "unclaimed" || (v.startsWith("step:") && stageKey.safeParse(v.slice(5)).success) || (v.startsWith("company:") && uuid.safeParse(v.slice(8)).success),
    "Not a With filter",
  )
  .transform((v) => v as WithFilterValue);

/** A list parameter: given repeated or joined by commas, read as one list. */
const list = <T extends z.ZodType>(item: T) =>
  z
    .preprocess(
      (v) => (v === undefined ? [] : (Array.isArray(v) ? v : [v]).flatMap((s) => (typeof s === "string" ? s.split(",") : [s])).filter((s) => s !== "")),
      z.array(item).max(100),
    )
    .transform((values) => [...new Set(values)]);

const flag = z.preprocess((v) => v === true || v === "true" || v === "1", z.boolean());

const queryFields = {
  type: list(workItemTypeCode),
  stage: list(stageKey),
  with: list(withFilterValue),
  trade: list(uuid),
  /** A Location takes in the Locations under it. */
  location: list(uuid),
  /** The Review Code or Inspection Result. */
  outcome: list(workItemOutcome),
  stepAgeMin: z.coerce
    .number()
    .pipe(z.union(stepAgeMinimums.map((n) => z.literal(n))))
    .optional(),
  /** Every visible Revision, not only the latest of each chain. */
  allRevisions: flag,
  sort: z.enum(workItemSorts).default("stepAge"),
  /** Where the page starts: the `nextCursor` of the page before. */
  cursor: z.string().max(1000).optional(),
};

/** The filters that take a list of values; every other key takes one. */
const listKeys = ["type", "stage", "with", "trade", "location", "outcome"] as const satisfies readonly (keyof typeof queryFields)[];
/** The keys that narrow the rows, as opposed to how they are shown (sort, Revisions, page). */
const filterKeys = [...listKeys, "stepAgeMin"] as const;

/** The query as the API takes it; a cursor must be one made for its sort. */
export const workItemQuery = z.object(queryFields).superRefine((q, ctx) => {
  if (q.cursor !== undefined && decodeWorkItemCursor(q.cursor, q.sort) === null) {
    ctx.addIssue({ code: "custom", path: ["cursor"], message: "Not a cursor of this sort" });
  }
});
export type WorkItemQuery = z.infer<typeof workItemQuery>;
/** A query as code builds one: any key left out takes its default. */
export type WorkItemQueryInput = Partial<WorkItemQuery>;

type SearchParamsLike = URLSearchParams | Record<string, string | string[] | undefined>;

function rawParams(params: SearchParamsLike): Record<string, string[]> {
  if (params instanceof URLSearchParams) {
    const out: Record<string, string[]> = {};
    for (const key of new Set(params.keys())) out[key] = params.getAll(key);
    return out;
  }
  return Object.fromEntries(
    Object.entries(params).flatMap(([key, v]) => (v === undefined ? [] : [[key, Array.isArray(v) ? v : [v]]])),
  );
}

/**
 * The query a URL holds, for a page that shows it: a parameter that isn't
 * valid is left at its default rather than refused, and so is a cursor of
 * another sort, so an edited or old link still opens the view.
 */
export function workItemQueryFromSearchParams(params: SearchParamsLike): WorkItemQuery {
  const raw = rawParams(params);
  const entries = Object.entries(queryFields).map(([key, schema]) => {
    const values = raw[key];
    const given = values === undefined || (listKeys as readonly string[]).includes(key) ? values : values[0];
    const parsed = schema.safeParse(given);
    return [key, parsed.success ? parsed.data : schema.parse(undefined)] as const;
  });
  const query = Object.fromEntries(entries) as WorkItemQuery;
  if (query.cursor !== undefined && decodeWorkItemCursor(query.cursor, query.sort) === null) delete query.cursor;
  return query;
}

/** The URL query parameters of `query`, its defaults left out, in a stable order. */
export function workItemSearchParams(query: Partial<WorkItemQuery>): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of listKeys) {
    const values = query[key];
    if (values && values.length > 0) params.set(key, values.join(","));
  }
  if (query.stepAgeMin !== undefined) params.set("stepAgeMin", String(query.stepAgeMin));
  if (query.allRevisions) params.set("allRevisions", "true");
  if (query.sort && query.sort !== "stepAge") params.set("sort", query.sort);
  if (query.cursor) params.set("cursor", query.cursor);
  return params;
}

/** Whether `query` narrows the rows by any filter. */
export function isFilteredWorkItemQuery(query: WorkItemQuery): boolean {
  return filterKeys.some((key) => (key === "stepAgeMin" ? query[key] !== undefined : query[key].length > 0));
}

/** `query` with no filters, from the first page: its sort and "Show all Revisions" kept. */
export function withoutFilters(query: WorkItemQuery): WorkItemQuery {
  return { ...workItemQuery.parse({}), allRevisions: query.allRevisions, sort: query.sort };
}

/**
 * A cursor: the sort it was made for and the last row's sort key, opaque to the
 * client. The key is what the API sorts by, as text, ending with the row's id.
 */
export function encodeWorkItemCursor(sort: WorkItemSort, key: readonly string[]): string {
  return toBase64Url(JSON.stringify([sort, ...key]));
}

// The last row's sort key, by sort, before its id: whether it sorts last (closed, or
// no number yet) as "true" or "false", then when it entered its Step (UTC, to the
// microsecond) or its Document Number. Checked here, so a tampered cursor is refused
// before it reaches a query.
const enteredAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const isFlag = (v: string | undefined) => v === "true" || v === "false";
const cursorKeyValid: Record<WorkItemSort, (key: string[]) => boolean> = {
  stepAge: ([last, at, id]) => isFlag(last) && enteredAt.test(at ?? "") && uuid.safeParse(id).success,
  documentNumber: ([last, , id]) => isFlag(last) && uuid.safeParse(id).success,
};

/** The sort key a cursor holds, or null when it isn't a cursor made for `sort`. */
export function decodeWorkItemCursor(cursor: string, sort: WorkItemSort): string[] | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(fromBase64Url(cursor));
  } catch {
    return null;
  }
  if (!Array.isArray(decoded) || decoded[0] !== sort || !decoded.every((v) => typeof v === "string")) return null;
  const key = decoded.slice(1) as string[];
  if (key.length !== 3 || !cursorKeyValid[sort](key)) return null;
  return key;
}

// Base64url of UTF-8 text, in the browser as on the server.
function toBase64Url(text: string): string {
  const binary = String.fromCodePoint(...new TextEncoder().encode(text));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(encoded: string): string {
  const binary = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (c) => c.codePointAt(0)!));
}
