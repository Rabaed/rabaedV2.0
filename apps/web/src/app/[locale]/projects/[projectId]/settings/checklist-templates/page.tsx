import type { Locale } from "@rabaed/domain";
import { buttonVariants, Icon, SettingsHeader } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ChecklistTemplateList } from "@/components/checklist-templates";
import { Link, redirect } from "@/i18n/navigation";
import { getChecklistTemplates, getMe, getProject, getProjectDimensions } from "@/lib/session";

/**
 * Project → Settings → Checklist Templates (RP-651; form-engine.md §3.2): the Project's
 * official checklists per Trade, with their checks, Version and status. Every Project Member
 * reads them; a Project Admin creates, edits (each save is the next Version) and retires them.
 * A WIR picks one of its Trade's active ones, and copies its checks.
 */
export default async function ChecklistTemplatesPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("projectSettings.checklistTemplates");
  const ts = await getTranslations("settings");
  const [me, project, dimensions, list] = await Promise.all([getMe(), getProject(projectId), getProjectDimensions(projectId), getChecklistTemplates(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !dimensions || !list) notFound();

  const trades = dimensions.trade.map((v) => ({ id: v.id, code: v.code, name: v.name }));
  return (
    <>
      <SettingsHeader
        title={t("title")}
        description={t("intro")}
        readOnlyLabel={list.canEdit ? undefined : ts("readOnly")}
        actions={
          list.canEdit && trades.length > 0 ? (
            <Link href={`/projects/${project.id}/settings/checklist-templates/new`} className={buttonVariants({ size: "sm" })}>
              <Icon name="plus" size={15} />
              {t("new")}
            </Link>
          ) : undefined
        }
      />
      <ChecklistTemplateList projectId={project.id} canEdit={list.canEdit} trades={trades} templates={list.templates} />
    </>
  );
}
