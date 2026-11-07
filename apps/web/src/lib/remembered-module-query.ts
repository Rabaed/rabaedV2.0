import {
  locales,
  moduleOfTabPath,
  moduleViewFromSearchParams,
  workItemQueryFromSearchParams,
  workItemSearchParams,
  type ModuleKey,
} from "@rabaed/domain";
import { listQueryFromSearchParams, listSearchParams } from "./list-url.ts";

// A Module tab's last query, per Member, Project and Module, in the Member's own browser (RP-1240):
// its filters, sort and List or Kanban view, so the tab reopens as they left it. Never the page
// number, the open panel or any other one-off parameter. Nothing is sent to the server: a
// remembered value is only ever put back in the tab's URL, which the API checks again (V1), so a
// filter on something the Member can no longer see shows nothing.
//
// It is written only when the Member changes the query on the tab itself, so a link that brings
// its own query (from Home, a notification, an import chip) is shown as it is and never kept until
// they change a filter there. It is read back only into the links that lead to the tab (its Project
// tab, the item page's way back), and only when the link has no query of its own.

export type RememberStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A Module tab: its Project and Module. */
export type ModuleTab = { projectId: string; module: ModuleKey };

/** A page as the browser showed it: a Module tab with its remembered part (null for its Packages view), or null for any other page. */
export type Seen = (ModuleTab & { query: string | null }) | null;

/** The kept entry's shape; another version is ignored. */
const version = 1;

/** The browser's storage, or null where reading it throws (a private window, blocked site data). */
export function rememberStorage(): RememberStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** A Module tab's address, as `projectTabHref` builds it, after an optional locale and before any query. */
const moduleTabPath = new RegExp(String.raw`^(?:/(?:${locales.join("|")}))?/projects/([^/?#]+)/([^/?#]+)/?(?:[?#].*)?$`);

/** The Module tab at `path` (`/<locale>/projects/<id>/<tab path>`, the locale optional, any query ignored), or null. */
export function moduleTabOf(path: string): ModuleTab | null {
  const match = moduleTabPath.exec(path);
  const tabModule = match ? moduleOfTabPath(match[2]!) : null;
  return match && tabModule ? { projectId: match[1]!, module: tabModule } : null;
}

/**
 * What of a Module tab's URL query is remembered: the query as the page reads it (a filter that
 * isn't valid left out), without its page, cursor or any parameter that isn't the query's.
 * "" when the tab is as it opens; null on the Submittals' Packages view, which takes no filter.
 */
export function rememberedPart(search: string, module: ModuleKey): string | null {
  const params = new URLSearchParams(search);
  const view = moduleViewFromSearchParams(params, module);
  if (view === "packages") return null;
  if (view === "list") return listSearchParams({ ...listQueryFromSearchParams(params), module: undefined, page: 1 }).toString();
  const kanban = workItemSearchParams({
    ...workItemQueryFromSearchParams(params),
    module: undefined,
    cursor: undefined,
    page: undefined,
    pageSize: undefined,
    lang: undefined,
  });
  kanban.set("view", "kanban");
  return kanban.toString();
}

/** The page at `pathname` with the query `search`, as `queryToRemember` compares them. */
export function seenAt(pathname: string, search: string): Seen {
  const tab = moduleTabOf(pathname);
  return tab && { ...tab, query: rememberedPart(search, tab.module) };
}

/**
 * The query to remember after the browser moved from `prev` to `now`: `now`'s, when the Member
 * changed it on the same tab ("" when they cleared it); else null, nothing to write. Arriving on
 * the tab (from another page, or on the first page the browser opens) writes nothing.
 */
export function queryToRemember(prev: Seen, now: Seen): string | null {
  if (!prev || !now || prev.projectId !== now.projectId || prev.module !== now.module) return null;
  if (prev.query === null || now.query === null || prev.query === now.query) return null;
  return now.query;
}

const keyOf = (memberId: string, tab: ModuleTab) => `rabaed:module-query:v${version}:${memberId}:${tab.projectId}:${tab.module}`;

/** Keeps `query` for the Member's tab ("" forgets it); quietly does nothing without storage. */
export function writeRemembered(storage: RememberStorage | null, memberId: string, tab: ModuleTab, query: string): void {
  try {
    if (query === "") storage?.removeItem(keyOf(memberId, tab));
    else storage?.setItem(keyOf(memberId, tab), JSON.stringify({ v: version, query }));
  } catch {
    // Not kept: fine.
  }
}

/** The Member's remembered query for the tab, read again as the page reads it; "" when none, or when the entry is corrupt or old. */
export function readRemembered(storage: RememberStorage | null, memberId: string, tab: ModuleTab): string {
  let kept: unknown;
  try {
    kept = JSON.parse(storage?.getItem(keyOf(memberId, tab)) ?? "null");
  } catch {
    return "";
  }
  if (typeof kept !== "object" || kept === null || Array.isArray(kept)) return "";
  const { v, query } = kept as Record<string, unknown>;
  if (v !== version || typeof query !== "string") return "";
  return rememberedPart(query, tab.module) ?? "";
}

/** `href` with the Member's remembered query, when it leads to a Module tab and has no query of its own; else `href` as it is. */
export function rememberedHref(storage: RememberStorage | null, memberId: string | null, href: string): string {
  const tab = moduleTabOf(href);
  if (!memberId || !tab || /[?#]/.test(href)) return href;
  const query = readRemembered(storage, memberId, tab);
  return query ? `${href}?${query}` : href;
}
