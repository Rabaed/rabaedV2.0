import type { DimensionValue, Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AddDimensionValueForm } from "@/components/add-dimension-value-form";
import { TradeScopes } from "@/components/trade-scopes";
import { Link, redirect } from "@/i18n/navigation";
import { treeOrder } from "@/lib/dimension-tree";
import { getMe, getProject, getProjectDimensions, getProjectScopes } from "@/lib/session";

// Unicode left-to-right isolate and its closing pop, for codes inside <option> text.
const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);

/**
 * Project Settings → Trades & Locations, with each Trade's Scopes and Sub-scopes.
 * Every Project Member sees them; a Project Admin adds them, and renames and
 * deactivates Scopes.
 */
export default async function TradesLocationsPage({
  params,
}: {
  params: Promise<{ locale: Locale; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("dimensions");
  const [me, project, dimensions, scopes] = await Promise.all([
    getMe(),
    getProject(projectId),
    getProjectDimensions(projectId),
    getProjectScopes(projectId),
  ]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !dimensions || !scopes) notFound();

  // An <option> can't hold <bdi>: isolate the code left-to-right with LRI/PDI instead.
  const label = (v: DimensionValue) => `${v.name[locale]} (${LRI}${v.code}${PDI})`;
  const locations = treeOrder(dimensions.location);
  // A Floor has nothing inside it; Zones and Buildings do.
  const parents = locations
    .filter((l) => l.depth < 3)
    .map((l) => ({ id: l.id, label: `${"— ".repeat(l.level)}${label(l)} · ${l.levelName?.[locale] ?? ""}` }));

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Link href={`/projects/${project.id}`} className="text-sm text-primary underline underline-offset-4">
          {project.name[locale]}
        </Link>
        <h1 className="text-h4 font-semibold">{t("title")}</h1>
      </div>

      <section className="space-y-4">
        <h2 className="text-h6 font-semibold">{t("trades")}</h2>
        {dimensions.trade.length === 0 ? (
          <p className="text-muted">{t("noTrades")}</p>
        ) : (
          <ul className="divide-y divide-border border-y border-border" data-testid="trades">
            {dimensions.trade.map((v) => (
              <li key={v.id} className="space-y-2 py-3">
                <div>
                  {v.name[locale]}{" "}
                  <bdi dir="ltr" className="text-sm text-muted">
                    {v.code}
                  </bdi>
                </div>
                <TradeScopes
                  projectId={project.id}
                  tradeId={v.id}
                  scopes={treeOrder(scopes.scopes.filter((s) => s.tradeId === v.id))}
                  canEdit={project.isProjectAdmin}
                />
              </li>
            ))}
          </ul>
        )}
        {project.isProjectAdmin && <AddDimensionValueForm projectId={project.id} kind="trade" />}
      </section>

      <section className="space-y-4">
        <h2 className="text-h6 font-semibold">{t("locations")}</h2>
        {locations.length === 0 ? (
          <p className="text-muted">{t("noLocations")}</p>
        ) : (
          <ul className="divide-y divide-border border-y border-border" data-testid="locations">
            {locations.map((v) => (
              <li key={v.id} className="py-2" style={{ paddingInlineStart: `${v.level * 1.5}rem` }}>
                {v.name[locale]}{" "}
                <bdi dir="ltr" className="text-sm text-muted">
                  {v.code}
                </bdi>
                <span className="text-sm text-muted"> · {v.levelName?.[locale]}</span>
              </li>
            ))}
          </ul>
        )}
        {project.isProjectAdmin && <AddDimensionValueForm projectId={project.id} kind="location" parents={parents} />}
      </section>
    </div>
  );
}
