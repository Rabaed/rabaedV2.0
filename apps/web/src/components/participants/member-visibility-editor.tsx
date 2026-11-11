"use client";

import type { DimensionKind, DimensionValue, DimensionValues, Locale, Visibility } from "@rabaed/domain";
import { dimensionKinds } from "@rabaed/domain";
import { Checkbox, Field, Icon, SaveBar, cn, useToast, type IconName } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useHandover, type HandoverOutcome } from "@/components/handover";
import { useRouter } from "@/i18n/navigation";
import { impliedBySelection, pickable, treeOrder } from "@/lib/dimension-tree";
import { PathLabel } from "./participants-parts";

export type Grant = { isAll: boolean; selected: ReadonlySet<string> };
export type Draft = Record<DimensionKind, Grant>;

export const draftOf = (visibility: Visibility): Draft => ({
  trade: { isAll: visibility.trade.isAll, selected: new Set(visibility.trade.valueIds) },
  location: { isAll: visibility.location.isAll, selected: new Set(visibility.location.valueIds) },
});

/** What is saved of a grant: "all", or the chosen values that no chosen ancestor already covers. */
export function stored(values: DimensionValue[], grant: Grant) {
  if (grant.isAll) return { isAll: true, valueIds: [] as string[] };
  const implied = impliedBySelection(values, grant.selected);
  return { isAll: false, valueIds: [...grant.selected].filter((id) => !implied.has(id)).sort() };
}

/** What a saved grant covers of `values`: all of them, or the chosen ones with everything beneath. */
export function coveredBy(values: DimensionValue[], grant: Grant): Set<string> {
  if (grant.isAll) return new Set(values.map((v) => v.id));
  return new Set([...grant.selected, ...impliedBySelection(values, grant.selected)]);
}

const icons: Record<DimensionKind, IconName> = { trade: "category", location: "map-pin" };

/**
 * A Project Member's Visibility (gap rows 26 to 33): two cards, Trades and Locations, each with
 * "All of your Company's …" and the values the Company covers (a Member never covers more, V4).
 * Saved whole from the Save bar; Cancel puts the saved Visibility back. No endpoint: read-only.
 */
export function MemberVisibilityEditor({
  options,
  visibility,
  endpoint,
  memberName,
}: {
  /** What the Member's Participant covers. */
  options: DimensionValues;
  visibility: Visibility;
  endpoint: string | null;
  memberName: string;
}) {
  const t = useTranslations("visibility");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const toast = useToast();
  const handover = useHandover();
  const [saved, setSaved] = useState(() => draftOf(visibility));
  const [draft, setDraft] = useState(saved);
  const [justSaved, setJustSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const readOnly = endpoint === null;
  const dirty = dimensionKinds.some((k) => JSON.stringify(stored(options[k], draft[k])) !== JSON.stringify(stored(options[k], saved[k])));

  function change(kind: DimensionKind, grant: Grant) {
    setDraft((prev) => ({ ...prev, [kind]: grant }));
    setJustSaved(false);
  }

  async function save() {
    if (!endpoint) return;
    setPending(true);
    const errors: Record<string, string> = {
      exceeds_participant: t("exceedsParticipant"),
      forbidden: t("notAllowed"),
      project_closed: t("projectClosed"),
    };
    try {
      // The Steps it takes the Member off are handed over first (RP-108).
      await handover.run({
        action: "save",
        method: "PUT",
        url: endpoint,
        body: Object.fromEntries(dimensionKinds.map((kind) => [kind, stored(options[kind], draft[kind])])),
        done: (outcome: HandoverOutcome) => {
          if (outcome.kind === "done") {
            setSaved(draft);
            setJustSaved(true);
            toast({ title: t("savedToast", { name: memberName }), tone: "success" });
            return router.refresh();
          }
          toast({ title: outcome.kind === "refused" ? outcome.message : (errors[outcome.code ?? ""] ?? t("unavailable")), tone: "danger" });
        },
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 md:grid-cols-2">
        {dimensionKinds.map((kind) => (
          <DimensionCard
            key={kind}
            kind={kind}
            title={t(kind === "trade" ? "trades" : "locations")}
            allLabel={t(kind === "trade" ? "allOfCompanyTrades" : "allOfCompanyLocations")}
            caption={t("memberCaption")}
            emptyText={t("noValues")}
            values={pickable(options[kind], coveredBy(options[kind], saved[kind]))}
            grant={draft[kind]}
            readOnly={readOnly}
            locale={locale}
            onChange={(grant) => change(kind, grant)}
          />
        ))}
      </div>
      {/* On a phone, the shell's bottom action bar (RP-1276, row 64). */}
      {!readOnly && (
        <SaveBar
          status={dirty ? t("unsaved") : justSaved ? t("saved") : t("noChanges")}
          dirty={dirty}
          busy={pending || handover.pending}
          cancelLabel={t("cancel")}
          saveLabel={t("save")}
          onCancel={() => setDraft(saved)}
          onSave={() => void save()}
        />
      )}
      {handover.dialog}
    </div>
  );
}

export function DimensionCard({
  kind,
  title,
  allLabel,
  caption,
  emptyText,
  values,
  grant,
  readOnly,
  locale,
  onChange,
  plainNames = false,
}: {
  kind: DimensionKind;
  title: string;
  allLabel: string;
  caption?: string;
  emptyText: string;
  values: DimensionValue[];
  grant: Grant;
  readOnly: boolean;
  locale: Locale;
  onChange: (grant: Grant) => void;
  /** Each value by its own name and code (the Project's settings panel), not its path. */
  plainNames?: boolean;
}) {
  const ordered = useMemo(() => treeOrder(values), [values]);
  const byId = useMemo(() => new Map(values.map((v) => [v.id, v])), [values]);
  const implied = impliedBySelection(values, grant.selected);
  const isCovered = (id: string) => grant.isAll || grant.selected.has(id) || implied.has(id);
  /** A value none of whose own box is ticked, with something ticked beneath it. */
  const isPartial = (id: string): boolean => !isCovered(id) && values.some((v) => v.parentId === id && (isCovered(v.id) || isPartial(v.id)));
  const allState = grant.isAll ? true : grant.selected.size > 0 ? "indeterminate" : false;

  function toggle(id: string) {
    if (grant.isAll) {
      // From "all" to every value but this one, its ancestors (which would cover it) and what is inside it.
      const dropped = (v: DimensionValue) => v.id === id || isAncestor(v.id, id) || isAncestor(id, v.id);
      return onChange({ isAll: false, selected: new Set(values.filter((v) => !dropped(v)).map((v) => v.id)) });
    }
    const selected = new Set(grant.selected);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    onChange({ isAll: false, selected });
  }
  /** Whether `ancestor` is above `id` in the tree. */
  function isAncestor(ancestor: string, id: string): boolean {
    for (let p = byId.get(id)?.parentId ?? null; p !== null; p = byId.get(p)?.parentId ?? null) if (p === ancestor) return true;
    return false;
  }

  return (
    <fieldset className="min-w-0 rounded-lg border border-border bg-surface p-4" data-testid={`visibility-${kind}`}>
      <legend className="sr-only">{title}</legend>
      <p className="mb-3 flex items-center gap-2 font-display text-h6 font-semibold text-text" aria-hidden>
        <Icon name={icons[kind]} size={18} className="text-muted" />
        {title}
      </p>
      <Field label={<span className="font-semibold">{allLabel}</span>} layout="inline" readOnly={readOnly}>
        <Checkbox checked={allState} onCheckedChange={() => onChange({ isAll: !grant.isAll, selected: new Set() })} />
      </Field>
      {values.length === 0 ? (
        <p className="mt-3 border-t border-border pt-3 text-sm text-muted">{emptyText}</p>
      ) : (
        <ul className="mt-3 border-t border-border">
          {ordered.map((v) => {
            const top = v.level === 0;
            const locked = !readOnly && !grant.isAll && implied.has(v.id);
            return (
              <li
                key={v.id}
                className={cn(top ? "pt-3" : "pt-1.5", top && v !== ordered[0] && "mt-2 border-t border-border")}
                style={{ paddingInlineStart: `${v.level * 1.75}rem` }}
              >
                <Field
                  label={
                    <span className={top ? "font-semibold text-text" : "text-text"}>
                      {kind === "location" && !plainNames ? <PathLabel value={v} byId={byId} locale={locale} /> : v.name[locale]}
                      {plainNames && (
                        <bdi dir="ltr" className="ms-2 rounded-xs border border-border px-1.5 py-px font-mono text-xs font-semibold text-muted">
                          {v.code}
                        </bdi>
                      )}
                    </span>
                  }
                  layout="inline"
                  readOnly={readOnly}
                  disabled={locked}
                >
                  <Checkbox checked={isCovered(v.id) ? true : isPartial(v.id) ? "indeterminate" : false} onCheckedChange={() => toggle(v.id)} />
                </Field>
              </li>
            );
          })}
        </ul>
      )}
      {caption && <p className="mt-3 rounded-md bg-hover px-3 py-2 text-xs text-muted">{caption}</p>}
    </fieldset>
  );
}
