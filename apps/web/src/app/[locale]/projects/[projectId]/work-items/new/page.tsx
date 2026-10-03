import type { DimensionValue, Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { CreateWorkItemForm } from "@/components/create-work-item-form";
import { Link, redirect } from "@/i18n/navigation";
import { treeOrder } from "@/lib/dimension-tree";
import { getMe, getMyVisibility, getNewWorkItemForm, getNewWorkItemFormChoices, getProject } from "@/lib/session";

// Unicode left-to-right isolate and its closing pop, for codes inside <option> text.
const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);

/**
 * A Contractor Member creates a MAR in Draft. They choose only among the Trades
 * and Locations their own Visibility covers, so they can always see what they raise.
 */
export default async function NewWorkItemPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("workItems");
  const [me, project, mine, form, choices] = await Promise.all([
    getMe(),
    getProject(projectId),
    getMyVisibility(projectId),
    getNewWorkItemForm(projectId, "MAR"),
    getNewWorkItemFormChoices(projectId),
  ]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !mine || !form || !choices) notFound();

  const label = (v: DimensionValue) => `${v.name[locale]} (${LRI}${v.code}${PDI})`;
  const trades = mine.trade.map((v) => ({ id: v.id, label: label(v) }));
  const locations = treeOrder(mine.location).map((v) => ({ id: v.id, label: `${"— ".repeat(v.level)}${label(v)}` }));

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-1">
        <Link href={`/projects/${project.id}/work-items`} className="text-sm text-primary underline underline-offset-4">
          {t("title")}
        </Link>
        <h1 className="text-h4 font-semibold">{t("newMar")}</h1>
      </div>
      {trades.length === 0 ? (
        <p className="text-muted">{t("noTradesCovered")}</p>
      ) : (
        <CreateWorkItemForm
          projectId={project.id}
          form={form}
          choices={choices}
          trades={trades}
          locations={locations}
          locale={locale}
        />
      )}
    </div>
  );
}
