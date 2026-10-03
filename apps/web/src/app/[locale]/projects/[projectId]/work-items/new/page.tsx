import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { CreateWorkItemForm } from "@/components/create-work-item-form";
import { Link, redirect } from "@/i18n/navigation";
import { fillingChoices } from "@/lib/built-in-choices";
import { getMe, getMyVisibility, getNewWorkItemForm, getNewWorkItemFormChoices, getProject, getProjectScopes } from "@/lib/session";

/**
 * A Contractor Member creates a MAR in Draft. Its Form offers only the Trades
 * and Locations their own Visibility covers, so they can always see what they
 * raise, and the active Scopes of the chosen Trade.
 */
export default async function NewWorkItemPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("workItems");
  const [me, project, mine, scopes, form, people] = await Promise.all([
    getMe(),
    getProject(projectId),
    getMyVisibility(projectId),
    getProjectScopes(projectId),
    getNewWorkItemForm(projectId, "MAR"),
    getNewWorkItemFormChoices(projectId),
  ]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !mine || !scopes || !form || !people) notFound();

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-1">
        <Link href={`/projects/${project.id}/work-items`} className="text-sm text-primary underline underline-offset-4">
          {t("title")}
        </Link>
        <h1 className="text-h4 font-semibold">{t("newMar")}</h1>
      </div>
      {mine.trade.length === 0 ? (
        <p className="text-muted">{t("noTradesCovered")}</p>
      ) : (
        <CreateWorkItemForm
          projectId={project.id}
          form={form}
          choices={fillingChoices(mine, scopes.scopes, locale)}
          people={people}
          locale={locale}
        />
      )}
    </div>
  );
}
