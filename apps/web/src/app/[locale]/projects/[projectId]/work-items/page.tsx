import { isOpenStageCategory, type Locale } from "@rabaed/domain";
import { AgeDots, DocNo, StagePill, buttonVariants } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { getMe, getProject, getWorkItems } from "@/lib/session";
import { stageColour } from "@/lib/stage-colour";

/**
 * A Project's Submittals, grouped by Stage. Only the items the Member can see
 * are listed, and each Stage's count is of those items only.
 */
export default async function WorkItemsPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("workItems");
  const [me, project, list] = await Promise.all([getMe(), getProject(projectId), getWorkItems(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !list) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <Link href={`/projects/${project.id}`} className="text-sm text-primary underline underline-offset-4">
            {project.name[locale]}
          </Link>
          <h1 className="text-h4 font-semibold">{t("title")}</h1>
        </div>
        {/* The MAR's Draft Step is held by Contractors; the API refuses anyone else too. */}
        {project.projectRole.baseRole === "contractor" && (
          <Link
            href={`/projects/${project.id}/work-items/new`}
            className={buttonVariants()}
          >
            {t("newMar")}
          </Link>
        )}
      </div>

      <ul className="flex flex-wrap gap-2" data-testid="stage-counts">
        {list.stages.map((s) => (
          <li key={s.key}>
            <StagePill stage={stageColour(s)} label={s.name[locale]} count={s.count} locale={locale} />
          </li>
        ))}
      </ul>

      {list.items.length === 0 ? (
        <p className="text-muted">{t("empty")}</p>
      ) : (
        list.stages
          .filter((s) => s.count > 0)
          .map((s) => (
            <section key={s.key} className="space-y-2">
              <h2 className="text-h6 font-semibold">
                {s.name[locale]} <span className="text-muted tabular-nums">({s.count})</span>
              </h2>
              <ul className="divide-y divide-border border-y border-border">
                {list.items
                  .filter((i) => i.stage.key === s.key)
                  .map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-4 py-3">
                      <span className="space-y-1">
                        <Link href={`/work-items/${i.id}`} className="font-medium text-primary underline underline-offset-4">
                          {i.title}
                        </Link>
                        <span className="block text-sm text-muted">
                          {i.documentNumber ? <DocNo value={i.documentNumber} /> : t("noNumber")}
                          {" · "}
                          {i.trade.name[locale]}
                          {i.location && ` · ${i.location.name[locale]}`}
                        </span>
                      </span>
                      {/* A closed item doesn't age. */}
                      {isOpenStageCategory(i.stage.category) ? (
                        <AgeDots weeks={i.stepAgeWeeks} locale={locale} />
                      ) : null}
                    </li>
                  ))}
              </ul>
            </section>
          ))
      )}
    </div>
  );
}
