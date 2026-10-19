"use client";

import {
  checklistTemplateRequest,
  evidenceRules,
  formatNumber,
  maxChecklistItems,
  negativeActions,
  type BilingualText,
  type ChecklistTemplate,
  type ChecklistTemplateItem,
  type EvidenceRule,
  type Locale,
} from "@rabaed/domain";
import {
  Badge,
  Button,
  ChecklistTemplateItems,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTrigger,
  Field,
  Icon,
  IconButton,
  Input,
  Select,
  SettingsSection,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { checklistTemplateLabels } from "@/lib/form-labels";
import { createdId, refusalMessage, setupCall } from "@/lib/setup-call";

export type TemplateTrade = { id: string; code: string; name: BilingualText };

/** What a refused command says, in the page's words. */
function useRefusal() {
  const t = useTranslations("projectSettings.checklistTemplates");
  return (error: string) => refusalMessage(t, { trade_not_found: "tradeNotFound", template_retired: "retired", invalid_body: "invalid" }, error);
}

/**
 * Project → Settings → Checklist Templates (RP-651): one card per Trade, each a table of its
 * templates with their checks, Version and status, active ones first. Every Project Member
 * reads them; a Project Admin opens one to edit it, and adds one with the header's "New
 * template". Who wrote one, and when, is never shown: the API doesn't carry it.
 */
export function ChecklistTemplateList({
  projectId,
  canEdit,
  trades,
  templates,
}: {
  projectId: string;
  canEdit: boolean;
  trades: TemplateTrade[];
  templates: ChecklistTemplate[];
}) {
  const t = useTranslations("projectSettings.checklistTemplates");
  const locale = useLocale() as Locale;
  return (
    <>
      {trades.length === 0 && <p className="text-sm text-muted">{t("noTrades")}</p>}
      {trades.map((trade) => {
        // Active first, each group in the API's order (by name).
        const listed = templates.filter((x) => x.tradeId === trade.id).sort((a, b) => Number(a.status === "retired") - Number(b.status === "retired"));
        const active = listed.filter((x) => x.status === "active").length;
        const title = trade.name[locale];
        return (
          <SettingsSection
            key={trade.id}
            title={
              <>
                {title}{" "}
                <bdi dir="ltr" translate="no" className="text-caption font-normal text-muted">
                  {trade.code}
                </bdi>
              </>
            }
            actions={<span className="text-caption text-muted">{t("activeCount", { count: active, n: formatNumber(active, locale) })}</span>}
            bodyClassName="px-5 pt-3 pb-5"
            data-testid={`templates-${trade.code}`}
          >
            {listed.length === 0 ? (
              <p className="text-sm text-muted">{t("noTemplates")}</p>
            ) : (
              <Table label={t("tableLabel", { trade: title })} className="min-w-[36rem] table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("name")}</TableHead>
                    <TableHead className="w-[7rem]">{t("checks")}</TableHead>
                    <TableHead className="w-[7rem]">{t("version")}</TableHead>
                    <TableHead className="w-[8rem]">{t("status")}</TableHead>
                    <TableHead align="end" className="w-[7rem]">
                      <span className="sr-only">{t("open")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listed.map((x) => (
                    <TableRow key={x.id} data-testid="template-row">
                      <TableCell className={`truncate ${x.status === "retired" ? "text-muted" : "font-semibold"}`}>{x.name[locale]}</TableCell>
                      <TableCell className="text-text-secondary">{formatNumber(x.items.length, locale)}</TableCell>
                      <TableCell className="text-text-secondary">{t("versionNo", { n: formatNumber(x.versionNo, locale) })}</TableCell>
                      <TableCell>
                        <Badge tone={x.status === "active" ? "success" : "neutral"}>{t(`statuses.${x.status}`)}</Badge>
                      </TableCell>
                      <TableCell align="end">
                        <Link
                          href={`/projects/${projectId}/settings/checklist-templates/${x.id}`}
                          className="text-sm font-semibold text-brand-fg hover:underline"
                          aria-label={t(canEdit && x.status === "active" ? "editNamed" : "viewNamed", { name: x.name[locale] })}
                        >
                          {t(canEdit && x.status === "active" ? "edit" : "view")}
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SettingsSection>
        );
      })}
    </>
  );
}

/** The first key `item_n` the items don't use. */
export function nextItemKey(items: readonly { key: string }[]): string {
  let n = items.length + 1;
  while (items.some((i) => i.key === `item_${n}`)) n += 1;
  return `item_${n}`;
}

const newItem = (items: readonly ChecklistTemplateItem[]): ChecklistTemplateItem => ({
  key: nextItemKey(items),
  text: { en: "", ar: "" },
  answers: "pass_fail_na",
  comment: "optional",
  photo: "off",
  on_negative: "create_snag",
});

/**
 * One template, to create (`template` null) or edit into its next Version: its names, Trade
 * and checks, each with its answers, comment and photo rules and whether a negative answer
 * raises a Snag; beside them, the checks as a WIR shows them. Read only for anyone but a
 * Project Admin, and for a retired template.
 */
export function ChecklistTemplateEditor({
  projectId,
  template,
  canEdit,
  trades,
}: {
  projectId: string;
  template: ChecklistTemplate | null;
  canEdit: boolean;
  trades: TemplateTrade[];
}) {
  const t = useTranslations("projectSettings.checklistTemplates");
  // The preview speaks the WIR's own words for its checks.
  const previewLabels = checklistTemplateLabels(useTranslations("workItems.form"));
  const locale = useLocale() as Locale;
  const router = useRouter();
  const toast = useToast();
  const refusal = useRefusal();
  const editable = canEdit && template?.status !== "retired";
  const [name, setName] = useState<BilingualText>(template?.name ?? { en: "", ar: "" });
  const [tradeId, setTradeId] = useState(template?.tradeId ?? trades[0]?.id ?? "");
  const [items, setItems] = useState<ChecklistTemplateItem[]>(() => (template ? template.items : [newItem([])]));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = { name, tradeId, items };
  const valid = checklistTemplateRequest.safeParse(request).success;
  const setItem = (index: number, change: Partial<ChecklistTemplateItem>) => setItems(items.map((item, i) => (i === index ? { ...item, ...change } : item)));
  const move = (index: number, delta: -1 | 1) => {
    const next = [...items];
    [next[index], next[index + delta]] = [next[index + delta]!, next[index]!];
    setItems(next);
  };

  async function save() {
    setBusy(true);
    setError(null);
    const res = template ? await setupCall("PUT", `/checklist-templates/${template.id}`, request) : await setupCall("POST", `/projects/${projectId}/checklist-templates`, request);
    setBusy(false);
    if (!res.ok) {
      setError(refusal(res.error));
      return;
    }
    toast({ title: template ? t("saved", { n: formatNumber(template.versionNo + 1, locale) }) : t("created"), tone: "success" });
    const id = template?.id ?? createdId(res);
    if (id && !template) router.push(`/projects/${projectId}/settings/checklist-templates/${id}`);
    else router.refresh();
  }

  const evidence = (value: EvidenceRule) => ({ value, label: t(`evidence.${value}`) });
  return (
    <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <div className="flex min-w-0 flex-col gap-6">
        <SettingsSection title={t("detailsTitle")} description={editable ? t("detailsIntro") : undefined} data-testid="template-details">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("nameEn")} required>
              <Input value={name.en} dir="ltr" maxLength={200} readOnly={!editable} onChange={(e) => setName({ ...name, en: e.target.value })} />
            </Field>
            <Field label={t("nameAr")} required>
              <Input value={name.ar} dir="rtl" maxLength={200} readOnly={!editable} onChange={(e) => setName({ ...name, ar: e.target.value })} />
            </Field>
            <Field label={t("trade")} required help={t("tradeHelp")}>
              <Select
                value={tradeId}
                disabled={!editable}
                onValueChange={setTradeId}
                options={trades.map((trade) => ({ value: trade.id, label: trade.name[locale] }))}
              />
            </Field>
          </div>
        </SettingsSection>

        <SettingsSection
          title={t("checksTitle", { n: formatNumber(items.length, locale), count: items.length })}
          description={editable ? t("checksIntro") : undefined}
          data-testid="template-checks"
        >
          <ol className="flex flex-col gap-3">
            {items.map((item, i) => {
              const n = formatNumber(i + 1, locale);
              return (
                <li key={item.key} className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4" data-testid="template-check">
                  <div className="flex items-center gap-2">
                    <Badge tone="neutral">{t("checkNo", { n })}</Badge>
                    {editable && (
                      <span className="ms-auto flex items-center gap-0.5">
                        <IconButton label={t("moveUp", { n })} size="sm" disabled={i === 0} onClick={() => move(i, -1)}>
                          <Icon name="arrow-up" size={16} />
                        </IconButton>
                        <IconButton label={t("moveDown", { n })} size="sm" disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                          <Icon name="arrow-down" size={16} />
                        </IconButton>
                        <IconButton label={t("removeCheck", { n })} size="sm" disabled={items.length === 1} onClick={() => setItems(items.filter((_, j) => j !== i))}>
                          <Icon name="trash" size={16} />
                        </IconButton>
                      </span>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t("checkEn")} required>
                      <Input value={item.text.en} dir="ltr" maxLength={200} readOnly={!editable} onChange={(e) => setItem(i, { text: { ...item.text, en: e.target.value } })} />
                    </Field>
                    <Field label={t("checkAr")} required>
                      <Input value={item.text.ar} dir="rtl" maxLength={200} readOnly={!editable} onChange={(e) => setItem(i, { text: { ...item.text, ar: e.target.value } })} />
                    </Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t("answers")}>
                      <Select
                        value={item.answers}
                        disabled={!editable}
                        onValueChange={(answers) => setItem(i, { answers: answers === "yes_no_na" ? "yes_no_na" : "pass_fail_na" })}
                        options={[
                          { value: "pass_fail_na", label: t("passFail") },
                          { value: "yes_no_na", label: t("yesNo") },
                        ]}
                      />
                    </Field>
                    <Field label={t("comment")}>
                      <Select
                        value={item.comment}
                        disabled={!editable}
                        onValueChange={(comment) => setItem(i, { comment: comment as EvidenceRule })}
                        options={evidenceRules.map(evidence)}
                      />
                    </Field>
                    <Field label={t("photo")}>
                      <Select
                        value={item.photo}
                        disabled={!editable}
                        onValueChange={(photo) => setItem(i, { photo: photo as EvidenceRule })}
                        options={evidenceRules.map(evidence)}
                      />
                    </Field>
                    <Field label={t("onNegative")}>
                      <Select
                        value={item.on_negative}
                        disabled={!editable}
                        onValueChange={(v) => setItem(i, { on_negative: v === "none" ? "none" : "create_snag" })}
                        options={negativeActions.map((value) => ({ value, label: t(`negative.${value}`) }))}
                      />
                    </Field>
                  </div>
                </li>
              );
            })}
          </ol>
          {editable && (
            <Button variant="secondary" size="sm" className="w-fit" disabled={items.length >= maxChecklistItems} onClick={() => setItems([...items, newItem(items)])}>
              <Icon name="plus" size={15} />
              {t("addCheck")}
            </Button>
          )}
        </SettingsSection>

        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-tint px-3 py-2 text-sm text-danger-fg">
            <Icon name="alert-circle" size={16} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}
        {editable && (
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={busy || !valid} onClick={() => void save()}>
              {template ? t("saveVersion", { n: formatNumber(template.versionNo + 1, locale) }) : t("create")}
            </Button>
            {!valid && <span className="text-sm text-muted">{t("incomplete")}</span>}
            {template && template.status === "active" && <Retire template={template} />}
          </div>
        )}
      </div>

      <SettingsSection title={t("previewTitle")} description={t("previewIntro")} data-testid="template-preview">
        <ChecklistTemplateItems items={items.map((item, i) => ({ ...item, text: item.text.en || item.text.ar ? item.text : { en: t("checkNo", { n: formatNumber(i + 1, "en") }), ar: t("checkNo", { n: formatNumber(i + 1, "ar") }) } }))} locale={locale} labels={previewLabels} />
      </SettingsSection>
    </div>
  );
}

/** "Retire", confirmed in a dialog: offered to no new pick; the WIRs that copied it keep their checks. */
function Retire({ template }: { template: ChecklistTemplate }) {
  const t = useTranslations("projectSettings.checklistTemplates");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const toast = useToast();
  const refusal = useRefusal();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = template.name[locale];
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost">{t("retire")}</Button>
      </DialogTrigger>
      <DialogContent title={t("retireTitle", { name })} description={t("retireHelp")} closeLabel={t("close")}>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t("cancel")}</Button>
          </DialogClose>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await setupCall("POST", `/checklist-templates/${template.id}/retire`);
              setBusy(false);
              setOpen(false);
              if (res.ok) {
                toast({ title: t("retired"), tone: "success" });
                router.refresh();
              } else toast({ title: refusal(res.error), tone: "danger" });
            }}
          >
            {t("retireSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
