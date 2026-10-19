"use client";

import {
  directionOf,
  type AdminRegisterImportFor,
  type AdminRegisterImportParticipants,
  type AdminRegisterImportProjects,
  type BilingualText,
  type Locale,
  type RegisterImportFields,
} from "@rabaed/domain";
import {
  Avatar,
  Button,
  DirectionProvider,
  Field,
  Icon,
  RegisterImportWizard,
  Select,
  Textarea,
  buttonVariants,
  cn,
  type RegisterImportCallResult,
  type RegisterImportClient,
} from "@rabaed/ui";
import { useMemo, useState } from "react";
import { AdminHeader, SignedOutOrLoading, useAdminSession } from "./admin-header.tsx";
import { ApiError, api } from "./api.ts";
import { importPageWords, registerImportMessages } from "./register-import-messages.ts";

// Rabaed Admin -> Imports (RP-645, spec RP-631 stories 38–41; the owner's design RP-634, "Rabaed
// Admin Import Register"): a Rabaed Engineer imports a Company's submittal register for it. The
// Company & reason step first: the reason (first, as every read of the Company's data is logged
// with it, V9), the Project, the Participant and its default Member, who raises every row nobody
// else is assigned. Then the customer app's own wizard (@rabaed/ui), whose every call carries
// whom the import is for and why. The Company reads "Rabaed" as who imported; no time is shown.

const pageTitle = (locale: Locale) => importPageWords(locale).title;

export function ImportsApp() {
  const { locale, signedIn, toggleLanguage } = useAdminSession(pageTitle);
  return (
    <DirectionProvider dir={directionOf(locale)}>
      <AdminHeader locale={locale} signedIn={signedIn} current="imports" onToggleLanguage={toggleLanguage} />
      <main className="mx-auto flex max-w-[1600px] flex-col gap-5 px-6 py-6">
        <SignedOutOrLoading locale={locale} signedIn={signedIn} />
        {typeof signedIn === "object" && <ImportForCompany locale={locale} />}
      </main>
    </DirectionProvider>
  );
}

/** An Admin call as the wizard takes it: the body, or the refusal's code. */
async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<RegisterImportCallResult> {
  try {
    return { ok: true, body: await api<unknown>(method, path, body) };
  } catch (error) {
    return { ok: false, error: error instanceof ApiError && typeof error.body.error === "string" ? error.body.error : "unavailable" };
  }
}

type Participant = AdminRegisterImportParticipants["participants"][number];
/** Whom the import is for, once the Company & reason step is done, with what a register may fill there. */
type Chosen = { for: AdminRegisterImportFor; projectName: string; participant: Participant; memberName: BilingualText; fields: RegisterImportFields };

function ImportForCompany({ locale }: { locale: Locale }) {
  const w = importPageWords(locale);
  const t = useMemo(() => registerImportMessages(locale), [locale]);
  const [reason, setReason] = useState("");
  /** The reason the lists were read with: changing it reads them again. */
  const [readWith, setReadWith] = useState<string | null>(null);
  const [projects, setProjects] = useState<AdminRegisterImportProjects["projects"] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[] | null>(null);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const why = reason.trim();

  async function loadProjects() {
    if (!why) return;
    setBusy(true);
    setError(null);
    const result = await call("GET", `/v1/register-imports/projects?reason=${encodeURIComponent(why)}`);
    setBusy(false);
    if (!result.ok) return setError(w.loadFailed);
    setProjects((result.body as AdminRegisterImportProjects).projects);
    setReadWith(why);
  }

  async function chooseProject(id: string) {
    setProjectId(id);
    setParticipants(null);
    setParticipantId(null);
    setMemberId(null);
    setBusy(true);
    setError(null);
    const result = await call("GET", `/v1/register-imports/projects/${id}/participants?reason=${encodeURIComponent(why)}`);
    setBusy(false);
    if (!result.ok) return setError(w.loadFailed);
    setParticipants((result.body as AdminRegisterImportParticipants).participants);
  }

  const participant = participants?.find((p) => p.id === participantId) ?? null;
  const member = participant?.members.find((m) => m.id === memberId) ?? null;

  async function next() {
    if (!projectId || !participant || !member || !why) return;
    const imported: AdminRegisterImportFor = { projectId, participantId: participant.id, defaultMemberId: member.id, reason: why };
    setBusy(true);
    setError(null);
    const result = await call("POST", "/v1/register-imports/fields", { for: imported });
    setBusy(false);
    if (!result.ok) {
      setError(result.error === "default_member_not_found" ? w.defaultMemberNotFound : result.error === "forbidden" ? w.forbidden : w.loadFailed);
      return;
    }
    const projectName = projects?.find((p) => p.id === projectId)?.name[locale] ?? "";
    setChosen({ for: imported, projectName, participant, memberName: member.name, fields: result.body as RegisterImportFields });
  }

  const client: RegisterImportClient | null = chosen && {
    read: (body) => call("POST", "/v1/register-imports/read", { ...body, for: chosen.for }),
    values: (body) => call("POST", "/v1/register-imports/values", { ...body, for: chosen.for }),
    preview: (body) => call("POST", "/v1/register-imports", { ...body, for: chosen.for }),
    confirm: (importId) => call("POST", `/v1/register-imports/${importId}/confirm`, { reason: chosen.for.reason }),
    // RP-644: the import as it reads after confirm (its new Packages' numbers). Saved mappings are
    // applied here, never saved: the Company's Members save them.
    get: (importId) => call("GET", `/v1/register-imports/${importId}?reason=${encodeURIComponent(chosen.for.reason)}`),
  };

  const heading = (
    <>
      <nav aria-label={w.breadcrumb} className="flex items-center gap-2 text-[13px] text-muted">
        <span>{w.imports}</span>
        <span aria-hidden>›</span>
        <span className="font-semibold text-text">{w.newImport}</span>
      </nav>
      <header className="flex flex-col gap-1">
        <h1 className="text-h3 font-bold">{w.title}</h1>
        <p className="text-[14px] text-muted">{w.subtitle}</p>
      </header>
    </>
  );

  if (chosen && client) {
    const summary = (
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-info-tint px-4 py-3 text-[13.5px] text-info-fg">
        <Icon name="info-circle" size={16} />
        <span>
          {w.importingFor} <strong>{chosen.participant.companyName[locale]}</strong> · {chosen.projectName}
        </span>
        <span aria-hidden>•</span>
        <span>
          {w.defaultRaiser} <strong>{chosen.memberName[locale]}</strong>
        </span>
        <span aria-hidden>•</span>
        <span className="min-w-0 flex-1 truncate">
          {w.reasonIs} {chosen.for.reason}
        </span>
        <Button variant="ghost" size="sm" onClick={() => setChosen(null)}>
          {w.change}
        </Button>
      </p>
    );
    return (
      <>
        {heading}
        <RegisterImportWizard
          key={`${chosen.for.participantId}:${chosen.for.defaultMemberId}`}
          locale={locale}
          t={t}
          client={client}
          importer={{ id: chosen.for.defaultMemberId, name: chosen.memberName }}
          fixedImporter
          types={chosen.fields.types}
          trades={chosen.fields.trades}
          fields={chosen.fields}
          lead={{ label: w.step, summary }}
        />
      </>
    );
  }

  const steps = ["upload", "sheet", "map", "values", "assign", "validate"] as const;
  const listsStale = readWith !== null && readWith !== why;
  return (
    <>
      {heading}
      <ol aria-label={t("steps")} className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <li aria-current="step" className="flex items-center gap-2 text-[14px]">
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-on-primary">1</span>
          <span className="font-semibold text-text">{w.step}</span>
        </li>
        {steps.map((s, index) => (
          <li key={s} className="flex items-center gap-2 text-[14px]">
            <span aria-hidden className="h-px w-6 bg-border" />
            <span className="inline-flex size-6 items-center justify-center rounded-full bg-neutral-tint text-[12px] font-bold text-muted">{index + 2}</span>
            <span className="text-text-secondary">{t(`step.${s}`)}</span>
          </li>
        ))}
      </ol>

      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-md bg-danger-tint px-4 py-3 text-[14px] text-danger-fg">
          <Icon name="alert-triangle" size={16} />
          {error}
        </p>
      )}

      <section aria-label={w.step} className="flex max-w-[860px] flex-col gap-5 rounded-lg border border-border bg-surface p-5">
        <Field
          label={w.reason}
          required
          help={
            <span className="inline-flex items-center gap-1.5">
              <Icon name="lock" size={14} />
              {w.reasonKept}
            </span>
          }
        >
          <Textarea
            rows={3}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => void (why && (projects === null || listsStale) ? loadProjects() : undefined)}
            placeholder={w.reasonPlaceholder}
          />
        </Field>

        {projects === null ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => void loadProjects()} disabled={busy || !why}>
              {w.load}
            </Button>
            <span className="text-[13px] text-muted">{w.reasonFirst}</span>
          </div>
        ) : (
          <>
            <label className="flex max-w-[420px] flex-col gap-1.5">
              <span className="text-[14px] font-semibold">{w.project}</span>
              <Select
                aria-label={w.project}
                placeholder={w.chooseProject}
                value={projectId ?? ""}
                onValueChange={(id) => void chooseProject(id)}
                options={projects.map((p) => ({ value: p.id, label: p.name[locale] }))}
              />
            </label>

            {participants && (
              <div role="radiogroup" aria-label={w.company} className="flex flex-col gap-2">
                <span className="text-[14px] font-semibold">{w.company}</span>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {participants.map((p) => {
                    const on = p.id === participantId;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={!p.mayImport || busy}
                        onClick={() => {
                          setParticipantId(p.id);
                          setMemberId(null);
                        }}
                        className={cn(
                          "flex items-center gap-3 rounded-md border px-3 py-2.5 text-start",
                          on ? "border-primary bg-primary-tint ring-1 ring-primary" : "border-border hover:bg-hover",
                          !p.mayImport && "cursor-not-allowed opacity-50 hover:bg-transparent",
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn("inline-flex size-4 shrink-0 items-center justify-center rounded-full border", on ? "border-primary" : "border-border-strong")}
                        >
                          {on && <span className="size-2 rounded-full bg-primary" />}
                        </span>
                        <Avatar name={p.companyName.en} decorative />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-semibold">{p.companyName[locale]}</span>
                          <span className="text-[12.5px] text-muted">
                            {p.roleName[locale]}
                            {!p.mayImport && ` · ${w.raisesNone}`}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {participant && (
              <label className="flex flex-col gap-1.5">
                <span className="text-[14px] font-semibold">{w.defaultMember}</span>
                <Select
                  aria-label={w.defaultMember}
                  placeholder={w.chooseMember}
                  value={memberId ?? ""}
                  onValueChange={setMemberId}
                  options={participant.members.map((m) => ({
                    value: m.id,
                    label: m.mayImport ? `${m.name[locale]} · ${m.email}` : `${m.name[locale]} · ${w.cannotImport}`,
                    disabled: !m.mayImport,
                  }))}
                />
                <span className="text-[13px] text-muted">{w.defaultHelp}</span>
              </label>
            )}
          </>
        )}
      </section>

      <div className="flex items-center justify-between">
        <a href="/" className={buttonVariants({ variant: "secondary" })}>
          {t("back")}
        </a>
        <Button onClick={() => void next()} disabled={busy || !why || !member || listsStale}>
          {t("next")}
          <Icon name="arrow-right" />
        </Button>
      </div>
    </>
  );
}
