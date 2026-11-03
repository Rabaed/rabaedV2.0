import { defaultTradeId, inspectionsInSubmittals, moduleKeySchema, moduleTabPaths, type Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { CreateWorkItemForm } from "@/components/create-work-item-form";
import { NewItemTypePicker } from "@/components/new-item-type-picker";
import { Link, redirect } from "@/i18n/navigation";
import { fillingChoices } from "@/lib/built-in-choices";
import { newPageWords } from "@/lib/new-item-route";
import { newInspectionLanding, newItemLanding } from "@/lib/submittal-panel-url";
import { snagListLanding } from "@/lib/new-panel-hooks";
import {
  getMe,
  getMyVisibility,
  getNewWorkItemForm,
  getNewWorkItemFormChoices,
  getOptionLists,
  getSupplierChoices,
  getChecklistTemplateChoices,
  getProject,
  getProjectScopes,
  getRaisableTypes,
} from "@/lib/session";

/**
 * A Member creates an item in Draft of another Module than the Submittals and the Inspections (with `?module=snag_list`, a
 * Snag List Type such as the Consultant's Snag, RP-94), of one of the Types they may
 * raise (`?type=`, the MAR when none or one they may not). Its Form offers only the
 * Trades and Locations their own Visibility covers, so they can always see what
 * they raise, and the active Scopes of the chosen Trade.
 */
export default async function NewWorkItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale; projectId: string }>;
  searchParams: Promise<{ type?: string; module?: string; location?: string }>;
}) {
  const { locale, projectId } = await params;
  const { type: requested, module: moduleParam, location } = await searchParams;
  // The Module whose Types it offers: the Submittals, unless "+ New" names another (the Snag List, RP-94).
  const moduleKey = moduleKeySchema.safeParse(moduleParam).data ?? "submittals";
  // A Submittal is raised in the create panel over the List (RP-1152): a direct link lands there at Normal (decision 1).
  if (moduleKey === "submittals") return redirect({ href: newItemLanding(projectId, requested), locale });
  // An Inspection too (RP-1221, gap rows 1, 2 and 5): over the tab the Project shows Inspections in.
  if (moduleKey === "inspections") {
    const [me, project] = await Promise.all([getMe(), getProject(projectId)]);
    if (!me) return redirect({ href: "/sign-in", locale });
    if (!project) notFound();
    return redirect({ href: newInspectionLanding(projectId, { inSubmittals: inspectionsInSubmittals(project) }, requested), locale });
  }
  // So is a Snag List item, over the Snag List (RP-1222 row 5); a phone goes on to the camera-first New Snag there (row 4).
  if (moduleKey === "snag_list") return redirect({ href: snagListLanding(projectId, requested, location), locale });
  setRequestLocale(locale);
  const t = await getTranslations("workItems");
  const tabs = await getTranslations("projectTabs");
  const [me, project, mine, scopes, raisable, people, optionLists, suppliers, checklistTemplates] = await Promise.all([
    getMe(),
    getProject(projectId),
    getMyVisibility(projectId),
    getProjectScopes(projectId),
    getRaisableTypes(projectId, moduleKey),
    getNewWorkItemFormChoices(projectId),
    getOptionLists(),
    getSupplierChoices(projectId),
    getChecklistTemplateChoices(projectId),
  ]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !mine || !scopes || !raisable || !people) notFound();

  const chosen = raisable.types.find((type) => type.code === requested) ?? raisable.types[0];
  const form = chosen ? await getNewWorkItemForm(projectId, chosen.code) : null;
  const words = newPageWords(moduleKey);

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-1">
        <Link href={`/projects/${project.id}/${moduleTabPaths[moduleKey]}`} className="text-sm text-brand-fg underline underline-offset-4">
          {tabs(moduleKey)}
        </Link>
        <h1 className="text-h4 font-semibold">{t(words.heading)}</h1>
      </div>
      {!chosen || !form ? (
        <p className="text-muted">{t(words.noType)}</p>
      ) : (
        <>
          <NewItemTypePicker projectId={project.id} types={raisable.types} selected={chosen.code} moduleKey={moduleKey} locale={locale} />
          {mine.trade.length === 0 ? (
            <p className="text-muted">{t("noTradesCovered")}</p>
          ) : (
            <CreateWorkItemForm
              key={chosen.code}
              projectId={project.id}
              typeCode={chosen.code}
              form={form}
              choices={fillingChoices(mine, scopes.scopes, locale)}
              people={people}
              optionLists={optionLists}
              suppliers={suppliers}
              checklistTemplates={checklistTemplates}
              startTradeId={defaultTradeId(form.schema, mine.trade)}
              locale={locale}
            />
          )}
        </>
      )}
    </div>
  );
}
