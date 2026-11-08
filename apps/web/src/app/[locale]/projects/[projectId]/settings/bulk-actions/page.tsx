import type { Locale } from "@rabaed/domain";
import { Icon, SettingsHeader, buttonVariants } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { getMe, getProject, getRaisableTypes } from "@/lib/session";

/**
 * Project → Settings → Bulk Actions (RP-1144; the kit's settings-bulk.html, owner's answer
 * 2026-11-08): the door to the Submittal Register Import. It opens the same wizard and the same
 * Imports page the Submittals List's More menu opens, at the same addresses; the kit's own
 * five-step flow and its Drawings folder are not built. Only a Member who may raise a Submittals
 * Type reaches it, since only they may import (story 4); an import is their own Company's.
 */
export default async function BulkActionsPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("bulkActions");
  const [me, project, raisable] = await Promise.all([getMe(), getProject(projectId), getRaisableTypes(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !raisable || raisable.types.length === 0) notFound();
  const base = `/projects/${project.id}/work-items`;

  return (
    <>
      <SettingsHeader title={t("title")} description={t("lede")} />
      <div className="grid gap-4 md:grid-cols-2">
        <section aria-labelledby="bulk-submittals" className="flex flex-col gap-3 rounded-md border border-border bg-surface p-5">
          <span className="inline-flex size-11 items-center justify-center rounded-md bg-success-tint text-success-fg">
            <Icon name="table" size={22} />
          </span>
          <h2 id="bulk-submittals" className="text-[16px] font-semibold">
            {t("submittalsTitle")}
          </h2>
          <p className="flex-1 text-[14px] text-muted">{t("submittalsBody")}</p>
          <Link href={`${base}/import`} className={buttonVariants({ className: "self-start" })}>
            <Icon name="upload" />
            {t("submittalsStart")}
          </Link>
        </section>
        <section aria-labelledby="bulk-imports" className="flex flex-col gap-3 rounded-md border border-border bg-surface p-5">
          <span className="inline-flex size-11 items-center justify-center rounded-md bg-neutral-tint text-text-secondary">
            <Icon name="history" size={22} />
          </span>
          <h2 id="bulk-imports" className="text-[16px] font-semibold">
            {t("importsTitle")}
          </h2>
          <p className="flex-1 text-[14px] text-muted">{t("importsBody")}</p>
          <Link href={`${base}/imports`} className={buttonVariants({ variant: "secondary", className: "self-start" })}>
            {t("importsOpen")}
          </Link>
        </section>
      </div>
    </>
  );
}
