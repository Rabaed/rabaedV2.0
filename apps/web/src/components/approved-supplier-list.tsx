"use client";

import { formatNumber, type ApprovedSupplier, type BilingualText, type Locale, type Scope } from "@rabaed/domain";
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTrigger,
  Field,
  Icon,
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
import { useRouter } from "@/i18n/navigation";
import { refusalMessage, setupCall } from "@/lib/setup-call";

// A choice can't have an empty value, so "no Scope" has its own.
const NO_SCOPE = "none";

export type SupplierTrade = { id: string; code: string; name: BilingualText };

type ScopeChoice = Scope & { level: number };

/** What a refused command says, in the page's words. */
function useRefusal() {
  const t = useTranslations("projectSettings.approvedSuppliers");
  return (error: string) =>
    refusalMessage(t, { trade_not_found: "tradeNotFound", scope_not_found: "scopeNotFound", supplier_exists: "exists" }, error);
}

/**
 * Project → Settings → Approved Supplier List (RP-592, V10): one card per Trade, each a
 * table of its suppliers with their Scope and approval, approved ones first. Every Project
 * Member reads it; a Project Admin withdraws one (it stays listed, withdrawn) and adds one
 * with `AddSupplierButton` in the page header. What put a supplier there is never shown:
 * the API doesn't carry it.
 */
export function ApprovedSupplierList({
  canEdit,
  trades,
  scopes,
  suppliers,
}: {
  canEdit: boolean;
  trades: SupplierTrade[];
  /** The Project's Scopes and Sub-scopes in tree order, with their level. */
  scopes: ScopeChoice[];
  suppliers: ApprovedSupplier[];
}) {
  const t = useTranslations("projectSettings.approvedSuppliers");
  const locale = useLocale() as Locale;
  const scopeName = new Map(scopes.map((s) => [s.id, s.name[locale]]));

  return (
    <>
      {trades.length === 0 && <p className="text-sm text-muted">{t("noTrades")}</p>}
      {trades.map((trade) => {
        // Approved first, each group in the API's order (by name).
        const listed = [...suppliers.filter((s) => s.tradeId === trade.id)].sort((a, b) => Number(a.status === "withdrawn") - Number(b.status === "withdrawn"));
        const approved = listed.filter((s) => s.status === "approved").length;
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
            actions={<span className="text-caption text-muted">{t("approvedCount", { count: approved, n: formatNumber(approved, locale) })}</span>}
            bodyClassName="px-5 pt-3 pb-5"
            data-testid={`suppliers-${trade.code}`}
          >
            {listed.length === 0 ? (
              <p className="text-sm text-muted">{t("noSuppliers")}</p>
            ) : (
              // The same column widths in every Trade's table, so the cards line up.
              <Table label={t("tableLabel", { trade: title })} className="min-w-[36rem] table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("supplier")}</TableHead>
                    <TableHead className="w-[28%]">{t("scope")}</TableHead>
                    <TableHead className="w-[9rem]">{t("approval")}</TableHead>
                    {canEdit && (
                      <TableHead align="end" className="w-[8rem]">
                        <span className="sr-only">{t("withdraw")}</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listed.map((s) => (
                    <TableRow key={s.id} data-testid="supplier-row">
                      <TableCell className={`truncate ${s.status === "withdrawn" ? "text-muted" : "font-semibold"}`}>{s.name[locale]}</TableCell>
                      <TableCell className="truncate text-text-secondary">{s.scopeId ? (scopeName.get(s.scopeId) ?? "") : t("allScopes")}</TableCell>
                      <TableCell>
                        <Badge tone={s.status === "approved" ? "success" : "neutral"}>{t(`statuses.${s.status}`)}</Badge>
                      </TableCell>
                      {canEdit && (
                        <TableCell align="end">
                          {s.status === "approved" && (
                            <Withdraw supplier={s} />
                          )}
                        </TableCell>
                      )}
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

/** "Withdraw", confirmed in a dialog: the supplier stays on the items that chose it, and can't be chosen again. */
function Withdraw({ supplier }: { supplier: ApprovedSupplier }) {
  const t = useTranslations("projectSettings.approvedSuppliers");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const toast = useToast();
  const refusal = useRefusal();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = supplier.name[locale];
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t("withdrawNamed", { supplier: name })}>
          {t("withdraw")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("withdrawTitle", { supplier: name })} description={t("withdrawHelp")} closeLabel={t("close")}>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t("cancel")}</Button>
          </DialogClose>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await setupCall("POST", `/approved-suppliers/${supplier.id}/withdraw`);
              setBusy(false);
              setOpen(false);
              if (res.ok) {
                toast({ title: t("withdrawn"), tone: "success" });
                router.refresh();
              } else toast({ title: refusal(res.error), tone: "danger" });
            }}
          >
            {t("withdrawSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Add supplier", for a Project Admin, in the page header: its names in English and Arabic,
 * its Trade and, optionally, one of that Trade's active Scopes or Sub-scopes.
 */
export function AddSupplierButton({ projectId, trades, scopes }: { projectId: string; trades: SupplierTrade[]; scopes: ScopeChoice[] }) {
  const t = useTranslations("projectSettings.approvedSuppliers");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const toast = useToast();
  const refusal = useRefusal();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState<BilingualText>({ en: "", ar: "" });
  const [tradeId, setTradeId] = useState(trades[0]?.id ?? "");
  const [scopeId, setScopeId] = useState(NO_SCOPE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const offered = scopes.filter((s) => s.tradeId === tradeId && s.active);
  const valid = name.en.trim() !== "" && name.ar.trim() !== "" && tradeId !== "";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" disabled={trades.length === 0}>
          <Icon name="plus" size={15} />
          {t("add")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("add")} description={t("addHelp")} closeLabel={t("close")}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            const res = await setupCall("POST", `/projects/${projectId}/approved-suppliers`, {
              name,
              tradeId,
              scopeId: scopeId === NO_SCOPE ? null : scopeId,
            });
            setBusy(false);
            if (res.ok) {
              setOpen(false);
              setName({ en: "", ar: "" });
              setScopeId(NO_SCOPE);
              toast({ title: t("added"), tone: "success" });
              router.refresh();
            } else setError(refusal(res.error));
          }}
        >
          <Field label={t("nameEn")} required>
            <Input value={name.en} dir="ltr" maxLength={200} onChange={(e) => setName({ ...name, en: e.target.value })} />
          </Field>
          <Field label={t("nameAr")} required>
            <Input value={name.ar} dir="rtl" maxLength={200} onChange={(e) => setName({ ...name, ar: e.target.value })} />
          </Field>
          <Field label={t("trade")} required>
            <Select
              value={tradeId}
              onValueChange={(v) => {
                setTradeId(v);
                setScopeId(NO_SCOPE);
              }}
              options={trades.map((trade) => ({ value: trade.id, label: trade.name[locale] }))}
            />
          </Field>
          <Field label={t("scope")} help={t("scopeHelp")}>
            <Select
              value={scopeId}
              onValueChange={setScopeId}
              options={[
                { value: NO_SCOPE, label: t("allScopes") },
                ...offered.map((s) => ({ value: s.id, label: `${"— ".repeat(s.level)}${s.name[locale]}` })),
              ]}
            />
          </Field>
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
              {t("addSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
