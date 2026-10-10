"use client";

import type { DimensionKind, DimensionValue, DimensionValues, HandoverPick, Locale, Visibility } from "@rabaed/domain";
import { dimensionKinds } from "@rabaed/domain";
import { Button, Checkbox, Field } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useHandover, type HandoverOutcome } from "@/components/handover";
import { useRouter } from "@/i18n/navigation";
import { impliedBySelection, treeOrder } from "@/lib/dimension-tree";

type Draft = Record<DimensionKind, { isAll: boolean; selected: Set<string> }>;

const draftOf = (visibility: Visibility): Draft => ({
  trade: { isAll: visibility.trade.isAll, selected: new Set(visibility.trade.valueIds) },
  location: { isAll: visibility.location.isAll, selected: new Set(visibility.location.valueIds) },
});

/**
 * Visibility in each dimension: "all", or chosen Trades and Locations. A chosen
 * Location covers everything inside it, shown ticked and locked. Saved whole to
 * `endpoint`, every dimension at once; no endpoint means read-only.
 */
export function VisibilityEditor({
  options,
  visibility,
  endpoint,
  allLabel,
  handoverName,
}: {
  /** What can be chosen: the Project's values, or (for a Member) what their Participant covers. */
  options: DimensionValues;
  visibility: Visibility;
  endpoint: string | null;
  allLabel: Record<DimensionKind, string>;
  /** A Project Member's Visibility: their name, for the Handover of the Steps a save takes them off (RP-108). */
  handoverName?: string;
}) {
  const t = useTranslations("visibility");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const handover = useHandover();
  const [draft, setDraft] = useState(() => draftOf(visibility));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "saved" | "error"; text: string } | null>(null);
  const readOnly = endpoint === null;

  function update(kind: DimensionKind, change: (d: Draft[DimensionKind]) => Draft[DimensionKind]) {
    setDraft((prev) => ({ ...prev, [kind]: change(prev[kind]) }));
    setMessage(null);
  }

  function toggle(kind: DimensionKind, id: string) {
    update(kind, (d) => {
      const selected = new Set(d.selected);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      return { ...d, selected };
    });
  }

  async function save() {
    if (!endpoint) return;
    setPending(true);
    setMessage(null);
    try {
      const grantOf = (kind: DimensionKind) => {
        const { isAll, selected } = draft[kind];
        // Values inside a chosen Location are covered through it; store only the chosen ones.
        const implied = impliedBySelection(options[kind], selected);
        return { isAll, valueIds: isAll ? [] : [...selected].filter((id) => !implied.has(id)) };
      };
      const body = Object.fromEntries(dimensionKinds.map((kind) => [kind, grantOf(kind)]));
      const put = (handovers?: HandoverPick[]) =>
        fetch(endpoint, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(handovers ? { ...body, handovers } : body),
        });
      const errors: Record<string, string> = {
        exceeds_participant: t("exceedsParticipant"),
        forbidden: t("notAllowed"),
        project_closed: t("projectClosed"),
      };
      const done = (outcome: HandoverOutcome) => {
        if (outcome.ok) {
          setMessage({ kind: "saved", text: t("saved") });
          return router.refresh();
        }
        setMessage({ kind: "error", text: "message" in outcome ? outcome.message : (errors[outcome.code ?? ""] ?? t("unavailable")) });
      };
      // A Member's Visibility: the Steps it takes them off are handed over first (RP-108).
      if (handoverName) return await handover.run({ name: handoverName, change: "save", send: put, done });
      const res = await put();
      const { error } = res.ok ? { error: undefined } : ((await res.json().catch(() => ({}))) as { error?: string });
      done(res.ok ? { ok: true } : { ok: false, code: error ?? null });
    } catch {
      setMessage({ kind: "error", text: t("unavailable") });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-6 md:grid-cols-2">
        {dimensionKinds.map((kind) => (
          <DimensionFieldset
            key={kind}
            kind={kind}
            legend={t(kind === "trade" ? "trades" : "locations")}
            allLabel={allLabel[kind]}
            values={options[kind]}
            draft={draft[kind]}
            readOnly={readOnly}
            locale={locale}
            emptyText={t("noValues")}
            onAll={(isAll) => update(kind, (d) => ({ ...d, isAll }))}
            onToggle={(id) => toggle(kind, id)}
          />
        ))}
      </div>
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-4">
          <Button onClick={() => void save()} disabled={pending || handover.pending}>
            {t("save")}
          </Button>
          {message && (
            <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-sm text-danger" : "text-sm text-muted"}>
              {message.text}
            </p>
          )}
        </div>
      )}
      {handover.dialog}
    </div>
  );
}

function DimensionFieldset({
  kind,
  legend,
  allLabel,
  values,
  draft,
  readOnly,
  locale,
  emptyText,
  onAll,
  onToggle,
}: {
  kind: DimensionKind;
  legend: string;
  allLabel: string;
  values: DimensionValue[];
  draft: Draft[DimensionKind];
  readOnly: boolean;
  locale: Locale;
  emptyText: string;
  onAll: (isAll: boolean) => void;
  onToggle: (id: string) => void;
}) {
  const implied = impliedBySelection(values, draft.selected);
  return (
    <fieldset className="space-y-2 rounded-md border border-border p-4" data-testid={`visibility-${kind}`}>
      <legend className="px-1 font-medium">{legend}</legend>
      <Field label={allLabel} layout="inline" readOnly={readOnly}>
        <Checkbox checked={draft.isAll} onCheckedChange={(checked) => onAll(checked === true)} />
      </Field>
      {values.length === 0 ? (
        <p className="text-sm text-muted">{emptyText}</p>
      ) : (
        <ul className="space-y-1">
          {treeOrder(values).map((v) => {
            const covered = draft.isAll || implied.has(v.id);
            return (
              <li key={v.id} style={{ paddingInlineStart: `${v.level * 1.5}rem` }}>
                <Field
                  label={
                    <>
                      {v.name[locale]}{" "}
                      <bdi dir="ltr" className="text-sm text-muted">
                        {v.code}
                      </bdi>
                      {v.levelName && <span className="text-sm text-muted"> · {v.levelName[locale]}</span>}
                    </>
                  }
                  layout="inline"
                  readOnly={readOnly}
                  disabled={!readOnly && covered}
                >
                  <Checkbox checked={covered || draft.selected.has(v.id)} onCheckedChange={() => onToggle(v.id)} />
                </Field>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
