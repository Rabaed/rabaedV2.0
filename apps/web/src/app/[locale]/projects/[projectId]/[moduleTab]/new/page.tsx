import { moduleOfTabPath, type Locale } from "@rabaed/domain";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { SnagPhoneNew } from "@/components/snag-phone-new";
import { redirect } from "@/i18n/navigation";
import { phoneFlowStep } from "@/lib/snag-phone-flow";
import { getMe, getMyVisibility, getNewWorkItemForm, getRaisableTypes, getWorkItem, getWorkItemDocuments } from "@/lib/session";

/**
 * The camera-first New Snag on a phone (RP-630): the Snag List's "+" on a phone opens it, with
 * `?type=` one of the Snag List Types the Member may raise whose Form takes photos (any other
 * opens the usual New page). `?draft=` and `?step=` keep the Draft and the step in the URL, so
 * a reload reopens the same step; once the Draft is raised, its page.
 */
export default async function SnagPhoneNewPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale; projectId: string; moduleTab: string }>;
  searchParams: Promise<{ type?: string; draft?: string; step?: string; missing?: string }>;
}) {
  const { locale, projectId, moduleTab } = await params;
  const { type: requested, draft: draftId, step, missing } = await searchParams;
  setRequestLocale(locale);
  if (moduleOfTabPath(moduleTab) !== "snag_list") notFound();
  const [me, raisable, covered] = await Promise.all([getMe(), getRaisableTypes(projectId, "snag_list"), getMyVisibility(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!raisable || !covered) notFound();
  const usual = `/projects/${projectId}/work-items/new?module=snag_list${requested ? `&type=${encodeURIComponent(requested)}` : ""}`;
  const type = raisable.types.find((t) => t.code === requested);
  const form = type ? await getNewWorkItemForm(projectId, type.code) : null;
  const fields = form?.schema.sections.flatMap((s) => s.fields) ?? [];
  const photosField = fields.find((f) => f.type === "photos");
  // A Type the Member may not raise, or whose Form takes no photos: the usual New page.
  if (!type || !form || !photosField) return redirect({ href: usual, locale });
  const description = fields.find((f) => f.key === "description" && f.type === "textarea");

  const [draft, documents] = draftId ? await Promise.all([getWorkItem(draftId), getWorkItemDocuments(draftId)]) : [null, null];
  if (draftId && (!draft || !documents || draft.type.code !== type.code)) notFound();
  const at = phoneFlowStep({ draft, step });
  if (at === "done") return redirect({ href: `/work-items/${draftId}`, locale });

  return (
    <SnagPhoneNew
      // A new Draft or step is a new screen: nothing typed carries over.
      key={`${draftId ?? "new"}:${at}`}
      projectId={projectId}
      typeCode={type.code}
      locale={locale}
      step={at}
      photosField={photosField.key}
      askDescription={!!description}
      photosMissing={missing !== undefined}
      trades={covered.trade}
      locations={covered.location}
      draft={
        draft && documents
          ? {
              id: draft.id,
              subject: draft.title,
              answers: draft.answers,
              trade: draft.trade,
              photos: documents.documents.filter((d) => d.fieldKey === photosField.key),
              raise: draft.actions.transitions.find((t) => t.kind === "submit") ?? null,
              saveAnswers: draft.actions.saveAnswers,
            }
          : null
      }
    />
  );
}
