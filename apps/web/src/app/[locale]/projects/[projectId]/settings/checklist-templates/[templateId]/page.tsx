import type { Locale } from "@rabaed/domain";
import { Badge, Icon, SettingsHeader } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ChecklistTemplateEditor } from "@/components/checklist-templates";
import { Link, redirect } from "@/i18n/navigation";
import { getChecklistTemplates, getMe, getProject, getProjectDimensions } from "@/lib/session";

type Params = { locale: Locale; projectId: string; templateId: string };

/**
 * Project → Settings → Checklist Templates → one template, or `new` (RP-651): its names, Trade
 * and checks, and the checks as a WIR shows them. A Project Admin edits an active one into its
 * next Version (the WIRs that copied an earlier one keep theirs) or retires it; everyone else
 * on the Project reads it. Another Project's template, and a made-up one, are the not-found page.
 */
export default async function ChecklistTemplatePage({ params }: { params: Promise<Params> }) {
  const { locale, projectId, templateId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("projectSettings.checklistTemplates");
  const ts = await getTranslations("settings");
  const [me, project, dimensions, list] = await Promise.all([getMe(), getProject(projectId), getProjectDimensions(projectId), getChecklistTemplates(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !dimensions || !list) notFound();
  const creating = templateId === "new";
  const template = creating ? null : list.templates.find((x) => x.id === templateId);
  // Only a Project Admin starts a new one; a template is the Project's own.
  if (template === undefined || (creating && !list.canEdit)) notFound();

  const trades = dimensions.trade.map((v) => ({ id: v.id, code: v.code, name: v.name }));
  const readOnly = !list.canEdit || template?.status === "retired";
  return (
    <>
      <SettingsHeader
        title={template ? template.name[locale] : t("newTitle")}
        description={template ? t("editorIntro") : t("newIntro")}
        readOnlyLabel={readOnly ? ts("readOnly") : undefined}
        actions={
          <div className="flex items-center gap-3">
            {template && (
              <>
                <Badge tone="neutral">{t("versionNo", { n: String(template.versionNo) })}</Badge>
                <Badge tone={template.status === "active" ? "success" : "neutral"}>{t(`statuses.${template.status}`)}</Badge>
              </>
            )}
            <Link href={`/projects/${projectId}/settings/checklist-templates`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-fg hover:underline">
              <Icon name="arrow-left" size={15} />
              {t("backToList")}
            </Link>
          </div>
        }
      />
      <ChecklistTemplateEditor
        key={template ? `${template.id}-${template.versionNo}-${template.status}` : "new"}
        projectId={projectId}
        template={template}
        canEdit={list.canEdit}
        trades={trades}
      />
    </>
  );
}
