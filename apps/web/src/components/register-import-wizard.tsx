"use client";

import { formatNumber, type BilingualText, type Locale, type RegisterImport, type RegisterImportFields, type RegisterImportMapping, type RegisterImportRow } from "@rabaed/domain";
import { Icon, ImportRows, RegisterImportWizard as Wizard, type RegisterImportClient } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { setupCall } from "@/lib/setup-call";

// The Submittals Module's "Import register" (RP-637): the import wizard from @rabaed/ui, shared
// with Rabaed Admin (RP-645), with the customer api's calls, the app's messages and its links.

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
