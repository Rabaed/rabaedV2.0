import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { fetchApiHealth, webVersion } from "@/lib/health";
import { cn } from "@/lib/utils";

// Always live: this page exists to show the API and database are up right now.
export const dynamic = "force-dynamic";

export default async function HealthPage({ params }: { params: Promise<{ locale: Locale }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("health");
  const health = await fetchApiHealth();

  return (
    <div className="space-y-6">
      <h1 className="text-h4 font-semibold">{t("title")}</h1>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
        <dt className="text-muted">{t("api")}</dt>
        <dd className={cn(health ? "text-success" : "text-danger")}>{health ? t("ok") : t("unreachable")}</dd>
        <dt className="text-muted">{t("database")}</dt>
        <dd data-testid="database-status" className={cn(health?.database === "ok" ? "text-success" : "text-danger")}>
          {health?.database === "ok" ? t("ok") : t("unavailable")}
        </dd>
        <dt className="text-muted-foreground">{t("version")}</dt>
        {/* Commit IDs read left to right in every language. */}
        <dd data-testid="version" dir="ltr" className="font-mono text-sm">
          {webVersion()}
          {health && health.version !== webVersion() ? ` (${t("apiVersion", { version: health.version })})` : ""}
        </dd>
      </dl>
    </div>
  );
}
