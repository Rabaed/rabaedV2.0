"use client";

import {
  formatNumber,
  isOutcomesAndStages,
  outcomesAndStagesList,
  type BilingualText,
  type Locale,
  type WorkflowSettings,
  type WorkflowSettingsType,
  type WorkflowSettingsWorkflow,
} from "@rabaed/domain";
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  Field,
  Icon,
  Input,
  RowActionsMenu,
  Select,
  SettingsSection,
  type RowActionsItem,
} from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { SaveToLibraryAction } from "@/components/save-to-library-action";
import { Link, useRouter } from "@/i18n/navigation";
import { refusalMessage, setupCall, type SetupResult } from "@/lib/setup-call";
import { copyIntoProject } from "@/lib/copy-into-project";

type Props = {
  projectId: string;
  settings: WorkflowSettings;
  /** What a copy's name ends with, in each language, whichever the viewer reads: the name is kept in both. */
  copySuffix: BilingualText;
  /** Their Company's Authorized Person: only they save a Workflow to the Library (RP-442). */
  isAuthorizedPerson: boolean;
  /** The Participants a Project Admin may set an exception for (V15: every one for them), by name in the viewer's language. */
  participants: { id: string; name: string }[];
};

type Dialogs =
  | { kind: "library" | "exception" | "back"; type: WorkflowSettingsType }
  // `source`: one of the Type's other Rabaed Defaults to copy (RP-596), else the Workflow the Type runs.
  | { kind: "duplicate"; type: WorkflowSettingsType; source?: WorkflowSettingsWorkflow }
  | null;

const cell = "px-5 py-3 align-top";
const head = "border-b border-border-subtle bg-surface-subtle px-5 py-2.5 text-start text-caption font-semibold whitespace-nowrap text-muted";

/**
 * Project → Settings → Workflows (RP-441, WF-18; design `settings-workflows.html`, the
 * Types a Workflow is attached to): one row per Work Item Type with the Workflow its new
 * items run, its Version, whether it is the Rabaed Default or the Project's copy, and its
 * exceptions. Project Admins duplicate and edit, use a Library Workflow, add or remove an
 * exception for a Participant, and go back to the Rabaed Default; everyone else reads
 * (V20), the exceptions only their own Participant's (V15). Every write is WF-4's command.
 */
export function WorkflowSettingsView({ projectId, settings, participants, copySuffix, isAuthorizedPerson }: Props) {
  const t = useTranslations("projectSettings.workflows");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const base = `/projects/${projectId}/settings/workflows`;

  const typeName = (type: WorkflowSettingsType) => `${type.code} · ${type.name[locale]}`;

  /** Binds `workflowId` as the Type's Workflow, or an exception for one Participant. */
  const bind = (type: WorkflowSettingsType, workflowId: string, raisingParticipantId: string | null) =>
    setupCall("PUT", `/projects/${projectId}/workflow-bindings`, { workItemTypeId: type.id, raisingParticipantId, workflowId });

  const menu = (type: WorkflowSettingsType): RowActionsItem[] => [
    ...(settings.library.some((l) => l.workItemTypeId === type.id)
      ? [{ key: "library", label: t("useLibrary"), icon: "building" as const, onSelect: () => setDialog({ kind: "library", type }) }]
      : []),
    { key: "exception", label: t("addException"), icon: "briefcase", onSelect: () => setDialog({ kind: "exception", type }) },
    { key: "versions", label: t("viewVersions"), icon: "git-branch", onSelect: () => router.push(`${base}/${type.workflow.id}/versions/${type.workflow.versionNo ?? 1}`) },
    ...(type.workflow.source === "project_copy"
      ? [{ key: "back", label: t("backToDefault"), icon: "arrow-back-up" as const, onSelect: () => setDialog({ kind: "back", type }), separated: true }]
      : []),
  ];

  // Back on a Rabaed Default whose latest Version uses an outcome or Stage this Project lacks (RP-566): which ones.
  const errorText = (error: string, body?: unknown) =>
    error === "default_lacks_entries" && isOutcomesAndStages(body)
      ? t("errors.defaultLacks", { entries: outcomesAndStagesList(body, locale) })
      : refusalMessage(t, {
          invalid_name: "invalidName",
          stage_missing: "stageMissing",
          workflow_name_names_participant: "namesParticipant",
          workflow_not_published: "notPublished",
          workflow_not_for_type: "notForType",
          workflow_problems: "problems",
        }, error);

  const done = (message?: string) => {
    setDialog(null);
    if (message) setNotice(message);
    router.refresh();
  };

  const removeException = async (type: WorkflowSettingsType, participantId: string) => {
    const res = await setupCall("DELETE", `/projects/${projectId}/workflow-bindings?workItemTypeId=${type.id}&raisingParticipantId=${participantId}`);
    if (res.ok) done(t("exceptionRemoved"));
    else setNotice(errorText(res.error, res.body));
  };

  return (
    <>
      <SettingsSection
        title={t("typesTitle")}
        description={t("typesIntro")}
        bodyClassName="px-0 pt-[14px] pb-0"
        data-testid="workflow-types"
      >
        {notice && (
          <p role="status" className="mx-5 -mt-1 mb-3 flex items-center gap-2 rounded-md bg-brand-tint px-3 py-2 text-sm text-brand-fg">
            <Icon name="info-circle" size={16} />
            {notice}
          </p>
        )}
        <div role="region" aria-label={t("typesTitle")} tabIndex={0} className="relative overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus">
          <table className="w-full min-w-[40rem] border-collapse text-[13.5px]">
            <thead>
              <tr>
                <th scope="col" className={head}>{t("colType")}</th>
                <th scope="col" className={head}>{t("colWorkflow")}</th>
                <th scope="col" className={head}>{t("colExceptions")}</th>
                {(settings.canEdit || isAuthorizedPerson) && (
                  <th scope="col" className={head}>
                    <span className="sr-only">{t("colActions")}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {settings.types.map((type) => (
                <tr key={type.id} className="border-b border-border-subtle last:border-b-0" data-testid="workflow-type-row">
                  <th scope="row" className={`${cell} min-w-44 text-start font-normal`}>
                    <span className="flex flex-col gap-0.5">
                      <bdi dir="ltr" translate="no" className="w-fit rounded-[5px] bg-segment-participant-tint px-1.5 py-px text-caption font-bold text-segment-participant-fg">
                        {type.code}
                      </bdi>
                      <span className="font-semibold text-text">{type.name[locale]}</span>
                    </span>
                  </th>
                  <td className={`${cell} min-w-44`}>
                    <span className="flex flex-col items-start gap-1.5">
                      <span className="font-semibold text-text">{type.workflow.name[locale]}</span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={type.workflow.source === "rabaed_default" ? "neutral" : "brand"}>
                          {type.workflow.source === "rabaed_default" ? t("sourceDefault") : t("sourceCopy")}
                        </Badge>
                        {type.workflow.versionNo !== null && <span className="text-muted">{t("version", { n: formatNumber(type.workflow.versionNo, locale) })}</span>}
                      </span>
                    </span>
                  </td>
                  <td className={`${cell} min-w-40`}>
                    {type.exceptions.length === 0 ? (
                      <span className="text-muted">{t("noExceptions")}</span>
                    ) : (
                      <ul className="flex flex-col gap-1.5">
                        {type.exceptions.map((e) => (
                          <li key={e.participantId} className="flex items-start gap-2">
                            <span className="min-w-0 flex-1">
                              <span className="font-semibold text-text">{e.companyName[locale]}</span>
                              <span className="text-muted">: </span>
                              <span>{e.workflow.name[locale]}</span>
                            </span>
                            {settings.canEdit && (
                              <button
                                type="button"
                                aria-label={t("removeException", { company: e.companyName[locale] })}
                                title={t("removeException", { company: e.companyName[locale] })}
                                onClick={() => void removeException(type, e.participantId)}
                                className="shrink-0 rounded-sm p-0.5 text-muted hover:bg-canvas hover:text-danger-fg focus-visible:outline-2 focus-visible:outline-focus pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                              >
                                <Icon name="x" size={14} />
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  {(settings.canEdit || isAuthorizedPerson) && (
                    <td className={`${cell} whitespace-nowrap`}>
                      <span className="flex flex-col items-end gap-1.5">
                        {settings.canEdit && (
                          <span className="flex items-center gap-1.5">
                            <Button variant="secondary" size="sm" onClick={() => setDialog({ kind: "duplicate", type })}>
                              <Icon name="copy" size={15} />
                              {t("duplicateEdit")}
                            </Button>
                            <RowActionsMenu label={t("actionsFor", { type: typeName(type) })} items={menu(type)} />
                          </span>
                        )}
                        <SaveToLibraryAction workflowId={type.workflow.id} name={type.workflow.name} isAuthorizedPerson={isAuthorizedPerson} />
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsSection>

      <RabaedDefaultsSection
        types={settings.types}
        base={base}
        canEdit={settings.canEdit}
        onBind={bind}
        onDuplicate={(type, source) => setDialog({ kind: "duplicate", type, source })}
        onDone={done}
        onError={(e) => setNotice(errorText(e))}
      />

      {settings.canEdit && <CopiesSection types={settings.types} base={base} onBind={bind} onDone={done} onError={(e) => setNotice(errorText(e))} />}

      {dialog?.kind === "duplicate" && (
        <DuplicateDialog
          projectId={projectId}
          copySuffix={copySuffix}
          source={dialog.source ?? dialog.type.workflow}
          errorText={errorText}
          onClose={() => setDialog(null)}
          onCreated={(id) => router.push(`${base}/${id}`)}
        />
      )}
      {dialog?.kind === "library" && (
        <LibraryDialog
          projectId={projectId}
          type={dialog.type}
          library={settings.library.filter((l) => l.workItemTypeId === dialog.type.id)}
          errorText={errorText}
          onClose={() => setDialog(null)}
          onCreated={(id) => router.push(`${base}/${id}`)}
        />
      )}
      {dialog?.kind === "exception" && (
        <ExceptionDialog
          type={dialog.type}
          participants={participants}
          bind={bind}
          errorText={errorText}
          onClose={() => setDialog(null)}
          onDone={() => done(t("exceptionAdded"))}
        />
      )}
      {dialog?.kind === "back" && (
        <BackDialog
          projectId={projectId}
          type={dialog.type}
          errorText={errorText}
          onClose={() => setDialog(null)}
          onDone={() => done(t("backDone", { type: typeName(dialog.type) }))}
        />
      )}
    </>
  );
}

/**
 * The Rabaed Default Workflows of the Types that have several (RP-596: the eight submittal
 * Workflows, 1 or 2 reviewers on each side, with and without the Owner's review): everyone reads
 * them and the one each Type runs; Project Admins use one for the Type or duplicate it to edit.
 * Nothing is shown while no Type has more than one.
 */
function RabaedDefaultsSection({
  types,
  base,
  canEdit,
  onBind,
  onDuplicate,
  onDone,
  onError,
}: {
  types: WorkflowSettingsType[];
  base: string;
  canEdit: boolean;
  onBind: (type: WorkflowSettingsType, workflowId: string, participantId: string | null) => Promise<SetupResult>;
  onDuplicate: (type: WorkflowSettingsType, source: WorkflowSettingsWorkflow) => void;
  onDone: (message?: string) => void;
  onError: (error: string) => void;
}) {
  const t = useTranslations("projectSettings.workflows");
  const locale = useLocale() as Locale;
  const several = types.filter((type) => type.rabaedDefaults.length > 1);
  if (several.length === 0) return null;
  return (
    <SettingsSection title={t("defaultsTitle")} description={t("defaultsIntro")} bodyClassName="px-0 pt-[14px] pb-0" data-testid="workflow-rabaed-defaults">
      <div role="region" aria-label={t("defaultsTitle")} tabIndex={0} className="relative overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus">
        <table className="w-full min-w-[44rem] border-collapse text-[13.5px]">
          <thead>
            <tr>
              <th scope="col" className={head}>{t("colWorkflow")}</th>
              <th scope="col" className={head}>{t("colType")}</th>
              <th scope="col" className={head}>{t("colState")}</th>
              {canEdit && (
                <th scope="col" className={head}>
                  <span className="sr-only">{t("colActions")}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {several.flatMap((type) =>
              type.rabaedDefaults.map((workflow) => (
                <tr key={`${type.id}-${workflow.id}`} className="border-b border-border-subtle last:border-b-0" data-testid="workflow-rabaed-default-row">
                  <th scope="row" className={`${cell} min-w-96 text-start font-semibold text-text`}>{workflow.name[locale]}</th>
                  <td className={cell}>
                    <bdi dir="ltr" translate="no" className="rounded-[5px] bg-segment-participant-tint px-1.5 py-px text-caption font-bold text-segment-participant-fg">
                      {type.code}
                    </bdi>
                  </td>
                  <td className={cell}>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {workflow.versionNo !== null && <Badge tone="success">{t("publishedVersion", { n: formatNumber(workflow.versionNo, locale) })}</Badge>}
                      {workflow.bound && <Badge tone="brand">{t("inUse")}</Badge>}
                      {workflow.isTypeDefault && <Badge tone="neutral">{t("sourceDefault")}</Badge>}
                    </span>
                  </td>
                  {canEdit && (
                    <td className={`${cell} whitespace-nowrap`}>
                      <span className="flex items-center justify-end gap-1.5">
                        {workflow.versionNo !== null && !workflow.bound && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={async () => {
                              const res = await onBind(type, workflow.id, null);
                              if (res.ok) onDone(t("copyUsed", { type: type.code }));
                              else onError(res.error);
                            }}
                          >
                            {t("useFor", { type: type.code })}
                          </Button>
                        )}
                        <Button variant="secondary" size="sm" onClick={() => onDuplicate(type, workflow)}>
                          <Icon name="copy" size={15} />
                          {t("duplicateEdit")}
                        </Button>
                        {workflow.versionNo !== null && (
                          <Link
                            href={`${base}/${workflow.id}/versions/${workflow.versionNo}`}
                            className="inline-flex h-8 items-center rounded-sm px-3 text-sm font-medium text-brand-fg hover:bg-brand-tint focus-visible:outline-2 focus-visible:outline-focus"
                          >
                            {t("viewVersions")}
                          </Link>
                        )}
                      </span>
                    </td>
                  )}
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </SettingsSection>
  );
}

/** The Project's own Workflows: continue editing a copy, use a published one for its Type, read its Versions. */
function CopiesSection({
  types,
  base,
  onBind,
  onDone,
  onError,
}: {
  types: WorkflowSettingsType[];
  base: string;
  onBind: (type: WorkflowSettingsType, workflowId: string, participantId: string | null) => Promise<SetupResult>;
  onDone: (message?: string) => void;
  onError: (error: string) => void;
}) {
  const t = useTranslations("projectSettings.workflows");
  const locale = useLocale() as Locale;
  const rows = types.flatMap((type) => type.copies.map((copy) => ({ type, copy })));
  return (
    <SettingsSection title={t("copiesTitle")} description={t("copiesIntro")} bodyClassName="px-0 pt-[14px] pb-0" data-testid="workflow-copies">
      {rows.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted">{t("noCopies")}</p>
      ) : (
        <div role="region" aria-label={t("copiesTitle")} tabIndex={0} className="relative overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus">
          <table className="w-full min-w-[44rem] border-collapse text-[13.5px]">
            <thead>
              <tr>
                <th scope="col" className={head}>{t("colWorkflow")}</th>
                <th scope="col" className={head}>{t("colType")}</th>
                <th scope="col" className={head}>{t("colState")}</th>
                <th scope="col" className={head}>
                  <span className="sr-only">{t("colActions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ type, copy }) => (
                <tr key={copy.id} className="border-b border-border-subtle last:border-b-0" data-testid="workflow-copy-row">
                  <th scope="row" className={`${cell} text-start font-semibold text-text`}>{copy.name[locale]}</th>
                  <td className={cell}>
                    <bdi dir="ltr" translate="no" className="rounded-[5px] bg-segment-participant-tint px-1.5 py-px text-caption font-bold text-segment-participant-fg">
                      {type.code}
                    </bdi>
                  </td>
                  <td className={cell}>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {copy.versionNo === null ? <Badge tone="warning">{t("notPublished")}</Badge> : <Badge tone="success">{t("publishedVersion", { n: formatNumber(copy.versionNo, locale) })}</Badge>}
                      {copy.bound && <Badge tone="brand">{t("inUse")}</Badge>}
                      {copy.hasDraft && copy.versionNo !== null && <Badge tone="neutral">{t("draftChanges")}</Badge>}
                    </span>
                  </td>
                  <td className={`${cell} whitespace-nowrap`}>
                    <span className="flex items-center justify-end gap-1.5">
                      {copy.versionNo !== null && !copy.bound && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={async () => {
                            const res = await onBind(type, copy.id, null);
                            if (res.ok) onDone(t("copyUsed", { type: type.code }));
                            else onError(res.error);
                          }}
                        >
                          {t("useFor", { type: type.code })}
                        </Button>
                      )}
                      {copy.versionNo !== null && (
                        <Link
                          href={`${base}/${copy.id}/versions/${copy.versionNo}`}
                          className="inline-flex h-8 items-center rounded-sm px-3 text-sm font-medium text-brand-fg hover:bg-brand-tint focus-visible:outline-2 focus-visible:outline-focus"
                        >
                          {t("viewVersions")}
                        </Link>
                      )}
                      <Link
                        href={`${base}/${copy.id}`}
                        className="inline-flex h-8 items-center rounded-sm px-3 text-sm font-medium text-brand-fg hover:bg-brand-tint focus-visible:outline-2 focus-visible:outline-focus"
                      >
                        {t("edit")}
                      </Link>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SettingsSection>
  );
}

/** A dialog with a form: submit runs `onSubmit`, which says why it was refused or closes the dialog. */
function FormDialog({
  title,
  description,
  submitLabel,
  onClose,
  onSubmit,
  disabled,
  children,
}: {
  title: string;
  description?: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: () => Promise<string | null>;
  disabled?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("projectSettings.workflows");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={title} description={description} closeLabel={t("close")}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            const refused = await onSubmit();
            setBusy(false);
            if (refused !== null) setError(refused);
          }}
        >
          {children}
          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-tint px-3 py-2 text-sm text-danger-fg">
              <Icon name="alert-circle" size={16} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{t("cancel")}</Button>
            </DialogClose>
            <Button type="submit" disabled={busy || disabled}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Duplicate and edit": a copy of the Type's Workflow in this Project, named in both languages, opened in the builder. */
function DuplicateDialog({
  projectId,
  copySuffix,
  source,
  errorText,
  onClose,
  onCreated,
}: {
  projectId: string;
  copySuffix: BilingualText;
  /** The Workflow copied: the Type's running one, or one of its other Rabaed Defaults. */
  source: WorkflowSettingsWorkflow;
  errorText: (error: string, body?: unknown) => string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const t = useTranslations("projectSettings.workflows");
  const locale = useLocale() as Locale;
  const [name, setName] = useState<BilingualText>({
    en: `${source.name.en} ${copySuffix.en}`,
    ar: `${source.name.ar} ${copySuffix.ar}`,
  });
  return (
    <FormDialog
      title={t("duplicateTitle", { workflow: source.name[locale] })}
      description={t("duplicateHelp")}
      submitLabel={t("duplicateSubmit")}
      onClose={onClose}
      disabled={name.en.trim() === "" || name.ar.trim() === ""}
      onSubmit={async () => {
        const copy = await copyIntoProject(source.id, projectId, name);
        if (copy.ok) {
          onCreated(copy.id);
          return null;
        }
        return [errorText(copy.error), ...copy.problems.map((p) => p.message[locale])].join(" ");
      }}
    >
      <Field label={t("nameEn")} required>
        <Input value={name.en} dir="ltr" onChange={(e) => setName({ ...name, en: e.target.value })} maxLength={120} />
      </Field>
      <Field label={t("nameAr")} required>
        <Input value={name.ar} dir="rtl" onChange={(e) => setName({ ...name, ar: e.target.value })} maxLength={120} />
      </Field>
    </FormDialog>
  );
}

/**
 * "Use a Library Workflow": the Library Workflow copied into the Project as a draft, opened in
 * the builder, the same path as the Library's "Use on a Project" (copyIntoProject; decided
 * 2026-10-11). The Project Admin publishes and binds it once they have reviewed it.
 */
function LibraryDialog({
  projectId,
  type,
  library,
  errorText,
  onClose,
  onCreated,
}: {
  projectId: string;
  type: WorkflowSettingsType;
  library: WorkflowSettings["library"];
  errorText: (error: string, body?: unknown) => string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const t = useTranslations("projectSettings.workflows");
  const locale = useLocale() as Locale;
  const [picked, setPicked] = useState(library[0]?.id ?? "");
  const source = library.find((l) => l.id === picked);
  return (
    <FormDialog
      title={t("libraryTitle", { type: type.code })}
      description={t("libraryHelp")}
      submitLabel={t("libraryUse")}
      onClose={onClose}
      disabled={!source}
      onSubmit={async () => {
        if (!source) return null;
        const copy = await copyIntoProject(source.id, projectId, source.name);
        if (copy.ok) {
          onCreated(copy.id);
          return null;
        }
        return [errorText(copy.error), ...copy.problems.map((p) => p.message[locale])].join(" ");
      }}
    >
      <Field label={t("libraryWorkflow")} required>
        <Select
          value={picked}
          onValueChange={setPicked}
          options={library.map((l) => ({ value: l.id, label: `${l.name[locale]} · ${t("version", { n: formatNumber(l.versionNo ?? 1, locale) })}` }))}
        />
      </Field>
    </FormDialog>
  );
}

/** "Add exception for a Participant": new items of the Type that Participant raises run another Workflow of the Project. */
function ExceptionDialog({
  type,
  participants,
  bind,
  errorText,
  onClose,
  onDone,
}: {
  type: WorkflowSettingsType;
  participants: { id: string; name: string }[];
  bind: (type: WorkflowSettingsType, workflowId: string, participantId: string | null) => Promise<SetupResult>;
  errorText: (error: string, body?: unknown) => string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("projectSettings.workflows");
  const locale = useLocale() as Locale;
  const choices = type.copies.filter((c) => c.versionNo !== null);
  const [participant, setParticipant] = useState(participants[0]?.id ?? "");
  const [workflow, setWorkflow] = useState(choices[0]?.id ?? "");
  return (
    <FormDialog
      title={t("exceptionTitle", { type: type.code })}
      description={t("exceptionHelp")}
      submitLabel={t("exceptionSubmit")}
      onClose={onClose}
      disabled={!participant || !workflow}
      onSubmit={async () => {
        const res = await bind(type, workflow, participant);
        if (res.ok) {
          onDone();
          return null;
        }
        return errorText(res.error);
      }}
    >
      <Field label={t("exceptionParticipant")} required>
        <Select value={participant} onValueChange={setParticipant} options={participants.map((p) => ({ value: p.id, label: p.name }))} />
      </Field>
      {choices.length === 0 ? (
        <p className="text-sm text-muted">{t("exceptionNoWorkflow")}</p>
      ) : (
        <Field label={t("exceptionWorkflow")} required>
          <Select
            value={workflow}
            onValueChange={setWorkflow}
            options={choices.map((c) => ({ value: c.id, label: `${c.name[locale]} · ${t("version", { n: formatNumber(c.versionNo ?? 1, locale) })}` }))}
          />
        </Field>
      )}
    </FormDialog>
  );
}

/** "Back to the Rabaed Default": the Project's binding is taken away; new items run the Default again. */
function BackDialog({
  projectId,
  type,
  errorText,
  onClose,
  onDone,
}: {
  projectId: string;
  type: WorkflowSettingsType;
  errorText: (error: string, body?: unknown) => string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("projectSettings.workflows");
  return (
    <FormDialog
      title={t("backTitle", { type: type.code })}
      description={t("backHelp")}
      submitLabel={t("backSubmit")}
      onClose={onClose}
      onSubmit={async () => {
        const res = await setupCall("DELETE", `/projects/${projectId}/workflow-bindings?workItemTypeId=${type.id}`);
        if (res.ok) {
          onDone();
          return null;
        }
        return errorText(res.error, res.body);
      }}
    >
      <p className="text-sm text-text-secondary">{t("backBody", { workflow: type.workflow.name.en })}</p>
    </FormDialog>
  );
}
