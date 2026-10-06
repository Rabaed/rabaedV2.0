import type { Locale } from "@rabaed/domain";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ActivityFeedView } from "@/components/activity-feed-view";
import { Link, redirect } from "@/i18n/navigation";
import { getActivityFeed, getDashboard, getMe, getProject } from "@/lib/session";

/**
 * The Activity Feed at full height ("View all" on the Dashboard, RP-353): the
 * Project's Work Item events as the Member may see them, older ones loading on
 * scrolling down. A Project the Member is not on is not found.
 */
export default async function ActivityPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const [me, project, dashboard, activity] = await Promise.all([getMe(), getProject(projectId), getDashboard(projectId), getActivityFeed(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !dashboard || !activity) notFound();

  return (
    <div className="space-y-4">
      <Link href={`/projects/${project.id}`} className="text-sm text-primary underline underline-offset-4">
        {project.name[locale]}
      </Link>
      <ActivityFeedView projectId={project.id} initial={activity} dashboard={dashboard} locale={locale} fullHeight />
    </div>
  );
}
