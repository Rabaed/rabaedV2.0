"use client";

import { directionOf, isOpenStageCategory, watchOutcomeNames, type Locale, type WorkItemDetail, type WorkItemList as WorkItemListData } from "@rabaed/domain";
import {
  Button,
  DocNo,
  ErrorState,
  Outcome,
  StagePill,
  SubmittalPanel,
  SubmittalPanelFacts,
  SubmittalPanelGrip,
  SubmittalPanelIdentity,
  SubmittalPanelSizeSwitch,
  TradeChip,
  submittalPanelNormalWidth,
  submittalPanelNumber,
  submittalPanelPosition,
  submittalPanelStorage,
  submittalPanelWith,
  placesOf,
  readSubmittalPanelPreferences,
  stageColour,
  useSubmittalPanelIds,
  useSubmittalPanelSize,
  writeSubmittalPanelPreferences,
  type SubmittalPanelSizeLabels,
} from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { DownloadRecordButton } from "@/components/download-record-button";
import { DownloadWorkingCopyButton } from "@/components/download-working-copy-button";
import { SubmittalPanelDetails } from "@/components/submittal-panel-details";
import { useSubmittalPanelLog } from "@/components/submittal-panel-log";
import { useSubmittalPanelRoute } from "@/components/submittal-panel-route";
import { WorkItemActions } from "@/components/work-item-actions";
import { useCreateRevision } from "@/components/work-item-revision";
import { openIdFrom, sizeFrom, submittalPanelHref } from "@/lib/submittal-panel-url";

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
  const showInUrl = useCallback(
    (id: string | null) => window.history.replaceState(null, "", submittalPanelHref(pathname, window.location.search, id)),
    [pathname],
  );
  return { openId, open: showInUrl, close: () => showInUrl(null) };
}

/** The kept width, as one value, so reading it again gives the same snapshot (a small read: one short string). */
const keptWidth = () => readSubmittalPanelPreferences(submittalPanelStorage()).width;
/** Nothing to follow: the width is read when the panel opens. */
const noStorageEvents = () => () => {};

/** The item read for one id: the item, or null when it couldn't be read (hidden, gone or failed: the same to the viewer). */
type ItemRead = { id: string; item: WorkItemDetail | null };

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
  const [read, setRead] = useState<ItemRead | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [order, setOrder] = useState<string[]>([]);
  // The viewer's kept width, read once mounted (the server has no storage, so it draws Normal),
  // unless a link sets the size: that view is the link's and never writes (README §2).
  const linkSize = sizeFrom(useSearchParams());
  const kept = useSyncExternalStore(noStorageEvents, keptWidth, () => null);
  const size = useSubmittalPanelSize({
    initial: linkSize ?? kept ?? submittalPanelNormalWidth,
    dir: directionOf(locale),
    onKeep: linkSize === null ? (width) => writeSubmittalPanelPreferences(submittalPanelStorage(), { width }) : undefined,
  });
  const sizeLabels: SubmittalPanelSizeLabels = {
    group: t("size.group"),
    sizes: { compact: t("size.compact"), normal: t("size.normal"), wide: t("size.wide"), full: t("size.full") },
    grip: t("size.grip"),
  };

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
    onClose();
    // Focus goes back to the row or card that was open.
    openerOf(openId)?.focus();
  };
  /** Opens a neighbouring row, scrolled into view; none at the edge, which disables the button. */
  const moveTo = (id: string | null) =>
    id === null
      ? undefined
      : () => {
          onOpen(id);
          openerOf(id)?.scrollIntoView({ block: "nearest" });
        };

  // While the next item is read, the last one stays, so the content swaps in place; until it
  // arrives everything shown, its place and its actions included, is the last one's, and no
  // action can be taken on it.
  const shownId = read?.id ?? openId;
  const loading = read === null || read.id !== openId;
  const item = read?.item ?? null;
  const position = submittalPanelPosition(order, shownId);
  const number = item ? submittalPanelNumber(item.documentNumber, item.revisionNo) : null;
  const place = item?.location ? (placesOf(filters.locations).get(item.location.id)?.map((p) => p.name[locale]) ?? [item.location.name[locale]]) : [];
  // The route strip and the Workflow map (RP-1064).
  const { route, workflow, openMap } = useSubmittalPanelRoute(item, locale, refreshKey);
  // The approval log, in the side rail from 880px and in-flow below, under the Workflow block (RP-1093), and Internal Communication (RP-1067).
  const log = useSubmittalPanelLog({ item, locale, refreshKey, outcomes: filters.outcomes, workflow, openMap });

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
      crumb={
        !item ? null : number === null ? (
          t("noNumber")
        ) : number.revisionNo === null ? (
          <DocNo value={number.number} />
        ) : (
          <DocNo value={number.number} rev={number.revisionNo} locale={locale} />
        )
      }
      position={position}
      onPrevious={moveTo(position.previous)}
      onNext={moveTo(position.next)}
      onClose={close}
      width={size.width}
      resizing={size.resizing}
      edge={<SubmittalPanelGrip size={size} locale={locale} labels={sizeLabels} />}
      topBarEnd={<SubmittalPanelSizeSwitch size={size} labels={sizeLabels} />}
      labelledBy={item ? ids.labelledBy : undefined}
      label={item ? undefined : loading ? t("loading") : t("unavailable")}
      busy={loading}
      identity={
        item && (
          <SubmittalPanelIdentity
            locale={locale}
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
                <TradeChip code={item.trade.code} name={item.trade.name[locale]} />
              </>
            }
          />
        )
      }
      route={route}
      facts={
        item && (
          <SubmittalPanelFacts
            locale={locale}
            labels={{ with: t("with"), stepAge: t("stepAge"), location: t("location"), more: (n) => t("more", { n }), none: "—" }}
            with={submittalPanelWith(item.heldBy, locale)}
            stepAgeWeeks={isOpenStageCategory(item.stage.category) ? item.stepAgeWeeks : null}
            place={place}
          />
        )
      }
      tabs={item && <SubmittalPanelDetails item={item} locale={locale} place={place} refreshKey={refreshKey} log={log} />}
      rail={item && log.rail}
      actions={
        item &&
        !loading && (
          <>
            {/* Its Documental Record once closed, its Working Copy while open (V7). */}
            {item.outcome ? <DownloadRecordButton workItemId={item.id} status={item.documentalRecord} /> : <DownloadWorkingCopyButton workItemId={item.id} />}
            {item.actions.createRevision && <CreateRevisionButton key={item.id} workItemId={item.id} />}
            {/* Only what the engine offers this Member: its Transitions, Pick up and Return to pool. */}
            <WorkItemActions key={item.id} workItemId={item.id} actions={item.actions} locale={locale} />
          </>
        )
      }
    >
      {!item &&
        (loading ? (
          <p role="status" className="px-5 py-8 text-sm text-muted">
            {t("loading")}
          </p>
        ) : (
          <ErrorState
            title={t("unavailable")}
            className="m-5"
            action={
              <Button variant="secondary" size="sm" onClick={() => setAttempt((a) => a + 1)}>
                {t("tryAgain")}
              </Button>
            }
          />
        ))}
    </SubmittalPanel>
  );
}

/**
 * Create Revision (only where the API offers it: after Code C), the item page's own call
 * (`useCreateRevision`): the new Revision opens on its own page, as a Draft.
 */
function CreateRevisionButton({ workItemId }: { workItemId: string }) {
  const t = useTranslations("revision");
  const create = useCreateRevision(workItemId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setPending(true);
    setError(null);
    try {
      const result = await create();
      if (!result.ok) setError(t.has(`refusals.${result.reason}`) ? t(`refusals.${result.reason}`) : t("refusals.unavailable"));
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
      <Button variant="secondary" disabled={pending} onClick={() => void run()}>
        {t("create")}
      </Button>
    </span>
  );
}
