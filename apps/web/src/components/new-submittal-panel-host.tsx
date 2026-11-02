"use client";

import {
  checklistTemplateChoices,
  defaultTradeId,
  directionOf,
  formFields,
  formVisibility,
  isUnanswered,
  type ApprovedSuppliers,
  type ChecklistTemplateChoice,
  type ChecklistTemplates,
  type DimensionValues,
  type DocumentList,
  type FieldError,
  type FormChoices,
  type FormToFill,
  type Locale,
  type ModuleKey,
  type NewItemRoutePreview as RoutePreviewData,
  type OptionList,
  type RaisableTypes,
  type Scopes,
  type SignedInMember,
  type SupplierChoice,
} from "@rabaed/domain";
import {
  BeforeYouSend,
  Button,
  DiscardDraftDialog,
  DraftWhoSees,
  ErrorState,
  FormRenderer,
  Icon,
  LockedDocuments,
  NewItemFooter,
  NewItemIdentity,
  NewItemRoutePreview,
  NewItemSectionBar,
  NewItemTypeCards,
  RequiredChecklist,
  SubmittalPanel,
  SubmittalPanelGrip,
  SubmittalPanelSections,
  SubmittalPanelSizeSwitch,
  ToastProvider,
  allSubmittalPanelSectionsCollapsed,
  newItemRequired,
  readSubmittalPanelPreferences,
  submittalPanelNormalWidth,
  submittalPanelStorage,
  submittalRoute,
  useMediaQuery,
  useSubmittalPanelIds,
  useSubmittalPanelSize,
  useToast,
  withAllSubmittalPanelSections,
  writeSubmittalPanelPreferences,
  type BuiltInChoices,
  type NewItemRoutePreviewLabels,
  type SubmittalPanelLayout,
  type SubmittalPanelSizeLabels,
} from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link, getPathname, useRouter } from "@/i18n/navigation";
import { fillingChoices } from "@/lib/built-in-choices";
import { useCreateRefusal } from "@/lib/create-refusal";
import { useFormRendererLabels } from "@/lib/form-labels";
import { linkSearch } from "@/lib/link-search";
import {
  afterSaveAnswers,
  canRaise,
  createSubmittalPanelLayout,
  draftStepKey,
  lockedDocumentSections,
  phoneQuery,
  requiredItems,
  savedClock,
  tabletQuery,
  typedSomething,
} from "@/lib/new-submittal-panel";
import { newItemFrom, newSubmittalPanelHref, sizeFrom } from "@/lib/submittal-panel-url";
import { useApiRead } from "@/lib/use-api-read";
import { useDocuments, useImageUrls } from "./use-documents";
import { WorkItemFormProvider, useWorkItemForm } from "./work-item-form";

/**
 * The create panel's parts a Module turns off or on (RP-1152 row 13; RP-1221 Inspections and
 * RP-1222 Snags reuse it). The Submittals use every part and stay on the new Draft after a save.
 */
export type NewSubmittalPanelHooks = {
  /** The route block and the rail's route, from the Type's Workflow (on). */
  routePreview?: boolean;
  /** The side rail of the Wide and Full bands (on); off, the checklist stays in "Before you send". */
  rail?: boolean;
  /** Documents locked until the first save (on); off, the Form's own note stands. */
  documentsLock?: boolean;
  /** After each first save of a Draft: its id and the answers it was saved with. */
  onSaved?: (id: string, answers: Readonly<Record<string, unknown>>) => void;
  /** "stay" (default): the new Draft stays open and autosaves; "clear": the Form empties for the next one, keeping `keep`. */
  afterSave?: "stay" | "clear";
  /** With `afterSave: "clear"`, the fields kept for the next one, e.g. `["trade", "location"]`. */
  keep?: readonly string[];
};

export type NewSubmittalPanelHostProps = NewSubmittalPanelHooks & {
  projectId: string;
  module?: ModuleKey;
  /** The Type the URL names (`&type=`); the first one the viewer may raise when none or not theirs. */
  type: string | null;
  onTypeChange: (code: string) => void;
  onClose: () => void;
  locale: Locale;
  /** Changes when the page's rows are read again: the new Draft's Documents are read again too. */
  refreshKey?: unknown;
};

/**
 * The New work item as a panel over the List and the Kanban (RP-1152, decision 1): the Type
 * cards, the Subject, who sees the Draft, the Form with what it requires, and the route it will
 * take. Save Draft creates it and the panel stays on it: later answers autosave, Documents unlock.
 * Everything is read from the browser through the api's own reads, so it shows exactly what the
 * viewer may see: the Trades and Locations their Visibility covers, the roles of the route only.
 */
export function NewSubmittalPanelHost(props: NewSubmittalPanelHostProps) {
  const t = useTranslations("newSubmittal");
  return (
    // The panel's own toasts: dark, centred over the List (row 38).
    <ToastProvider label={t("notifications")} closeLabel={t("close")} placement="center" look="dark">
      <NewSubmittalPanel {...props} />
    </ToastProvider>
  );
}

/**
 * The create panel's place in the page's URL (`?new=1&type=`, RP-1152): whether it is open, its
 * Type, and opening or closing it. As `?open=` does, the URL changes in place, so the List or the
 * Kanban is not read again, and a reload reopens it.
 */
export function useOpenNewSubmittal() {
  const params = useSearchParams();
  const pathname = usePathname();
  const newItem = newItemFrom(params);
  const show = useCallback(
    (open: Parameters<typeof newSubmittalPanelHref>[2]) => window.history.replaceState(null, "", newSubmittalPanelHref(pathname, window.location.search, open)),
    [pathname],
  );
  return { newItem, open: (open: { type?: string; size?: "wide" } = {}) => show(open), close: () => show(null) };
}

/** "Add Submittal" (row 41): opens the create panel at Wide (row 4), with no page load. The page shows it only to a Member who may raise (decision 6). */
export function AddSubmittalButton({ label }: { label: string }) {
  const { open } = useOpenNewSubmittal();
  return (
    <Button className="h-[34px] px-3.5" onClick={() => open({ size: "wide" })}>
      <Icon name="plus" />
      {label}
    </Button>
  );
}

/** The kept width, as one value (a small read: one short string). */
const keptWidth = () => readSubmittalPanelPreferences(submittalPanelStorage()).width;
const noStorageEvents = () => () => {};

function NewSubmittalPanel({ projectId, module = "submittals", type, onTypeChange, onClose, locale, refreshKey, ...hooks }: NewSubmittalPanelHostProps) {
  const t = useTranslations("newSubmittal");
  const tabs = useTranslations("projectTabs");
  const [attempt, setAttempt] = useState(0);
  const project = `/v1/projects/${encodeURIComponent(projectId)}`;
  const me = useApiRead<SignedInMember>("/v1/me", true, attempt);
  const covered = useApiRead<DimensionValues>(`${project}/visibility`, true, attempt);
  const scopes = useApiRead<Scopes>(`${project}/scopes`, true, attempt);
  const raisable = useApiRead<RaisableTypes>(`${project}/raisable-types${module === "submittals" ? "" : `?module=${module}`}`, true, attempt);
  const people = useApiRead<FormChoices>(`${project}/form-choices`, true, attempt);
  const optionLists = useApiRead<{ optionLists: OptionList[] }>("/v1/option-lists", true, attempt);
  const suppliers = useApiRead<ApprovedSuppliers>(`${project}/approved-suppliers`, true, attempt);
  const templates = useApiRead<ChecklistTemplates>(`${project}/checklist-templates`, true, attempt);
  const chosen = raisable.state === "loaded" ? (raisable.value.types.find((x) => x.code === type) ?? raisable.value.types[0]) : undefined;
  const typePath = chosen ? `${project}/work-item-types/${encodeURIComponent(chosen.code)}` : "";
  // A newer Form Version arrived meanwhile (`form_version_not_latest`): the Form is read again.
  const [formRead, setFormRead] = useState(0);
  const form = useApiRead<FormToFill>(`${typePath}/form`, chosen !== undefined, `${attempt}:${formRead}`);
  const route = useApiRead<RoutePreviewData>(`${typePath}/route-preview`, chosen !== undefined, attempt);

  const layout = createSubmittalPanelLayout({ phone: useMediaQuery(phoneQuery, false), tablet: useMediaQuery(tabletQuery, false) });
  // The link's size, never kept as the viewer's own (README §2); otherwise the kept width.
  const linkSize = sizeFrom(useSearchParams());
  const kept = useSyncExternalStore(noStorageEvents, keptWidth, () => null);
  const size = useSubmittalPanelSize({
    initial: linkSize ?? kept ?? submittalPanelNormalWidth,
    dir: directionOf(locale),
    onKeep: linkSize === null ? (width) => writeSubmittalPanelPreferences(submittalPanelStorage(), { width }) : undefined,
  });
  const tp = useTranslations("submittalPanel");
  const sizeLabels: SubmittalPanelSizeLabels = {
    group: tp("size.group"),
    sizes: { compact: tp("size.compact"), normal: tp("size.normal"), wide: tp("size.wide"), full: tp("size.full") },
    grip: tp("size.grip"),
  };
  const crumb = chosen ? t("crumb", { type: chosen.name[locale] }) : t("crumbNoType");
  const frame: Frame = (content) => (
    <SubmittalPanel
      locale={locale}
      labels={{ module: tabs(module), position: () => "", previous: "", next: "", close: t("close"), hint: "", back: t("back") }}
      mode="create"
      layout={layout}
      crumb={crumb}
      onClose={content.onCloseOverride ?? onClose}
      width={size.width}
      resizing={size.resizing}
      edge={<SubmittalPanelGrip size={size} locale={locale} labels={sizeLabels} />}
      topBarEnd={<SubmittalPanelSizeSwitch size={size} labels={sizeLabels} />}
      label={content.label}
      labelledBy={content.labelledBy}
      busy={content.busy}
      identity={content.identity}
      rail={content.rail}
      actions={content.actions}
    >
      {content.children}
    </SubmittalPanel>
  );

  const required = [me, covered, scopes, raisable, people] as const;
  if (required.some((r) => r.state === "failed") || form.state === "failed" || (hooks.routePreview !== false && route.state === "failed" && chosen)) {
    // A Member who may raise no Type reads no Form and no route: that is the empty state, not a failure.
    if (raisable.state !== "loaded" || raisable.value.types.length > 0) {
      return frame({
        label: t("unavailable"),
        children: (
          <ErrorState
            title={t("unavailable")}
            className="m-5"
            action={
              <Button variant="secondary" size="sm" onClick={() => setAttempt((a) => a + 1)}>
                {t("tryAgain")}
              </Button>
            }
          />
        ),
      });
    }
  }
  if (raisable.state === "loaded" && covered.state === "loaded" && !canRaise(raisable.value, covered.value)) {
    // Decision 6: no Type to raise, or no Trade covered.
    return frame({
      label: t("cantRaise"),
      children: (
        <div className="flex flex-col items-start gap-3 px-5 py-8">
          <p className="text-[15px] font-semibold">{t("cantRaise")}</p>
          <p className="text-sm text-muted">{t("cantRaiseBody")}</p>
          <Button variant="secondary" onClick={onClose}>
            {t("backToList")}
          </Button>
        </div>
      ),
    });
  }
  const ready =
    me.state === "loaded" &&
    covered.state === "loaded" &&
    scopes.state === "loaded" &&
    raisable.state === "loaded" &&
    people.state === "loaded" &&
    form.state === "loaded" &&
    chosen !== undefined &&
    (hooks.routePreview === false || route.state === "loaded");
  if (!ready) {
    return frame({
      label: t("loading"),
      busy: true,
      children: (
        <p role="status" className="px-5 py-8 text-sm text-muted">
          {t("loading")}
        </p>
      ),
    });
  }
  return (
    <DraftRounds
      key={`${chosen.code}`}
      frame={frame}
      projectId={projectId}
      locale={locale}
      types={raisable.value.types}
      typeCode={chosen.code}
      onTypeChange={onTypeChange}
      form={form.value}
      route={hooks.routePreview === false || route.state !== "loaded" ? null : route.value}
      companyName={me.value.company.legalName[locale]}
      choices={fillingChoices(covered.value, scopes.value.scopes, locale)}
      startTradeId={defaultTradeId(form.value.schema, covered.value.trade)}
      people={people.value}
      optionLists={optionLists.state === "loaded" ? optionLists.value.optionLists : []}
      suppliers={suppliers.state === "loaded" ? suppliers.value.suppliers.map((s) => ({ id: s.id, tradeId: s.tradeId, status: s.status, name: s.name })) : []}
      checklistTemplates={templates.state === "loaded" ? checklistTemplateChoices(templates.value.templates) : []}
      layout={layout}
      onNewVersion={() => setFormRead((n) => n + 1)}
      onClose={onClose}
      refreshKey={refreshKey}
      {...hooks}
    />
  );
}

type Frame = (content: {
  label?: string;
  busy?: boolean;
  identity?: ReactNode;
  rail?: ReactNode;
  actions?: ReactNode;
  labelledBy?: string;
  onCloseOverride?: () => void;
  children: ReactNode;
}) => ReactNode;

type DraftProps = NewSubmittalPanelHooks & {
  frame: Frame;
  projectId: string;
  locale: Locale;
  types: RaisableTypes["types"];
  typeCode: string;
  onTypeChange: (code: string) => void;
  form: FormToFill;
  route: RoutePreviewData | null;
  companyName: string;
  choices: BuiltInChoices;
  startTradeId: string | undefined;
  people: FormChoices;
  optionLists: readonly OptionList[];
  suppliers: readonly SupplierChoice[];
  checklistTemplates: readonly ChecklistTemplateChoice[];
  onNewVersion: () => void;
  onClose: () => void;
  refreshKey?: unknown;
  layout: SubmittalPanelLayout;
};

/** One Draft after another: with `afterSave: "clear"`, a save starts the next one, keeping the `keep` answers. */
function DraftRounds(props: DraftProps) {
  const [round, setRound] = useState<{ n: number; start: Record<string, unknown> }>({ n: 0, start: props.startTradeId ? { trade: props.startTradeId } : {} });
  return (
    <WorkItemFormProviderFor key={round.n} {...props} start={round.start} onCleared={(start) => setRound((r) => ({ n: r.n + 1, start }))} />
  );
}

/** The Form's state is the item page's own (`WorkItemFormProvider`): once the Draft exists, its answers autosave with `PUT /answers`. */
function WorkItemFormProviderFor(props: DraftProps & { start: Record<string, unknown>; onCleared: (start: Record<string, unknown>) => void }) {
  const [created, setCreated] = useState<{ id: string; at: string } | null>(null);
  return (
    <WorkItemFormProvider
      // Until the first save there is no item: nothing autosaves, and Save Draft creates it.
      workItemId={created?.id ?? ""}
      projectId={props.projectId}
      documentNumber={null}
      linkTargets={{}}
      hiddenLinks={{}}
      schema={props.form.schema}
      choices={props.choices}
      answers={props.start}
      named={{}}
      people={props.people}
      optionLists={props.optionLists}
      suppliers={props.suppliers}
      checklistTemplates={props.checklistTemplates}
      editable
      editableSections={props.form.editableSections}
      fieldTimes={{}}
      autosave={created !== null}
    >
      <DraftSubmittalPanel {...props} created={created} onCreated={setCreated} />
    </WorkItemFormProvider>
  );
}

function DraftSubmittalPanel({
  frame,
  projectId,
  locale,
  types,
  typeCode,
  onTypeChange,
  form,
  route,
  companyName,
  start,
  created,
  onCreated,
  onCleared,
  onNewVersion,
  onClose,
  refreshKey,
  layout,
  routePreview = true,
  rail = true,
  documentsLock = true,
  onSaved,
  afterSave = "stay",
  keep,
}: DraftProps & {
  start: Record<string, unknown>;
  created: { id: string; at: string } | null;
  onCreated: (created: { id: string; at: string }) => void;
  onCleared: (start: Record<string, unknown>) => void;
}) {
  const t = useTranslations("newSubmittal");
  const formLabels = useFormRendererLabels();
  const refusal = useCreateRefusal();
  const router = useRouter();
  const toast = useToast();
  const ids = useSubmittalPanelIds();
  const state = useWorkItemForm()!;
  const [subject, setSubject] = useState("");
  const [subjectMissing, setSubjectMissing] = useState(false);
  // A missing Trade is marked when the Draft is saved, not while the Form is being filled (as the New page did).
  const [requiredMarked, setRequiredMarked] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [discarding, setDiscarding] = useState(false);
  // The new Draft's Documents (decision 8): read once it exists, and again whenever the page is read again (an upload refreshes it).
  const [filesRead, setFilesRead] = useState(0);
  const documents = useApiRead<DocumentList>(`/v1/work-items/${created?.id ?? ""}/documents`, created !== null, `${String(filesRead)}:${refreshKeyId(refreshKey)}`);
  const docs = documents.state === "loaded" ? documents.value : null;
  const files = useDocuments(created?.id ?? "", docs?.limits ?? { maxBytes: 1, contentTypes: [] }, { onChanged: () => setFilesRead((n) => n + 1) });
  const imageUrls = useImageUrls(created?.id ?? "", docs?.documents.filter((d) => d.contentType.startsWith("image/")) ?? []);
  const schema = form.schema;
  const tradeKey = formFields(schema).find((f) => f.type === "trade")?.key;
  const items = requiredItems({
    schema,
    answers: state.answers,
    subject,
    subjectLabel: t("subject"),
    filedFields: new Set(docs?.documents.flatMap((d) => (d.fieldKey === null ? [] : [d.fieldKey])) ?? []),
    locale,
  });
  const locked = documentsLock && created === null ? new Map(lockedDocumentSections(schema, locale).map((s) => [s.sectionKey, s.slots])) : new Map();
  const shownSections = schema.sections.filter((s) => formVisibility(schema, state.answers).sections.has(s.key)).map((s) => s.key);
  const allFolded = allSubmittalPanelSectionsCollapsed(shownSections, collapsed);
  const typed = typedSomething({ subject, answers: state.answers, start });

  const close = () => (created === null && typed ? setDiscarding(true) : onClose());

  async function create() {
    const answers = formVisibility(schema, state.answers).answers;
    const missing: FieldError[] = tradeKey !== undefined && isUnanswered(answers[tradeKey]) ? [{ key: tradeKey, code: "required" }] : [];
    setSubjectMissing(subject.trim() === "");
    // A Draft needs a Subject and a Trade (row 26): they are marked, not refused.
    if (subject.trim() === "" || missing.length > 0) {
      if (missing.length > 0) {
        setRequiredMarked(true);
        state.showErrors(missing, t("tradeMissing"));
      }
      setError(subject.trim() === "" ? t("subjectMissing") : t("tradeMissing"));
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/work-items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Hidden fields' answers are cleared on save, here as on the server.
        body: JSON.stringify({ type: typeCode, title: subject.trim(), answers }),
      });
      if (res.status === 201) {
        const { id } = (await res.json()) as { id: string };
        toast({ title: t("toast"), tone: "success" });
        // The List is read again once, so the new Draft shows.
        router.refresh();
        onSaved?.(id, answers);
        if (afterSave === "clear") return onCleared(afterSaveAnswers(answers, { mode: "clear", keep }));
        onCreated({ id, at: new Date().toISOString() });
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; fields?: FieldError[] };
      const message = refusal(body.error);
      if (body.error === "invalid_answers" && body.fields) state.showErrors(body.fields, message);
      setError(message);
      // A newer Form Version, or other choices, arrived meanwhile: show them.
      if (body.error === "form_version_not_latest" || body.error === "value_not_found") {
        onNewVersion();
        router.refresh();
      }
    } catch {
      setError(t("unavailable"));
    } finally {
      setCreating(false);
    }
  }
  // After the first save, Save Draft saves now (row 39); autosave runs too.
  const save = () => void (created === null ? create() : state.save(false));
  const savedAt = created === null ? null : savedClock(state.savedAt ?? created.at, locale);

  const routeView =
    routePreview && route
      ? (() => {
          const stepKey = draftStepKey(route);
          const shown = submittalRoute({ definition: route.definition, stages: route.stages, position: stepKey === null ? null : { kind: "own", stepKey } });
          const labels: NewItemRoutePreviewLabels = {
            role: (role) => t(`roles.${role}`),
            route: t("workflow"),
            now: t("now"),
            review: (role) => t("review", { role: t(`roles.${role}`) }),
            private: t("private"),
            outcome: t("outcome"),
          };
          return <NewItemRoutePreview locale={locale} route={shown} labels={labels} heading={t("workflow")} />;
        })()
      : null;
  const draftsVisibleTo = route?.draftsVisibleTo ?? null;
  const whoSees = { author: t("onlyYou"), company: t("onlyCompany"), heading: t("whoSees") };
  const checklist = (incomplete: boolean) => <RequiredChecklist locale={locale} heading={t("required")} items={items} incomplete={incomplete ? t("incomplete") : undefined} />;

  return (
    <>
      {frame({
        labelledBy: ids.numberId,
        onCloseOverride: close,
        identity: (
          <NewItemIdentity
            noNumber={t("noNumber")}
            draft={t("draft")}
            subject={subject}
            onSubjectChange={(value) => {
              setSubject(value);
              if (value.trim() !== "") setSubjectMissing(false);
            }}
            subjectLabel={t("subject")}
            placeholder={t("subjectPlaceholder")}
            numberId={ids.numberId}
            invalid={subjectMissing}
            readOnly={created !== null}
          >
            {/* Switching Type before the first save swaps the Form; after it, the Type is the Draft's. */}
            <NewItemTypeCards
              locale={locale}
              heading={t("types")}
              types={created === null ? types : types.filter((x) => x.code === typeCode)}
              value={typeCode}
              onChange={(code) => code !== typeCode && created === null && onTypeChange(code)}
            />
            <DraftWhoSees look="banner" draftsVisibleTo={draftsVisibleTo} companyName={companyName} labels={whoSees} />
          </NewItemIdentity>
        ),
        rail: rail && (
          <>
            {checklist(true)}
            {routeView}
            <DraftWhoSees look="box" draftsVisibleTo={draftsVisibleTo} companyName={companyName} labels={whoSees} />
          </>
        ),
        actions: (
          <NewItemFooter
            layout={layout === "page" ? "page" : "slide-over"}
            savedAt={savedAt}
            openHref={created ? getPathname({ href: `/work-items/${created.id}`, locale }) : undefined}
            onCancel={close}
            onSave={save}
            saving={creating || state.pending}
            labels={{ notSaved: t("notSaved"), saved: (time) => t("saved", { time }), cancel: t("cancel"), saveDraft: t("saveDraft"), openPage: t("openPage") }}
          />
        ),
        children: (
          <>
            <NewItemSectionBar
              locale={locale}
              sections={shownSections.length}
              required={newItemRequired(items)}
              labels={{ summary: (sections, done, total) => t("sections", { sections, done, total }), collapseAll: t("collapseAll"), expandAll: t("expandAll") }}
              allCollapsed={allFolded}
              onToggleAll={() => setCollapsed(withAllSubmittalPanelSections(shownSections, collapsed, !allFolded))}
            />
            {/* Where the rail is hidden (Normal, Compact, tablet, phone), or off: the checklist and the route in the flow (row 12). */}
            <div className={rail ? "px-5 pb-2 @[880px]/sdp:px-7" : "px-5 pb-2 @[880px]/sdp:px-7 [&_.sdp-inflow]:!block"}>
              <BeforeYouSend
                heading={t("before")}
                checklist={checklist(false)}
                route={routeView ?? undefined}
                open={!allFolded}
                onOpenChange={(open) => setCollapsed(withAllSubmittalPanelSections(shownSections, collapsed, !open))}
              />
            </div>
            <FormRenderer
              schema={schema}
              answers={state.answers}
              errors={created === null && !requiredMarked ? state.errors.filter((e) => e.code !== "required") : state.errors}
              mode="edit"
              editableSections={form.editableSections}
              locale={locale}
              labels={formLabels}
              choices={state.choices}
              people={state.people}
              optionLists={state.optionLists}
              suppliers={state.suppliers}
              checklistTemplates={state.checklistTemplates}
              onChange={(changes) => {
                state.change(changes);
                setError(null);
              }}
              idPrefix="answer"
              links={{ targets: {}, search: linkSearch(projectId), hrefFor: (choice) => (typeof choice === "string" ? `/work-items/${choice}` : null), linkAs: Link }}
              {...(created && docs
                ? {
                    // Decision 8: the Form's Documents fields are the new item's own upload fields, as on its page.
                    files: {
                      documents: docs.documents,
                      canChange: docs.canChange,
                      pending: files.pending,
                      imageUrls,
                      onUpload: (fieldKey: string, picked: File[], itemKey?: string) => void files.upload(picked, fieldKey, itemKey),
                      onOpen: (documentId: string) => void files.open(documentId),
                      onRemove: (fieldKey: string, documentId: string, itemKey?: string) => void files.remove(documentId, fieldKey, itemKey),
                      onSaveAnnotated: files.annotatesIn(docs.documents),
                    },
                  }
                : {})}
              sectionsAs={(sections) => (
                <SubmittalPanelSections
                  locale={locale}
                  controls={false}
                  labels={{ count: (n) => n, collapseAll: t("collapseAll"), expandAll: t("expandAll") }}
                  collapsed={collapsed}
                  onCollapsedChange={setCollapsed}
                  sections={sections.map((section) => {
                    const slots = locked.get(section.key);
                    return {
                      key: section.key,
                      icon: "file-text" as const,
                      title: section.title,
                      summary: section.summary ?? t("nothing"),
                      children: slots ? <LockedDocuments labels={{ locked: t("locked"), add: t("add") }} slots={slots} /> : section.content,
                    };
                  })}
                />
              )}
            />
            {error ? (
              <p role="alert" className="px-5 pt-3 text-sm text-danger-fg @[880px]/sdp:px-7">
                {error}
              </p>
            ) : (
              (state.message ?? files.message) && (
                // An autosave's or an upload's word, e.g. a refused file.
                <p role="status" className="px-5 pt-3 text-sm text-muted @[880px]/sdp:px-7">
                  {state.message ?? files.message}
                </p>
              )
            )}
          </>
        ),
      })}
      <DiscardDraftDialog
        open={discarding}
        onOpenChange={setDiscarding}
        onDiscard={onClose}
        labels={{ title: t("discardTitle"), description: t("discardBody"), discard: t("discard"), keep: t("keep"), close: t("close") }}
      />
    </>
  );
}

/** A changing key as a stable string: the page's rows object is compared by identity. */
const seen = new WeakMap<object, number>();
let next = 0;
function refreshKeyId(key: unknown): string {
  if (typeof key !== "object" || key === null) return String(key);
  if (!seen.has(key)) seen.set(key, next++);
  return String(seen.get(key));
}
