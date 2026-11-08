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
  readSubmittalPanelPreferences,
  revisionPicker,
  stageColour,
  useSubmittalPanelIds,
  useMediaQuery,
  useSubmittalPanelSize,
  writeSubmittalPanelPreferences,
  type SubmittalPanelSizeLabels,
} from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRememberedHref } from "@/components/remembered-module-queries";
import { SubmittalPanelActionBar } from "@/components/submittal-panel-actions";
import { SubmittalPanelDetails } from "@/components/submittal-panel-details";
import { SubmittalPanelForm, useSubmittalPanelReads } from "@/components/submittal-panel-form";
import { useSubmittalPanelLog } from "@/components/submittal-panel-log";
import { SubmittalPanelNumber } from "@/components/submittal-panel-number";
import { useSubmittalPanelRoute } from "@/components/submittal-panel-route";
import { WorkItemRevisionBanner, WorkItemRevisionPicker } from "@/components/work-item-revision-picker";
import { phoneQuery } from "@/lib/new-submittal-panel";
import { useRouter } from "@/i18n/navigation";
import { submittalPanelPlace } from "@/lib/submittal-panel-place";
import { openIdFrom, sizeFrom, submittalPanelHref, withoutLinkSize } from "@/lib/submittal-panel-url";

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
  const tList = useTranslations("workItemViews.list");
  const ids = useSubmittalPanelIds();
  const [read, setRead] = useState<ItemRead | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [order, setOrder] = useState<string[]>([]);
  // The viewer's kept width, read once mounted (the server has no storage, so it draws Normal),
  // unless a link sets the size: that view is the link's and never writes (README §2).
  const params = useSearchParams();
  const linkSize = sizeFrom(params);
  const kept = useSyncExternalStore(noStorageEvents, keptWidth, () => null);
  const size = useSubmittalPanelSize({
    initial: linkSize ?? kept ?? submittalPanelNormalWidth,
    dir: directionOf(locale),
    // A link's size is the link's until the viewer picks their own: then it leaves the URL (Full collapses to a panel over the List, RP-1237 row 1).
    onKeep: (width) => {
      if (linkSize !== null) window.history.replaceState(null, "", withoutLinkSize(window.location.pathname, window.location.search));
      writeSubmittalPanelPreferences(submittalPanelStorage(), { width });
    },
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

  const remembered = useRememberedHref();
  const router = useRouter();
  // Opened from an item's own link, it landed at Full on a List with no query of its own: closing goes back to the
  // tab with the Member's last filters (RP-1240), as the item page's way back did.
  const landed = linkSize === "full" && [...params.keys()].every((key) => key === "open" || key === "size");
  const close = () => {
    const list = window.location.pathname.replace(/^\/(en|ar)(?=\/)/, "");
    if (landed && remembered(list) !== list) return router.replace(remembered(list));
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
  const { shown: place, numbered: numberPlace, codes: placeCodes } = submittalPanelPlace(item?.location ?? null, filters.locations, locale);
  // The route strip and the Workflow map (RP-1064); the map also says which Review Code each Transition issues.
  const { route, workflow, openMap, map } = useSubmittalPanelRoute(item, locale, refreshKey);
  // The approval log, in the side rail from 880px and in-flow below, under the Workflow block (RP-1093), and Internal Communication (RP-1067).
  const log = useSubmittalPanelLog({ item, locale, refreshKey, outcomes: filters.outcomes, workflow, openMap });
  // The whole Form, its Documents, Links and Revisions (RP-1237 rows 5, 12, 28): the reads the item page's server made.
  const { reads, failed } = useSubmittalPanelReads(item, refreshKey);
  // Edit (row 28): the Form's holder turns the Details into the Form; another item starts read again.
  const [editing, setEditing] = useState<string | null>(null);
  const itemId = item?.id ?? null;
  const startEditing = useCallback(() => setEditing(itemId), [itemId]);
  const typeOutcomes = item ? filters.outcomes.filter((o) => o.type === item.type.code) : [];
  const chain = item && reads?.id === item.id ? reads.chain : null;
  // An earlier Revision open (RP-1253): read only, with the banner naming the latest the viewer sees.
  const picked = item && chain ? revisionPicker(chain.revisions, item.id) : null;
  const pastRevision = picked?.kind === "button" && picked.past ? picked.revisionNo : null;
  // Choosing a Revision is a new history entry (the browser's Back returns to the one before), and the
  // panel scrolls to the top once it is read; its file viewer, sheet and menus reset with the item.
  const pathname = usePathname();
  const [revisionOpened, setRevisionOpened] = useState<string | null>(null);
  const openRevision = (id: string) => {
    setRevisionOpened(id);
    window.history.pushState(null, "", submittalPanelHref(pathname, window.location.search, id));
  };
  const tNew = useTranslations("newSubmittal");
  // On a phone the item is a page with a back arrow, as the create panel is (RP-1152 row 7; RP-1237 row 43).
  const phone = useMediaQuery(phoneQuery, false);

  return (
    <SubmittalPanelForm item={item} reads={reads} editing={editing !== null && editing === item?.id} locale={locale}>
      <SubmittalPanel
        locale={locale}
        labels={{
          module: tabs("submittals"),
          position: (n, total) => t("position", { n, total }),
          previous: t("previous"),
          next: t("next"),
          close: t("close"),
          hint: t("hint"),
          // Opened from outside the List, ↑ ↓ move nowhere (row 41).
          hintClose: t("hintClose"),
          back: tNew("back"),
        }}
        layout={phone ? "page" : "slide-over"}
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
        covers={phone || size.pressed === "full"}
        edge={<SubmittalPanelGrip size={size} locale={locale} labels={sizeLabels} />}
        topBarEnd={<SubmittalPanelSizeSwitch size={size} labels={sizeLabels} />}
        labelledBy={item ? ids.labelledBy : undefined}
        label={item ? undefined : loading ? t("loading") : t("unavailable")}
        busy={loading}
        scrollTopKey={item && item.id === revisionOpened ? item.id : null}
        identity={
          item && (
            <SubmittalPanelIdentity
              locale={locale}
              number={number}
              noNumber={t("noNumber")}
              subject={item.title}
              numberId={ids.numberId}
              subjectId={ids.subjectId}
              numberInfo={<SubmittalPanelNumber item={item} locale={locale} place={numberPlace} />}
              // The Revision picker right after the number (RP-1253): only the chain's Revisions the viewer may see (V1 each).
              revision={
                chain ? (
                  <WorkItemRevisionPicker chain={chain} openId={item.id} locale={locale} typeCode={item.type.code} outcomes={filters.outcomes} onOpen={openRevision} />
                ) : undefined
              }
              banner={chain && pastRevision !== null && <WorkItemRevisionBanner chain={chain} openId={item.id} locale={locale} onOpen={openRevision} />}
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
              with={submittalPanelWith(item.heldBy, locale, item.vacancy ? tList("waitingFor", { role: item.vacancy.projectRole.name[locale] }) : null)}
              stepAgeWeeks={isOpenStageCategory(item.stage.category) ? item.stepAgeWeeks : null}
              // Each level's code, "BLK-A · TWR-A · A06" (row 10); the Location section names the path.
              place={placeCodes.length > 0 ? [placeCodes.join(" · ")] : place}
            />
          )
        }
        tabs={item && <SubmittalPanelDetails item={item} locale={locale} place={place} refreshKey={refreshKey} log={log} reads={reads} failed={failed} onEdit={startEditing} />}
        rail={item && log.rail}
        actions={
          item &&
          !loading && (
            <SubmittalPanelActionBar
              key={item.id}
              item={item}
              locale={locale}
              outcomes={typeOutcomes}
              map={map}
              me={log.me}
              events={log.events}
              editing={editing === item.id}
              onEdit={startEditing}
              pastRevision={pastRevision}
            />
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
    </SubmittalPanelForm>
  );
}
