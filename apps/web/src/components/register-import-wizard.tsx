"use client";

import { formatNumber, workItemListHref, type BilingualText, type Locale, type RegisterImport, type RegisterImportFields, type RegisterImportMapping, type RegisterImportRow } from "@rabaed/domain";
import {
  Button,
  Icon,
  ImportRows,
  Input,
  RegisterImportWizard as Wizard,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  buttonVariants,
  cn,
  filterImportRows,
  labelOf,
  mappedColumns,
  rejectedRowsDownload,
  saveDownload,
  valuesMatched,
  type RegisterImportClient,
  type RowsShown,
} from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { setupCall } from "@/lib/setup-call";

// The Submittals Module's "Import register" (RP-637): the import wizard from @rabaed/ui, shared
// with Rabaed Admin (RP-645), with the customer api's calls, the app's messages and its links.

/** A read through the web's /api proxy, answered as the wizard's calls are. */
async function getCall(path: string): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/v1${path}`);
    const parsed: unknown = await res.json().catch(() => null);
    if (res.ok) return { ok: true, body: parsed };
    const error = typeof parsed === "object" && parsed !== null && "error" in parsed && typeof parsed.error === "string" ? parsed.error : "unavailable";
    return { ok: false, error };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

const draftLink = (workItemId: string, children: ReactNode) => (
  <Link href={`/work-items/${workItemId}`} className="inline-flex items-center gap-1 font-semibold text-brand-fg underline-offset-4 hover:underline">
    {children}
  </Link>
);

export function RegisterImportWizard({
  projectId,
  locale,
  types,
  trades,
  fields,
  me,
  initialPreview = null,
  initialMapping = null,
}: {
  projectId: string;
  /** A saved mapping to apply once the register is read ("Use in new import", RP-1144). */
  initialMapping?: string | null;
  locale: Locale;
  /** The importer: the raiser of every row nobody else is assigned. */
  me: { id: string; name: BilingualText };
  types: { code: string; name: BilingualText }[];
  trades: { id: string; code: string; name: BilingualText }[];
  fields: RegisterImportFields;
  initialPreview?: RegisterImport | null;
}) {
  const t = useTranslations("registerImport");
  const client: RegisterImportClient = {
    read: (body) => setupCall("POST", `/projects/${projectId}/register-imports/read`, body),
    values: (body) => setupCall("POST", `/projects/${projectId}/register-imports/values`, body),
    preview: (body) => setupCall("POST", `/projects/${projectId}/register-imports`, body),
    confirm: (importId) => setupCall("POST", `/register-imports/${importId}/confirm`, {}),
    // RP-644: the import as it reads after confirm, and the Company's saved mappings.
    get: (importId) => getCall(`/register-imports/${importId}`),
    saveMapping: (body) => setupCall("POST", `/projects/${projectId}/register-import-mappings`, body),
    renameMapping: (mappingId, name) => setupCall("PUT", `/register-import-mappings/${mappingId}`, { name }),
    deleteMapping: (mappingId) => setupCall("DELETE", `/register-import-mappings/${mappingId}`),
  };
  return (
    <Wizard
      locale={locale}
      t={(key, values) => t(key, values)}
      client={client}
      importer={me}
      types={types}
      trades={trades}
      fields={fields}
      initialPreview={initialPreview}
      // A reload reopens this preview at Validate.
      onPreviewed={(id) => window.history.replaceState(null, "", `?preview=${id}`)}
      draftLink={draftLink}
      // RP-1144: the Result step's Packages open their page.
      packageLink={(packageId, children) => (
        <Link href={`/packages/${packageId}`} className="text-brand-fg underline-offset-4 hover:underline">
          {children}
        </Link>
      )}
      initialMapping={initialMapping}
      // A Member tries the wizard with a made-up register (RP-954).
      sample
      // "Open the Drafts" (RP-954): the Submittals List of this import's Drafts that the Member sees
      // (the import read again after confirm gives each Draft only to a reader who sees it; if that
      // read failed, the count confirm gave). The link names the import by its id only: no time.
      resultActions={(preview, created) => {
        const seen = preview.status === "created" ? preview.rows.filter((r) => r.workItemId !== null).length : created;
        return (
          <>
            {seen > 0 && (
              <Link href={workItemListHref(projectId, { importId: preview.id })} className={buttonVariants()}>
                <Icon name="list" />
                {t("result.open", { count: seen, n: formatNumber(seen, locale) })}
              </Link>
            )}
            {/* RP-1144: the import's own page (the app only, never Rabaed Admin). */}
            <Link href={`/projects/${projectId}/work-items/imports/${preview.id}`} className={buttonVariants({ variant: "secondary" })}>
              <Icon name="history" />
              {t("review.viewImport")}
            </Link>
          </>
        );
      }}
    />
  );
}

/**
 * An import's downloads, on its page (RP-644, stories 17 and 34): its original register as
 * uploaded (a Member's import keeps it), and its rejected rows, built here in the reader's
 * language. Neither says when the import ran.
 */
export function RegisterImportDownloads({ record, locale }: { record: RegisterImport; locale: Locale }) {
  const t = useTranslations("registerImport");
  const [failed, setFailed] = useState(false);
  async function original() {
    setFailed(false);
    try {
      const res = await fetch(`/api/v1/register-imports/${record.id}/original`);
      if (!res.ok) throw new Error(String(res.status));
      saveDownload(record.fileName, await res.blob());
    } catch {
      setFailed(true);
    }
  }
  function rejected() {
    const made = rejectedRowsDownload(record, (key, values) => t(key, values), locale);
    saveDownload(made.fileName, made.bytes);
  }
  if (!record.original && record.rowsRejected === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {record.original && (
        <Button variant="secondary" size="sm" onClick={() => void original()}>
          <Icon name="download" />
          {t("downloads.original")}
        </Button>
      )}
      {record.rowsRejected > 0 && (
        <Button variant="secondary" size="sm" onClick={rejected}>
          <Icon name="file-download" />
          {t("result.downloadRejected", { n: formatNumber(record.rowsRejected, locale) })}
        </Button>
      )}
      {failed && (
        <p role="status" className="text-[13px] text-danger-fg">
          {t("downloads.failed")}
        </p>
      )}
    </div>
  );
}

/** An import's rows with their results, on its page (RP-637): each created Draft linked where the reader sees it. */
export function RegisterImportRows({
  rows,
  label,
  locale,
  mapping,
  importer,
}: {
  rows: RegisterImportRow[];
  label: string;
  locale: Locale;
  mapping: RegisterImportMapping;
  importer: BilingualText;
}) {
  const t = useTranslations("registerImport");
  return <ImportRows rows={rows} label={label} locale={locale} mapping={mapping} importer={importer} t={(key, values) => t(key, values)} results draftLink={draftLink} />;
}

/**
 * One import's page below its counts (RP-1144; the kit's import-register.html › One import):
 * its Rows, shown all, created or rejected and found by Subject or row number, and the Mapping
 * used: each column and the field it filled, the values matched, and who raised the rows and
 * where they went. An unseen Draft stays "created" without its id (visibility.md).
 */
export function RegisterImportBody({ record, locale }: { record: RegisterImport; locale: Locale }) {
  const t = useTranslations("registerImport");
  const [shown, setShown] = useState<RowsShown>("all");
  const [query, setQuery] = useState("");
  const n = (value: number) => formatNumber(value, locale);
  const rows = filterImportRows(record.rows, shown, query);
  const total = filterImportRows(record.rows, shown, "").length;
  const counts: Record<RowsShown, number> = {
    all: record.rows.length,
    created: record.rows.filter((r) => r.created).length,
    rejected: record.rows.filter((r) => r.reasons.length > 0).length,
  };
  const fieldLabel = (field: string) => {
    if (!field.startsWith("field:")) return t(`fields.${field}`);
    const key = field.slice("field:".length);
    const label = record.mapping.fields?.find((f) => f.key === key)?.label?.[locale] ?? key;
    return t("detail.formField", { label });
  };
  const byColumn = new Map(mappedColumns(record.mapping).map((c) => [c.column, c.field]));
  const fixedTrade = (id: string) => record.rows.find((r) => r.trade.match?.id === id)?.trade.match?.name[locale] ?? "—";
  const packageColumn = record.mapping.package ? (record.headers[record.mapping.package.column] ?? "—") : null;
  const rules = record.mapping.assign?.rules?.length ?? 0;

  return (
    <Tabs defaultValue="rows">
      <TabsList aria-label={t("detail.rows")}>
        <TabsTrigger value="rows" count={n(record.rows.length)}>
          {t("review.tabRows")}
        </TabsTrigger>
        <TabsTrigger value="mapping">{t("review.tabMapping")}</TabsTrigger>
      </TabsList>
      <TabsContent value="rows" className="flex flex-col gap-3 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label={t("review.tabRows")} className="flex flex-wrap gap-1.5">
            {(["all", "created", "rejected"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={shown === s}
                onClick={() => setShown(s)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-semibold",
                  shown === s ? "border-brand bg-brand-tint text-brand-fg" : "border-border bg-surface text-text-secondary hover:bg-hover",
                )}
              >
                {t(s === "all" ? "review.showAll" : s === "created" ? "review.showCreated" : "review.showRejected")}
                <span className="tabular-nums">{n(counts[s])}</span>
              </button>
            ))}
          </div>
          <label className="flex min-w-56 flex-1 items-center gap-2 sm:max-w-80">
            <Icon name="search" size={16} className="text-muted" />
            <Input aria-label={t("review.search")} placeholder={t("review.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <span className="ms-auto text-[13px] text-muted">{t("review.showing", { shown: n(rows.length), total: n(total) })}</span>
        </div>
        <div className="overflow-x-auto rounded-md border border-border bg-surface">
          <RegisterImportRows rows={rows} label={t("detail.rows")} locale={locale} mapping={record.mapping} importer={record.defaultRaiser.name} />
        </div>
      </TabsContent>
      <TabsContent value="mapping" className="pt-4">
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="overflow-x-auto rounded-md border border-border bg-surface">
            <table className="w-full text-[14px]">
              <caption className="sr-only">{t("review.tabMapping")}</caption>
              <thead>
                <tr className="border-b border-border text-[12.5px] font-bold text-text-secondary">
                  <th scope="col" className="px-4 py-3 text-start">
                    {t("review.column")}
                  </th>
                  <th scope="col" className="w-8" />
                  <th scope="col" className="px-4 py-3 text-start">
                    {t("review.field")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {record.headers.map((header, column) => {
                  const field = byColumn.get(column);
                  return (
                    <tr key={column} className="border-b border-border-subtle last:border-0">
                      <th scope="row" className="px-4 py-2.5 text-start font-semibold">
                        <bdi>{header || "—"}</bdi>
                      </th>
                      <td aria-hidden className="text-muted">
                        <Icon name="arrow-right" size={14} className="rtl:rotate-180" />
                      </td>
                      <td className={cn("px-4 py-2.5", !field && "text-muted")}>{field ? fieldLabel(field) : t("review.notMapped")}</td>
                    </tr>
                  );
                })}
                {"value" in record.mapping.type && (
                  <tr className="border-t border-border">
                    <th scope="row" className="px-4 py-2.5 text-start font-semibold">
                      {t("fields.type")}
                    </th>
                    <td />
                    <td className="px-4 py-2.5">
                      <bdi>{t("detail.everyRow", { value: record.mapping.type.value })}</bdi>
                    </td>
                  </tr>
                )}
                {"value" in record.mapping.trade && (
                  <tr className="border-t border-border">
                    <th scope="row" className="px-4 py-2.5 text-start font-semibold">
                      {t("fields.trade")}
                    </th>
                    <td />
                    <td className="px-4 py-2.5">
                      <bdi>{t("detail.everyRow", { value: fixedTrade(record.mapping.trade.value) })}</bdi>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3">
            <section className="flex flex-col gap-1.5 rounded-md border border-border bg-surface p-3">
              <h3 className="text-[11.5px] font-bold tracking-[0.06em] text-muted uppercase">{t("review.valuesMatched")}</h3>
              <ul className="flex flex-col gap-1">
                {valuesMatched(record).map((v) => (
                  <li
                    key={`${v.field}:${v.text}`}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-sm px-2.5 py-1.5 text-[13.5px]",
                      v.match ? "bg-surface-subtle" : "bg-danger-tint text-danger-fg",
                    )}
                  >
                    <bdi className="font-semibold">{v.text}</bdi>
                    <span>{v.match ? labelOf(v.match, locale) : t("review.notMatched")}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="flex flex-col gap-1.5 rounded-md border border-border bg-surface p-3">
              <h3 className="text-[11.5px] font-bold tracking-[0.06em] text-muted uppercase">{t("review.assignPackages")}</h3>
              <dl className="flex flex-col gap-1 text-[13.5px]">
                <div className="flex items-center justify-between gap-3 rounded-sm bg-surface-subtle px-2.5 py-1.5">
                  <dt>{t("review.defaultRaiser")}</dt>
                  <dd className="font-semibold">{record.defaultRaiser.name[locale]}</dd>
                </div>
                {rules > 0 && (
                  <div className="flex items-center justify-between gap-3 rounded-sm bg-surface-subtle px-2.5 py-1.5">
                    <dt>{t("assign.rules")}</dt>
                    <dd className="font-semibold">{t("review.rules", { count: rules, n: n(rules) })}</dd>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3 rounded-sm bg-surface-subtle px-2.5 py-1.5">
                  <dt>{t("validate.packages")}</dt>
                  <dd className="font-semibold">
                    {record.mapping.packages
                      ? t("review.packagesFile")
                      : packageColumn !== null
                        ? t("review.packagesColumn", { column: packageColumn })
                        : t("review.packagesNone")}
                  </dd>
                </div>
              </dl>
            </section>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}

/** "Save as mapping" on an import's page (RP-1144): its mapping saved under a name for the Member's own Company. */
export function SaveImportMapping({ projectId, mapping }: { projectId: string; mapping: RegisterImportMapping }) {
  const t = useTranslations("registerImport");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  async function save() {
    const chosen = name.trim();
    if (!chosen) return;
    setBusy(true);
    setFailed(null);
    const result = await setupCall("POST", `/projects/${projectId}/register-import-mappings`, { name: chosen, mapping });
    setBusy(false);
    if (!result.ok) {
      setFailed(t(`errors.${result.error === "name_taken" ? "nameTaken" : "unavailable"}`));
      return;
    }
    setSaved(chosen);
    setOpen(false);
    setName("");
  }
  return (
    <div className="flex flex-col items-end gap-2">
      {!open && (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Icon name="device-floppy" />
          {t("review.saveMapping")}
        </Button>
      )}
      {open && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input className="w-56" aria-label={t("review.mappingName")} placeholder={t("review.mappingName")} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" size="sm" disabled={busy || name.trim() === ""}>
            {t("review.save")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            {t("review.cancel")}
          </Button>
        </form>
      )}
      {saved && (
        <p role="status" className="flex items-center gap-1.5 text-[13px] text-success-fg">
          <Icon name="circle-check" size={14} />
          {t("review.mappingSaved", { name: saved })}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-[13px] text-danger-fg">
          {failed}
        </p>
      )}
    </div>
  );
}
