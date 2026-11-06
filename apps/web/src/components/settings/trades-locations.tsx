"use client";

import type { BilingualText, DimensionValue, Locale, Scope } from "@rabaed/domain";
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  Field,
  Icon,
  Input,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
  useToast,
  type IconName,
} from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "@/i18n/navigation";

// Project Settings → Trades & Locations to the owner's reference (RP-1156, gap rows 3 to 19): one card
// with a Trades and a Locations tab, a search, Expand all / Collapse all and a tree. Every Project Member
// reads it; a Project Admin adds Trades, Scopes, Sub-scopes and Locations, and renames, archives and
// restores Scopes and Sub-scopes (row 11: Trades and Locations have no rename or archive yet).

type Kind = "trade" | "scope" | "location";

/** One row of the tree: a Trade, a Scope or Sub-scope, or a Location. */
type Node = {
  id: string;
  parentId: string | null;
  kind: Kind;
  name: BilingualText;
  /** Trades and Locations; Scopes have none (row 8). */
  code: string | null;
  /** Scopes only: an archived one shows with "Show archived" (row 11). */
  active: boolean;
  /** Locations: 1 Zone, 2 Building, 3 Floor. Trades 1, Scopes 2, Sub-scopes 3. */
  depth: number;
};

type Tab = "trades" | "locations";

/** What the Add dialog adds: a Trade, a top Location, or something under `parent`. */
type Adding = { kind: Kind; parent: Node | null };

const plain = (s: string) => s.toLocaleLowerCase();

/** Trades with their Scopes and Sub-scopes beneath them, as one tree. */
function tradeNodes(trades: DimensionValue[], scopes: Scope[]): Node[] {
  return [
    ...trades.map((t) => ({ id: t.id, parentId: null, kind: "trade" as const, name: t.name, code: t.code, active: true, depth: 1 })),
    ...scopes.map((s) => ({
      id: s.id,
      parentId: s.parentId ?? s.tradeId,
      kind: "scope" as const,
      name: s.name,
      code: null,
      active: s.active,
      depth: s.parentId === null ? 2 : 3,
    })),
  ];
}

const locationNodes = (locations: DimensionValue[]): Node[] =>
  locations.map((l) => ({ id: l.id, parentId: l.parentId, kind: "location" as const, name: l.name, code: l.code, active: true, depth: l.depth }));

/** The text with each match of `query` marked (row 5). */
function Marked({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const parts: ReactNode[] = [];
  const lower = plain(text);
  const q = plain(query);
  let at = 0;
  for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, at)) {
    if (i > at) parts.push(text.slice(at, i));
    parts.push(
      <mark key={i} className="rounded-[3px] bg-warning-tint px-0.5 text-text">
        {text.slice(i, i + q.length)}
      </mark>,
    );
    at = i + q.length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

/** Sends a change to the API; on success refreshes the page and shows `done` as a toast. */
function useCommand() {
  const t = useTranslations("tradesLocations");
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const errors: Record<string, string> = {
    invalid_request: t("invalid"),
    forbidden: t("notAdmin"),
    duplicate_code: t("duplicateCode"),
    project_closed: t("projectClosed"),
    too_deep: t("tooDeep"),
    not_found: t("notFound"),
    trade_not_found: t("notFound"),
    parent_not_found: t("notFound"),
    parent_deactivated: t("parentArchived"),
  };

  /** The refusal's message, or null when it went through. */
  async function send(path: string, method: "POST" | "PATCH", body: unknown, done: string): Promise<string | null> {
    setPending(true);
    try {
      const res = await fetch(`/api/v1${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) {
        toast({ title: done, tone: "success" });
        router.refresh();
        return null;
      }
      const { error: code } = (await res.json().catch(() => ({}))) as { error?: string };
      return errors[code ?? ""] ?? t("unavailable");
    } catch {
      return t("unavailable");
    } finally {
      setPending(false);
    }
  }
  return { send, pending };
}

export type TradesLocationsProps = {
  projectId: string;
  canEdit: boolean;
  trades: DimensionValue[];
  locations: DimensionValue[];
  scopes: Scope[];
};

export function TradesLocations({ projectId, canEdit, trades, locations, scopes }: TradesLocationsProps) {
  const t = useTranslations("tradesLocations");
  const locale = useLocale() as Locale;
  const { send, pending } = useCommand();
  const [tab, setTab] = useState<Tab>("trades");
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  // Closed rows; everything starts open (screenshot 1).
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState<Adding | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<Node | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const all = useMemo(() => (tab === "trades" ? tradeNodes(trades, scopes) : locationNodes(locations)), [tab, trades, scopes, locations]);
  const archivedCount = scopes.filter((s) => !s.active).length;
  const counts = { trades: trades.length + scopes.filter((s) => s.active).length, locations: locations.length };

  // A Scope that is archived (or under one) is shown only with "Show archived".
  const nodes = useMemo(() => {
    const byId = new Map(all.map((n) => [n.id, n]));
    const archived = (n: Node): boolean => !n.active || (n.parentId !== null && !!byId.get(n.parentId) && archived(byId.get(n.parentId)!));
    return showArchived ? all : all.filter((n) => !archived(n));
  }, [all, showArchived]);

  const children = useMemo(() => {
    const map = new Map<string | null, Node[]>();
    for (const n of nodes) map.set(n.parentId, [...(map.get(n.parentId) ?? []), n]);
    return map;
  }, [nodes]);

  // Searching keeps each match with its parents, open (row 5).
  const q = query.trim();
  const shown = useMemo(() => {
    if (!q) return null;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const keep = new Set<string>();
    const hit = (n: Node) => [n.name.en, n.name.ar, n.code ?? ""].some((s) => plain(s).includes(plain(q)));
    for (const n of nodes) {
      if (!hit(n)) continue;
      for (let p: Node | undefined = n; p; p = p.parentId ? byId.get(p.parentId) : undefined) keep.add(p.id);
    }
    return keep;
  }, [nodes, q]);

  const parentIds = nodes.filter((n) => (children.get(n.id) ?? []).length > 0).map((n) => n.id);
  const isOpen = (id: string) => shown !== null || !closed.has(id);
  const toggle = (id: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function countLabel(n: Node): string | null {
    const count = (children.get(n.id) ?? []).length;
    if (count === 0) return null;
    if (n.kind === "trade") return t("scopeCount", { count });
    if (n.kind === "scope") return t("subScopeCount", { count });
    return t("placeCount", { count });
  }

  async function setActive(node: Node, active: boolean) {
    const message = await send(`/scopes/${node.id}`, "PATCH", { active }, t(active ? "restoredToast" : "archivedToast", { name: node.name[locale] }));
    setRowError(message ? { id: node.id, message } : null);
    if (!message) setArchiving(null);
  }

  function rows(parent: string | null, level: number): ReactNode[] {
    return (children.get(parent) ?? [])
      .filter((n) => shown === null || shown.has(n.id))
      .map((n) => {
        const kids = (children.get(n.id) ?? []).length > 0;
        const open = isOpen(n.id);
        return (
          <Fragment key={n.id}>
            <TreeRow
              node={n}
              level={level}
              hasChildren={kids}
              open={open}
              onToggle={() => toggle(n.id)}
              query={q}
              countLabel={countLabel(n)}
              canEdit={canEdit}
              pending={pending}
              renaming={renaming === n.id}
              error={rowError?.id === n.id ? rowError.message : null}
              onAdd={() => setAdding({ kind: n.kind === "location" ? "location" : "scope", parent: n })}
              onRename={() => {
                setRowError(null);
                setRenaming(n.id);
              }}
              onRenameDone={async (name) => {
                if (name === null) return setRenaming(null);
                const message = await send(`/scopes/${n.id}`, "PATCH", { name }, t("renamedToast"));
                setRowError(message ? { id: n.id, message } : null);
                if (!message) setRenaming(null);
              }}
              onArchive={() => setArchiving(n)}
              onRestore={() => void setActive(n, true)}
            />
            {kids && open && rows(n.id, level + 1)}
          </Fragment>
        );
      });
  }

  const list = rows(null, 0);
  const isTrades = tab === "trades";

  return (
    <section className="rounded-[14px] border border-border bg-surface" aria-label={t("title")} data-testid="trades-locations">
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(v as Tab);
              setQuery("");
              setRenaming(null);
            }}
          >
            <TabsList>
              <TabsTrigger value="trades" icon="category" count={counts.trades}>
                {t("trades")}
              </TabsTrigger>
              <TabsTrigger value="locations" icon="map-pin" count={counts.locations}>
                {t("locations")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <label className="relative min-w-[200px] flex-1 sm:max-w-[280px]">
            <span className="sr-only">{t(isTrades ? "searchTrades" : "searchLocations")}</span>
            <Icon name="search" size={16} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(isTrades ? "searchTrades" : "searchLocations")}
              className="ps-8"
            />
          </label>
          <div className="flex items-center gap-1 ms-auto">
            <Button variant="ghost" size="sm" onClick={() => setClosed(new Set())}>
              <Icon name="chevron-down" size={16} />
              {t("expandAll")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setClosed(new Set(parentIds))}>
              <Icon name="chevron-up" size={16} />
              {t("collapseAll")}
            </Button>
          </div>
        </div>
        {(isTrades && archivedCount > 0) || canEdit ? (
          <div className="flex flex-wrap items-center gap-4">
            {isTrades && archivedCount > 0 && (
              <Field label={t("showArchived", { count: archivedCount })} layout="inline">
                <Checkbox checked={showArchived} onCheckedChange={(c) => setShowArchived(c === true)} />
              </Field>
            )}
            {canEdit && (
              <Button size="sm" onClick={() => setAdding({ kind: isTrades ? "trade" : "location", parent: null })}>
                <Icon name="plus" size={16} />
                {t(isTrades ? "addTrade" : "addLocation")}
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {nodes.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">{t(isTrades ? "noTrades" : "noLocations")}</p>
      ) : list.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted" role="status">
          {t("noMatch", { query: q })}
        </p>
      ) : (
        <ul role="tree" aria-label={t(isTrades ? "trades" : "locations")} data-testid={isTrades ? "trades" : "locations"}>
          {list}
        </ul>
      )}

      <p className="flex items-start gap-2 border-t border-border px-5 py-3.5 text-xs text-muted">
        <Icon name="info-circle" size={14} className="mt-px shrink-0" />
        {t("footer")}
      </p>

      {adding && <AddDialog projectId={projectId} adding={adding} tradeOf={(n) => tradeIdOf(n, all)} onClose={() => setAdding(null)} />}
      {archiving && (
        <Dialog open onOpenChange={(open) => !open && setArchiving(null)}>
          <DialogContent closeLabel={t("close")} title={t("archiveTitle", { name: archiving.name[locale] })} description={t("archiveBody")}>
            {rowError?.id === archiving.id && (
              <p role="alert" className="text-sm text-danger-fg">
                {rowError.message}
              </p>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">{t("cancel")}</Button>
              </DialogClose>
              <Button variant="danger" disabled={pending} onClick={() => void setActive(archiving, false)}>
                {t("archive")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

/** The Trade a Scope or Sub-scope is under. */
function tradeIdOf(node: Node, all: Node[]): string {
  const byId = new Map(all.map((n) => [n.id, n]));
  let n: Node | undefined = node;
  while (n && n.kind !== "trade") n = n.parentId ? byId.get(n.parentId) : undefined;
  return n?.id ?? node.id;
}

function TreeRow({
  node,
  level,
  hasChildren,
  open,
  onToggle,
  query,
  countLabel,
  canEdit,
  pending,
  renaming,
  error,
  onAdd,
  onRename,
  onRenameDone,
  onArchive,
  onRestore,
}: {
  node: Node;
  level: number;
  hasChildren: boolean;
  open: boolean;
  onToggle: () => void;
  query: string;
  countLabel: string | null;
  canEdit: boolean;
  pending: boolean;
  renaming: boolean;
  error: string | null;
  onAdd: () => void;
  onRename: () => void;
  onRenameDone: (name: BilingualText | null) => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const t = useTranslations("tradesLocations");
  const locale = useLocale() as Locale;
  const name = node.name[locale];
  const top = level === 0;
  // A Floor holds nothing; a Sub-scope has no Sub-scopes; an archived Scope takes no new ones.
  const canAdd = canEdit && node.active && node.depth < 3;
  const addLabel = node.kind === "trade" ? t("addScope") : node.kind === "scope" ? t("addSubScope") : t("addPlace");
  const isScope = node.kind === "scope";

  return (
    <li
      role="treeitem"
      aria-level={level + 1}
      aria-expanded={hasChildren ? open : undefined}
      aria-selected={false}
      className="group border-b border-border last:border-b-0 focus-within:bg-hover hover:bg-hover"
      data-testid={`row-${node.kind}`}
    >
      <div className="flex min-h-[42px] flex-wrap items-center gap-x-2 gap-y-1 py-2 pe-4" style={{ paddingInlineStart: `${20 + level * 26}px` }}>
        <span className="flex w-6 shrink-0 justify-center">
          {hasChildren && (
            <button
              type="button"
              onClick={onToggle}
              className="rounded-sm p-0.5 text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-focus"
              aria-label={t(open ? "collapseRow" : "expandRow", { name })}
            >
              <Icon name="chevron-down" size={16} className={cn("transition-transform", !open && "-rotate-90 rtl:rotate-90")} />
            </button>
          )}
        </span>
        {renaming ? (
          <RenameForm name={node.name} pending={pending} onDone={onRenameDone} />
        ) : (
          <>
            <span className={cn("text-sm", top ? "font-semibold text-text" : "font-medium text-text", !node.active && "text-muted line-through")}>
              <Marked text={name} query={query} />
              {node.kind === "trade" && node.code && (
                <span className="font-normal text-muted">
                  {" "}
                  (<bdi dir="ltr">{node.code}</bdi>)
                </span>
              )}
            </span>
            {node.code && (
              <bdi dir="ltr" className="rounded-[5px] border border-border bg-canvas px-1.5 py-px font-mono text-[11.5px] font-semibold text-text">
                <Marked text={node.code} query={query} />
              </bdi>
            )}
            {!node.active && (
              <span className="rounded-full bg-neutral-tint px-2 py-px text-[11.5px] font-semibold text-neutral-fg">{t("archived")}</span>
            )}
            {countLabel && <span className="text-xs text-muted">{countLabel}</span>}
            {canEdit && (
              <span className="flex flex-wrap gap-1 ms-auto opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                {canAdd && (
                  <RowAction icon="plus" onClick={onAdd} disabled={pending} name={name}>
                    {addLabel}
                  </RowAction>
                )}
                {isScope && node.active && (
                  <>
                    <RowAction icon="pencil" onClick={onRename} disabled={pending} name={name}>
                      {t("rename")}
                    </RowAction>
                    <RowAction icon="eye-off" onClick={onArchive} disabled={pending} name={name}>
                      {t("archive")}
                    </RowAction>
                  </>
                )}
                {isScope && !node.active && (
                  <RowAction icon="refresh" onClick={onRestore} disabled={pending} name={name}>
                    {t("restore")}
                  </RowAction>
                )}
              </span>
            )}
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="pb-2 text-sm text-danger-fg" style={{ paddingInlineStart: `${52 + level * 26}px` }}>
          {error}
        </p>
      )}
    </li>
  );
}

function RowAction({ icon, onClick, disabled, name, children }: { icon: IconName; onClick: () => void; disabled: boolean; name: string; children: string }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} disabled={disabled} aria-label={`${children}: ${name}`} className="h-7 px-2 text-xs">
      <Icon name={icon} size={14} />
      {children}
    </Button>
  );
}

/** Rename in the row (row 14): English and Arabic names; Enter saves, Escape cancels. */
function RenameForm({ name, pending, onDone }: { name: BilingualText; pending: boolean; onDone: (name: BilingualText | null) => void }) {
  const t = useTranslations("tradesLocations");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onDone({ en: String(form.get("nameEn") ?? "").trim(), ar: String(form.get("nameAr") ?? "").trim() });
  }
  const escape = (event: KeyboardEvent) => {
    if (event.key === "Escape") onDone(null);
  };
  return (
    <form onSubmit={submit} onKeyDown={escape} className="flex flex-1 flex-wrap items-center gap-2" noValidate>
      <Input name="nameEn" dir="ltr" defaultValue={name.en} aria-label={t("nameEn")} maxLength={200} className="h-8 w-48" autoFocus />
      <Input name="nameAr" dir="rtl" defaultValue={name.ar} aria-label={t("nameAr")} maxLength={200} className="h-8 w-48" />
      <Button type="submit" size="sm" disabled={pending}>
        {t("save")}
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={() => onDone(null)}>
        {t("cancel")}
      </Button>
    </form>
  );
}

/** "Add Trade", "Add Location" or "Add under ‹name›" (row 12): both names, and a code for Trades and Locations. */
function AddDialog({
  projectId,
  adding,
  tradeOf,
  onClose,
}: {
  projectId: string;
  adding: Adding;
  tradeOf: (n: Node) => string;
  onClose: () => void;
}) {
  const t = useTranslations("tradesLocations");
  const locale = useLocale() as Locale;
  const { send, pending } = useCommand();
  const [error, setError] = useState<string | null>(null);
  const { kind, parent } = adding;
  const withCode = kind !== "scope";
  const title = parent ? t("addUnder", { name: parent.name[locale] }) : t(kind === "trade" ? "addTrade" : "addLocation");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = { en: String(form.get("nameEn") ?? "").trim(), ar: String(form.get("nameAr") ?? "").trim() };
    const code = String(form.get("code") ?? "").trim().toUpperCase();
    const [path, body] =
      kind === "scope"
        ? [`/projects/${projectId}/scopes`, { tradeId: tradeOf(parent!), parentId: parent!.kind === "scope" ? parent!.id : null, name }]
        : kind === "trade"
          ? [`/projects/${projectId}/trades`, { code, name }]
          : [`/projects/${projectId}/locations`, { code, name, parentId: parent?.id ?? null }];
    const message = await send(path, "POST", body, t("addedToast", { name: name[locale] }));
    if (message) return setError(message);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t("close")} title={title}>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <Field label={t("nameEn")} id="add-name-en" required>
            <Input name="nameEn" dir="ltr" maxLength={200} autoFocus />
          </Field>
          <Field label={t("nameAr")} id="add-name-ar" required>
            <Input name="nameAr" dir="rtl" maxLength={200} />
          </Field>
          {withCode && (
            <Field label={t("code")} help={t("codeHint")} id="add-code" required>
              <Input name="code" dir="ltr" maxLength={6} className="font-mono uppercase" />
            </Field>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger-fg">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {t("add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
