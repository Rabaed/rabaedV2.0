import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LibraryWorkflows } from "@/components/library-workflows";
import { redirect } from "@/i18n/navigation";
import { getLibraryWorkflows, getMe, getMyProjects } from "@/lib/session";

/**
 * My Company → Library (RP-442, WF-19): the Company's own copies, Workflows first (Forms
 * join as another tab later). Private to the Company until a copy is used on a Project (V18).
 */
export default async function LibraryPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("library");
  const [me, library, mine] = await Promise.all([getMe(), getLibraryWorkflows(), getMyProjects()]);
  if (!me) return redirect({ href: "/sign-in", locale });
  // Where a Workflow can be used: the open Projects the Member is Project Admin of.
  const projects = (mine?.projects ?? []).filter((p) => p.isProjectAdmin && p.status === "active").map((p) => ({ id: p.id, code: p.code, name: p.name }));

  return (
    <div>
      <div className="mb-5.5 flex flex-col gap-1">
        <h1 className="font-display text-h4 leading-[1.2] font-extrabold tracking-[-0.01em] text-text rtl:font-bold rtl:tracking-normal">{t("title")}</h1>
        <p className="text-body text-muted">{t("subtitle")}</p>
      </div>
      {library ? (
        <LibraryWorkflows library={library} projects={projects} isAuthorizedPerson={me.member.isAuthorizedPerson} />
      ) : (
        <p role="alert" className="text-danger-fg">
          {t("unavailable")}
        </p>
      )}
    </div>
  );
}
