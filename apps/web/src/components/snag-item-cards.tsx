"use client";

import type { DocumentSummary, Locale, RaisedFromSource } from "@rabaed/domain";
import { RaisedFromCard, SnagResponse, type SnagItemLabels, type SnagPhoto } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useImageUrls } from "@/components/use-documents";
import { Link } from "@/i18n/navigation";
import type { SnagResponseRead } from "@/lib/snag-response";

function useSnagItemLabels(): SnagItemLabels {
  const t = useTranslations("workItems.snag");
  const s = useTranslations("snagList");
  return {
    raisedFrom: t("raisedFrom"),
    raisedManually: t("raisedManually"),
    open: t("open"),
    code: (code) => s("code", { code }),
    comment: t("comment"),
    response: t("response"),
    before: t("before"),
    after: t("after"),
    noPhoto: t("noPhoto"),
    photoOf: (subject) => s("photoOf", { subject }),
  };
}

/**
 * A Snag List item's cards (RP-628): where it was raised from, and while it waits at Verify or
 * once closed from it, the Contractor's response with its "after" photos beside the "before" ones.
 */
export function SnagItemCards({
  workItemId,
  subject,
  locale,
  source,
  quote,
  response,
  before,
}: {
  workItemId: string;
  subject: string;
  locale: Locale;
  source: RaisedFromSource | null;
  /** A Comment's own comment, quoted under its source. */
  quote: string | null;
  response: SnagResponseRead | null;
  before: DocumentSummary[];
}) {
  const labels = useSnagItemLabels();
  const urls = useImageUrls(workItemId, response ? [...before, ...response.after] : []);
  const photos = (docs: readonly DocumentSummary[]): SnagPhoto[] => docs.map((d) => ({ id: d.id, url: urls[d.id] ?? null, name: d.fileName }));
  return (
    <div className="space-y-4">
      <RaisedFromCard source={source} quote={quote} locale={locale} labels={labels} itemHref={(id) => `/work-items/${id}`} linkAs={Link} />
      {response && (
        <SnagResponse
          resolution={response.resolution}
          before={photos(before)}
          after={photos(response.after)}
          subject={subject}
          labels={labels}
          aside={response.by && <span className="text-[12.5px] font-semibold text-text-secondary">{response.by[locale]}</span>}
        />
      )}
    </div>
  );
}
