import type { Locale } from "@rabaed/domain";
import { SettingsHeader } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AddSupplierButton, ApprovedSupplierList } from "@/components/approved-supplier-list";
import { redirect } from "@/i18n/navigation";
import { treeOrder } from "@/lib/dimension-tree";
import { getApprovedSuppliers, getMe, getProject, getProjectDimensions, getProjectScopes } from "@/lib/session";

/**
 * Project → Settings → Approved Supplier List (RP-592, V10): the Project's suppliers
 * per Trade, with their Scope and status. Every Project Member reads it; a Project
 * Admin adds and withdraws suppliers. What put a supplier there is never shown.
 */
export default async function ApprovedSuppliersPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("projectSettings.approvedSuppliers");
  const ts = await getTranslations("settings");
  const [me, project, dimensions, scopes, list] = await Promise.all([
    getMe(),
    getProject(projectId),
    getProjectDimensions(projectId),
    getProjectScopes(projectId),
    getApprovedSuppliers(projectId),
  ]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !dimensions || !scopes || !list) notFound();

  const trades = dimensions.trade.map((v) => ({ id: v.id, code: v.code, name: v.name }));
  const scopeChoices = treeOrder(scopes.scopes);
  return (
    <>
      <SettingsHeader
        title={t("title")}
        description={t("intro")}
        readOnlyLabel={project.isProjectAdmin ? undefined : ts("readOnly")}
        actions={project.isProjectAdmin ? <AddSupplierButton projectId={project.id} trades={trades} scopes={scopeChoices} /> : undefined}
      />
      <ApprovedSupplierList canEdit={project.isProjectAdmin} trades={trades} scopes={scopeChoices} suppliers={list.suppliers} />
    </>
  );
}
