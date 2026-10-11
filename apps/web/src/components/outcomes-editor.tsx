"use client";

import { outcomeCodePattern, reservedOutcomeCodes, type BilingualText, type Locale, type Outcome, type OutcomeAction } from "@rabaed/domain";
import { Badge, Button, Checkbox, Dialog, DialogClose, DialogContent, DialogFooter, Field, Icon, IconButton, Input, SegmentedControl, Select, SettingsSection, Switch } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { setupCall } from "@/lib/setup-call";

type Props = {
  projectId: string;
  type: { code: string; name: BilingualText };
  outcomes: Outcome[];
  canEdit: boolean;
  /** The Work Item Types an outcome may create items of, by code and name. */
  typeChoices: { code: string; name: string }[];
};

type Editing = { mode: "add" } | { mode: "edit"; outcome: Outcome } | null;

/**
 * Project → Settings → Outcomes, one Work Item Type (RP-441, WF-6): its outcome set in
 * order: code, English and Arabic name, closing, positive or negative, and the follow-up
 * actions (offer a Revision, offer a replacement, create items of a Type). Every Project
 * Member reads it; Project Admins add and change outcomes on the Project's copy. A used
 * outcome keeps its code, closing and polarity (the API says why when asked to change them).
 */
export function OutcomesEditor({ projectId, type, outcomes, canEdit, typeChoices }: Props) {
  const t = useTranslations("projectSettings.outcomes");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [editing, setEditing] = useState<Editing>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const path = `/projects/${projectId}/work-item-types/${encodeURIComponent(type.code)}/outcomes`;

  const refusal = (error: string) =>
    ({
      not_found: t("errors.notFound"),
      project_closed: t("errors.projectClosed"),
      invalid_outcome: t("errors.invalid"),
      outcome_exists: t("errors.exists"),
      invalid_order: t("errors.invalidOrder"),
      outcome_in_use: t("errors.inUse"),
    })[error] ?? t("errors.unavailable");

  async function move(index: number, delta: -1 | 1) {
    const codes = outcomes.map((o) => o.code);
    [codes[index], codes[index + delta]] = [codes[index + delta]!, codes[index]!];
    const res = await setupCall("PUT", `${path}/order`, { codes });
    if (res.ok) router.refresh();
    else setNotice({ tone: "error", text: refusal(res.error) });
  }

  const actionText = (o: Outcome) =>
    o.actions
      .map((a) => (a.kind === "create_items" ? t("actions.create_items", { type: a.type }) : t(`actions.${a.kind}`)))
      .join(" · ");

  return (
    <SettingsSection
      title={`${type.name[locale]}`}
      description={t("typeIntro", { code: type.code })}
      actions={
        canEdit ? (
          <Button variant="secondary" size="sm" onClick={() => setEditing({ mode: "add" })}>
            <Icon name="plus" size={15} />
            {t("add")}
          </Button>
        ) : undefined
      }
      bodyClassName="px-0 pt-[14px] pb-0"
      data-testid={`outcomes-${type.code}`}
    >
      {notice && (
        <p role={notice.tone === "error" ? "alert" : "status"} className={`mx-5 mb-3 flex items-center gap-2 rounded-md px-3 py-2 text-sm ${notice.tone === "error" ? "bg-danger-tint text-danger-fg" : "bg-success-tint text-success-fg"}`}>
          <Icon name={notice.tone === "error" ? "alert-circle" : "circle-check"} size={16} />
          {notice.text}
        </p>
      )}
      <ol aria-label={type.name[locale]} className="flex flex-col">
        {outcomes.map((o, index) => (
          <li key={o.code} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border-subtle px-5 py-3" data-testid="outcome-row">
            <bdi dir="ltr" translate="no" className="w-20 shrink-0 text-[13px] font-bold text-text">{o.code}</bdi>
            <span className="min-w-40 flex-1 font-semibold text-text">{o.name[locale]}</span>
            <Badge tone={o.polarity === "positive" ? "success" : "danger"}>{t(o.polarity)}</Badge>
            <Badge tone={o.closing ? "neutral" : "warning"}>{o.closing ? t("closing") : t("notClosing")}</Badge>
            <span className="min-w-32 flex-1 text-sm text-muted">{o.actions.length === 0 ? t("noActions") : actionText(o)}</span>
            {canEdit && (
              <span className="flex items-center gap-0.5">
                <IconButton label={t("edit", { outcome: o.name[locale] })} size="sm" onClick={() => setEditing({ mode: "edit", outcome: o })}>
                  <Icon name="edit" size={16} />
                </IconButton>
                <IconButton label={t("moveUp", { outcome: o.name[locale] })} size="sm" disabled={index === 0} onClick={() => void move(index, -1)}>
                  <Icon name="arrow-up" size={16} />
                </IconButton>
                <IconButton label={t("moveDown", { outcome: o.name[locale] })} size="sm" disabled={index === outcomes.length - 1} onClick={() => void move(index, 1)}>
                  <Icon name="arrow-down" size={16} />
                </IconButton>
              </span>
            )}
          </li>
        ))}
      </ol>
      {editing && (
        <OutcomeDialog
          key={editing.mode === "edit" ? editing.outcome.code : "add"}
          editing={editing}
          path={path}
          taken={outcomes.map((o) => o.code)}
          typeChoices={typeChoices}
          refusal={refusal}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            setNotice({ tone: "ok", text: t("saved") });
            router.refresh();
          }}
        />
      )}
    </SettingsSection>
  );
}

function OutcomeDialog({
  editing,
  path,
  taken,
  typeChoices,
  refusal,
  onClose,
  onDone,
}: {
  editing: NonNullable<Editing>;
  path: string;
  taken: string[];
  typeChoices: Props["typeChoices"];
  refusal: (error: string) => string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("projectSettings.outcomes");
  const start = editing.mode === "edit" ? editing.outcome : null;
  const [code, setCode] = useState(start?.code ?? "");
  const [name, setName] = useState<BilingualText>(start?.name ?? { en: "", ar: "" });
  const [closing, setClosing] = useState(start?.closing ?? true);
  const [polarity, setPolarity] = useState<"positive" | "negative">(start?.polarity ?? "positive");
  const [revision, setRevision] = useState(start?.actions.some((a) => a.kind === "offer_revision") ?? false);
  const [replacement, setReplacement] = useState(start?.actions.some((a) => a.kind === "offer_replacement") ?? false);
  const [createType, setCreateType] = useState<string>(start?.actions.find((a) => a.kind === "create_items")?.type ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const codeOk = outcomeCodePattern.test(code) && !(reservedOutcomeCodes as readonly string[]).includes(code) && (start?.code === code || !taken.includes(code));
  const valid = codeOk && name.en.trim() !== "" && name.ar.trim() !== "";
  const actions: OutcomeAction[] = [
    ...(createType ? [{ kind: "create_items" as const, type: createType }] : []),
    ...(revision ? [{ kind: "offer_revision" as const }] : []),
    ...(replacement ? [{ kind: "offer_replacement" as const }] : []),
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={start ? t("editTitle", { code: start.code }) : t("add")} description={t("dialogHelp")} closeLabel={t("close")}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            const res = start
              ? await setupCall("PATCH", `${path}/${encodeURIComponent(start.code)}`, { name, actions, code, closing, polarity })
              : await setupCall("POST", path, { code, name, closing, polarity, actions });
            setBusy(false);
            if (res.ok) onDone();
            else setError(refusal(res.error));
          }}
        >
          <Field label={t("code")} help={t("codeHelp")} required>
            <Input value={code} dir="ltr" maxLength={32} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label={t("nameEn")} required>
            <Input value={name.en} dir="ltr" maxLength={80} onChange={(e) => setName({ ...name, en: e.target.value })} />
          </Field>
          <Field label={t("nameAr")} required>
            <Input value={name.ar} dir="rtl" maxLength={80} onChange={(e) => setName({ ...name, ar: e.target.value })} />
          </Field>
          <Field label={t("closingLabel")} help={t("closingHelp")} layout="inline">
            <Switch checked={closing} onCheckedChange={setClosing} />
          </Field>
          <Field label={t("polarity")} group>
            <SegmentedControl
              value={polarity}
              onValueChange={(v) => setPolarity(v === "negative" ? "negative" : "positive")}
              options={[
                { value: "positive", label: t("positive") },
                { value: "negative", label: t("negative") },
              ]}
            />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold text-text">{t("afterClosing")}</legend>
            <Field label={t("actions.offer_revision")} layout="inline">
              <Checkbox checked={revision} onCheckedChange={(c) => setRevision(c === true)} />
            </Field>
            <Field label={t("actions.offer_replacement")} layout="inline">
              <Checkbox checked={replacement} onCheckedChange={(c) => setReplacement(c === true)} />
            </Field>
            <Field label={t("createItemsOf")} help={t("createItemsHelp")}>
              <Select
                value={createType === "" ? "none" : createType}
                onValueChange={(v) => setCreateType(v === "none" ? "" : v)}
                options={[{ value: "none", label: t("createNone") }, ...typeChoices.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))]}
              />
            </Field>
          </fieldset>
          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-tint px-3 py-2 text-sm text-danger-fg">
              <Icon name="alert-circle" size={16} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{t("cancel")}</Button>
            </DialogClose>
            <Button type="submit" disabled={busy || !valid}>
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
