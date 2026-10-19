"use client";

import { formatNumber, type BilingualText, type Locale, type RegisterImport, type RegisterImportFields, type RegisterImportMapping, type RegisterImportRow } from "@rabaed/domain";
import { Button, Icon, ImportRows, RegisterImportWizard as Wizard, rejectedRowsDownload, saveDownload, type RegisterImportClient } from "@rabaed/ui";
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
}: {
  projectId: string;
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
      resultActions={(preview, created) => (
        <Link
          href={`/projects/${projectId}/work-items/imports/${preview.id}`}
          className="inline-flex h-9 items-center gap-2 rounded-sm bg-primary px-3.5 text-[14px] font-semibold text-on-primary hover:bg-primary-hover"
        >
          <Icon name="list" />
          {t("result.open", { count: created, n: formatNumber(created, locale) })}
        </Link>
      )}
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
