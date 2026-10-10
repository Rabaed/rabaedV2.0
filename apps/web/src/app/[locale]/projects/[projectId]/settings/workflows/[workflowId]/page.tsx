import type { Locale } from "@rabaed/domain";
import type { WorkflowBuilderLabels } from "@rabaed/ui";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { WorkflowBuilderEditor } from "@/components/workflow-builder-editor";
import { redirect } from "@/i18n/navigation";
import { getMe, getWorkflowBuilder } from "@/lib/session";

type Params = { locale: Locale; projectId: string; workflowId: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, workflowId } = await params;
  const read = await getWorkflowBuilder(workflowId);
  if (!read) return {};
  const t = await getTranslations({ locale, namespace: "workflowBuilder" });
  return { title: t("pageTitle", { name: (read.workflow.draft?.name ?? read.workflow.name)[locale] }) };
}

/**
 * Project → Settings → Workflows → the builder (RP-439, WF-16; design
 * `settings-workflows.html`): a Project Admin edits the Project's own Workflow's
 * draft and publishes it. Its authors only: anyone else, another Project's
 * Workflow or a Rabaed Default gets the not-found page, as the API answers them.
 */
export default async function WorkflowBuilderPage({ params }: { params: Promise<Params> }) {
  const { locale, projectId, workflowId } = await params;
  setRequestLocale(locale);
  const [me, read] = await Promise.all([getMe(), getWorkflowBuilder(workflowId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!read || read.workflow.projectId !== projectId) notFound();

  // What the builder adds is named in both languages, whichever the author reads.
  const [en, ar] = await Promise.all([
    getTranslations({ locale: "en", namespace: "workflowBuilder.names" }),
    getTranslations({ locale: "ar", namespace: "workflowBuilder.names" }),
  ]);
  const both = (key: keyof WorkflowBuilderLabels["names"]) => ({ en: en(key), ar: ar(key) });
  const names: WorkflowBuilderLabels["names"] = {
    newStep: both("newStep"),
    newTransition: both("newTransition"),
    engineerReview: both("engineerReview"),
    pmReview: both("pmReview"),
    consultantEngineer: both("consultantEngineer"),
    consultantManager: both("consultantManager"),
    send: both("send"),
    return: both("return"),
  };

  return (
    // The builder takes the whole width under the Project's tabs, as the design's does. The outer
    // box keeps its place in the page; the inner one spans the viewport from there. It is placed
    // against the viewport (no ancestor is positioned), whose width leaves out the scrollbar, so
    // unlike `w-screen` (100vw) it never makes the page scroll sideways.
    <div className="h-[calc(100dvh-11rem)] min-h-[640px]">
      <div className="absolute inset-x-0 h-[calc(100dvh-11rem)] min-h-[640px]">
        <WorkflowBuilderEditor read={read} locale={locale} backHref={`/${locale}/projects/${projectId}/settings`} names={names} />
      </div>
    </div>
  );
}
