import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@rabaed/ui";
import { Link } from "@/i18n/navigation";

/**
 * The one page for every 404: a page that is not there, a Project the viewer may not
 * see, an item they may not see. It reads nothing about the request, so a hidden thing
 * and one that never existed are the same page (docs/visibility.md, 404 never 403).
 */
export default async function NotFound() {
  const t = await getTranslations("notFoundPage");

  return (
    <div className="space-y-6" data-testid="not-found">
      <h1 className="text-h5 font-semibold">{t("message")}</h1>
      <Link href="/projects" className={buttonVariants()}>
        {t("projects")}
      </Link>
    </div>
  );
}
