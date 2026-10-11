import type { Locale } from "@rabaed/domain";
import type { WorkflowBuilderLabels } from "@rabaed/ui";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { LibraryWorkflowMap } from "@/components/library-workflow-map";
import { WorkflowBuilderEditor } from "@/components/workflow-builder-editor";
import { redirect } from "@/i18n/navigation";
import { getMe, getWorkflowBuilder, getWorkflowMap } from "@/lib/session";

type Params = { locale: Locale; workflowId: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, workflowId } = await params;
  const read = await getWorkflowMap(workflowId);
  if (!read || read.workflow.owner !== "company") return {};
  const t = await getTranslations({ locale, namespace: "library.map" });
  return { title: t("pageTitle", { name: (read.workflow.draft?.name ?? read.workflow.name)[locale] }) };
}

/**
 * My Company → Library → a Workflow (RP-442, WF-19): the Company's Authorized Person edits it
 * in the builder, each published edit a new Version of the Library copy; any other Member of
 * the Company looks at its map. Another Company's, a Project's and a Rabaed Default are not
 * the Library's: the not-found page, as the API answers them (V18).
 */
export default async function LibraryWorkflowPage({ params }: { params: Promise<Params> }) {
  const { locale, workflowId } = await params;
  setRequestLocale(locale);
  const [me, builder] = await Promise.all([getMe(), getWorkflowBuilder(workflowId)]);
  if (!me) return redirect({ href: "/sign-in", locale });

  if (builder) {
    if (builder.workflow.owner !== "company") notFound();
    // What the builder adds is named in both languages, whichever the author reads.
    const [en, ar] = await Promise.all([
      getTranslations({ locale: "en", namespace: "workflowBuilder.names" }),
      getTranslations({ locale: "ar", namespace: "workflowBuilder.names" }),
    ]);
    const both = (key: keyof WorkflowBuilderLabels["names"]) => ({ en: en(key), ar: ar(key) });
    const names: WorkflowBuilderLabels["names"] = {
      firstStep: both("firstStep"),
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
      // The builder takes the page's whole width beside the sidebar and the height under the top bar.
      <div className="h-[calc(100dvh-9rem)] min-h-[640px]">
        <WorkflowBuilderEditor read={builder} locale={locale} backHref={`/${locale}/library`} names={names} />
      </div>
    );
  }

  const map = await getWorkflowMap(workflowId);
  if (!map || map.workflow.owner !== "company") notFound();
  return <LibraryWorkflowMap read={map} locale={locale} />;
}
