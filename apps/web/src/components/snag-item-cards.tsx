"use client";

import type { DocumentSummary, Locale, WorkItemDetail } from "@rabaed/domain";
import { Icon, RaisedFromCard, SnagResponse, type SnagItemLabels, type SnagPhoto } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useImageUrls, usePhotoUrls } from "@/components/use-documents";
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
    failedItem: t("failedItem"),
    photoOf: (subject) => s("photoOf", { subject }),
  };
}

/**
 * On a phone, a Snag List item's first "before" photo, the screen's width, above its header (RP-630;
 * kit `snag/mobile.js`). Nothing without one, or from `md` up, where the Form shows them all.
 */
export function SnagHeroPhoto({ workItemId, subject, photos }: { workItemId: string; subject: string; photos: DocumentSummary[] }) {
  const s = useTranslations("snagList");
  const first = photos[0];
  const urls = useImageUrls(workItemId, first ? [first] : []);
  if (!first) return null;
  const url = urls[first.id];
  return (
    <div className="-mx-4 -mt-6 flex aspect-[16/10] items-center justify-center overflow-hidden bg-surface-subtle text-faint md:hidden">
      {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived URL the file store signs, not for next/image to fetch and cache */}
      {url ? <img src={url} alt={s("photoOf", { subject })} className="size-full object-cover" /> : <Icon name="photo" size={28} label={s("photoOf", { subject })} />}
    </div>
  );
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
  /** Where it was raised from, with the failed check item and its photos when a code raised it (RP-1081). */
  source: WorkItemDetail["raisedFrom"];
  /** A Comment's own comment, quoted under its source. */
  quote: string | null;
  response: SnagResponseRead | null;
  before: DocumentSummary[];
}) {
  const labels = useSnagItemLabels();
  const urls = useImageUrls(workItemId, response ? [...before, ...response.after] : []);
  const photos = (docs: readonly DocumentSummary[]): SnagPhoto[] => docs.map((d) => ({ id: d.id, url: urls[d.id] ?? null, name: d.fileName }));
  // The failed check item's photos are the source's own, so their URLs are asked of the source.
  const sourceId = source?.workItemId;
  const checkPhotos = source?.checkItem && sourceId ? source.checkItem.photos : [];
  const checkUrls = usePhotoUrls(sourceId ? checkPhotos.map((p) => ({ workItemId: sourceId, documentId: p.id, contentType: p.contentType })) : []);
  const checkItem = source?.checkItem
    ? { text: source.checkItem.text, photos: checkPhotos.map((p) => ({ id: p.id, url: checkUrls[p.id] ?? null, name: p.fileName })) }
    : null;
  return (
    <div className="space-y-4">
      <RaisedFromCard source={source} quote={quote} checkItem={checkItem} locale={locale} labels={labels} itemHref={(id) => `/work-items/${id}`} linkAs={Link} />
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
