"use client";

import { isOpenStageCategory, watchOutcomeNames, type Locale, type WorkItemDetail, type WorkItemList as WorkItemListData } from "@rabaed/domain";
import {
  Button,
  Outcome,
  StagePill,
  SubmittalPanel,
  SubmittalPanelFacts,
  SubmittalPanelIdentity,
  cn,
  submittalPanelNormalWidth,
  submittalPanelNumber,
  submittalPanelPosition,
  submittalPanelStorage,
  submittalPanelWith,
  placesOf,
  readSubmittalPanelPreferences,
  stageColour,
  tradeChipClass,
  useSubmittalPanelIds,
} from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { DownloadRecordButton } from "@/components/download-record-button";
import { DownloadWorkingCopyButton } from "@/components/download-working-copy-button";
import { WorkItemActions } from "@/components/work-item-actions";
import { useRouter } from "@/i18n/navigation";
import { openIdFrom, submittalPanelHref } from "@/lib/submittal-panel-url";

type Filters = Pick<WorkItemListData["filters"], "outcomes" | "locations">;

/** Where the List's rows and the Kanban's cards mark the item they open: their order on the page is the panel's order. */
const openerSelector = "[data-open-id]";

/** The loaded rows as the page shows them (grouped, sorted, by column), each once; a folded group's are left out. */
function loadedOrder(): string[] {
  const ids = [...document.querySelectorAll<HTMLElement>(openerSelector)].filter((el) => el.getClientRects().length > 0).map((el) => el.dataset.openId!);
  return [...new Set(ids)];
}

function openerOf(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`${openerSelector}[data-open-id="${CSS.escape(id)}"]`);
}

/**
 * The Submittal Panel's place in the page's URL (`?open=<id>`, RP-1061): which item is open, and
 * opening or closing one. The URL changes in place (the browser's own history API, which the App
 * Router follows), so the List or the Kanban is not read again.
 */
export function useOpenSubmittal() {
  const params = useSearchParams();
  const pathname = usePathname();
  const openId = openIdFrom(params);
  const go = useCallback((id: string | null) => window.history.replaceState(null, "", submittalPanelHref(pathname, window.location.search, id)), [pathname]);
  return { openId, open: go, close: () => go(null) };
}

type Read = { id: string; item: WorkItemDetail | null };

/**
 * The open submittal in the Submittal Panel (RP-1061, spec RP-1054): read from the item read
 * the item page uses (`GET /v1/work-items/:id`), so it shows exactly what the viewer may see. An
 * item they can't see reads the same as one that doesn't exist. Its Transitions are the ones the
 * engine offers them, each opening its Action Form as on the item page.
 */
export function SubmittalPanelHost({
  openId,
  onOpen,
  onClose,
  locale,
  filters,
  refreshKey,
}: {
  openId: string;
  onOpen: (id: string) => void;
  onClose: () => void;
  locale: Locale;
  /** The List's or the Kanban's outcomes and Locations, for the Issued Code's look and the Location's path. */
  filters: Filters;
  /** Changes when the page's rows are read again (after a Transition, say): the item is read again too. */
  refreshKey: unknown;
}) {
  const t = useTranslations("submittalPanel");
  const tabs = useTranslations("projectTabs");
  const ids = useSubmittalPanelIds();
  const [read, setRead] = useState<Read | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [order, setOrder] = useState<string[]>([]);
  const [width] = useState(() => {
    const kept = readSubmittalPanelPreferences(submittalPanelStorage()).width;
    return kept === "full" ? submittalPanelNormalWidth : kept;
  });
  const openedId = useRef(openId);
  openedId.current = openId;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/work-items/${openId}`, { signal: controller.signal })
      .then(async (res) => setRead({ id: openId, item: res.ok ? ((await res.json()) as WorkItemDetail) : null }))
      .catch(() => {
        if (!controller.signal.aborted) setRead({ id: openId, item: null });
      });
    return () => controller.abort();
  }, [openId, refreshKey, attempt]);

  useEffect(() => setOrder(loadedOrder()), [openId, refreshKey]);

  const close = () => {
    const id = openedId.current;
    onClose();
    // Focus goes back to the row or card that was open.
    openerOf(id)?.focus();
  };
  const go = (id: string | null) => {
    if (!id) return undefined;
    return () => {
      onOpen(id);
      openerOf(id)?.scrollIntoView({ block: "nearest" });
    };
  };

  const position = submittalPanelPosition(order, openId);
  // While the next item is read, the last one stays, so the content swaps in place.
  const item = read?.item ?? null;
  const loading = read === null || read.id !== openId;
  const number = item ? submittalPanelNumber(item.documentNumber, item.revisionNo) : null;

  return (
    <SubmittalPanel
      locale={locale}
      labels={{
        module: tabs("submittals"),
        position: (n, total) => t("position", { n, total }),
        previous: t("previous"),
        next: t("next"),
        close: t("close"),
        hint: t("hint"),
      }}
      crumb={item ? (item.documentNumber ?? t("noNumber")) : ""}
      position={position}
      onPrevious={go(position.previous)}
      onNext={go(position.next)}
      onClose={close}
      width={width}
      labelledBy={item ? ids.labelledBy : undefined}
      label={item ? undefined : loading ? t("loading") : t("unavailable")}
      busy={loading}
      identity={
        item && (
          <SubmittalPanelIdentity
            number={number}
            noNumber={t("noNumber")}
            subject={item.title}
            numberId={ids.numberId}
            subjectId={ids.subjectId}
            chips={
              <>
                <StagePill stage={stageColour(item.stage)} label={item.stage.name[locale]} />
                {/* The Issued Code only: an item is closed at it. A Recommended Code is never shown here (V5). */}
                {item.outcome && (
                  <Outcome outcome={item.outcome} typeCode={item.type.code} outcomes={filters.outcomes} locale={locale} cancelled={watchOutcomeNames.cancelled[locale]} />
                )}
                <span className={cn("inline-flex h-6 items-center rounded-[7px] px-2 text-caption font-semibold", tradeChipClass(item.trade.code))}>
                  {item.trade.name[locale]} (<bdi translate="no">{item.trade.code}</bdi>)
                </span>
              </>
            }
          />
        )
      }
      facts={
        item && (
          <SubmittalPanelFacts
            locale={locale}
            labels={{ with: t("with"), stepAge: t("stepAge"), location: t("location"), more: (n) => t("more", { n }), none: "—" }}
            with={submittalPanelWith(item.heldBy, locale)}
            stepAgeWeeks={isOpenStageCategory(item.stage.category) ? item.stepAgeWeeks : null}
            place={item.location ? (placesOf(filters.locations).get(item.location.id)?.map((p) => p.name[locale]) ?? [item.location.name[locale]]) : []}
          />
        )
      }
      actions={
        item && (
          <>
            {/* Its Documental Record once closed, its Working Copy while open (V7). */}
            {item.outcome ? <DownloadRecordButton workItemId={item.id} status={item.documentalRecord} /> : <DownloadWorkingCopyButton workItemId={item.id} />}
            {item.actions.createRevision && <CreateRevisionButton workItemId={item.id} />}
            {/* Only what the engine offers this Member: its Transitions, Pick up and Return to pool. */}
            <WorkItemActions key={item.id} workItemId={item.id} actions={item.actions} locale={locale} />
          </>
        )
      }
    >
      {!item && (
        <div role="status" className="px-5 py-8 text-sm text-muted">
          {loading ? (
            t("loading")
          ) : (
            <span className="flex flex-col items-start gap-3">
              {t("unavailable")}
              <Button variant="secondary" size="sm" onClick={() => setAttempt((a) => a + 1)}>
                {t("tryAgain")}
              </Button>
            </span>
          )}
        </div>
      )}
    </SubmittalPanel>
  );
}

/**
 * Create Revision (after Code C: the API offers it only where the Type's outcome does): the new
 * Revision opens on its own page, as a Draft, as the item page's button does (RP-316).
 */
function CreateRevisionButton({ workItemId }: { workItemId: string }) {
  const t = useTranslations("revision");
  const router = useRouter();
  const key = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create() {
    setPending(true);
    setError(null);
    key.current ??= crypto.randomUUID();
    try {
      const res = await fetch(`/api/v1/work-items/${workItemId}/revisions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: key.current }),
      });
      if (!res.ok) {
        const { error: code } = (await res.json().catch(() => ({}))) as { error?: string };
        setError(t.has(`refusals.${code}`) ? t(`refusals.${code}`) : t("refusals.unavailable"));
        return;
      }
      key.current = null;
      const { id } = (await res.json()) as { id: string };
      router.push(`/work-items/${id}`);
    } catch {
      setError(t("refusals.unavailable"));
    } finally {
      setPending(false);
    }
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      {error && (
        <span role="alert" className="text-sm text-danger-fg">
          {error}
        </span>
      )}
      <Button variant="secondary" disabled={pending} onClick={() => void create()}>
        {t("create")}
      </Button>
    </span>
  );
}
