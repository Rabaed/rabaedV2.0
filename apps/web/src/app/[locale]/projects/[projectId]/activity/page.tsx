import type { Locale } from "@rabaed/domain";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ActivityFeedPageView } from "@/components/activity-feed-view";
import { redirect } from "@/i18n/navigation";
import { getActivityFeed, getMe, getProject } from "@/lib/session";

/**
 * The Activity Feed page (RP-1157, the owner's `Rabaed Activity.html`; "View all" on the Dashboard,
 * RP-353): the Project's Work Item events as the Member may see them, by day, older ones loading on
 * scrolling down. The Project's tabs lead back. A Project the Member is not on is not found.
 */
export default async function ActivityPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const [me, project, activity] = await Promise.all([getMe(), getProject(projectId), getActivityFeed(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !activity) notFound();

  return <ActivityFeedPageView projectId={project.id} projectName={project.name[locale]} initial={activity} locale={locale} now={new Date().toISOString()} />;
}
