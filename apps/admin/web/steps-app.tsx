"use client";

import { directionOf, type BilingualText, type Locale } from "@rabaed/domain";
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DirectionProvider,
  Field,
  Icon,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from "@rabaed/ui";
import { useState } from "react";
import { AdminHeader, SignedOutOrLoading, useAdminSession } from "./admin-header.tsx";
import { ApiError, api } from "./api.ts";
import { fill, stepsWords, type StepsWords } from "./steps-messages.ts";

// Rabaed Admin -> Stuck Steps (RP-1162, UAT ADM-10; workflow-engine.md §5.6, ADR 0018). A Rabaed
// Engineer gives a reason (first: every read is logged with it, V9), picks a Project and types a
// Document Number, reads the item's Step, holding Company, holder and Step Pool, and hands the
// Step to another Member of that pool, or back to the pool. Never another Company's Member, never
// a Transition. The holding Company's history reads "by Rabaed"; nobody else reads anything.

const pageTitle = (locale: Locale) => stepsWords(locale).title;

interface Project {
  id: string;
  name: BilingualText;
  code: string;
}

interface PoolMember {
  memberId: string;
  name: BilingualText;
  email: string;
}

interface WorkItemStep {
  workItemId: string;
  documentNumber: string;
  title: string;
  typeName: BilingualText;
  closed: boolean;
  step: {
    name: BilingualText;
    stageName: BilingualText | null;
    draft: boolean;
    status: "pooled" | "picked_up";
    participant: { id: string; companyName: BilingualText; roleName: BilingualText };
    holderMemberId: string | null;
    pool: PoolMember[];
  } | null;
}

/** Who the Step goes to: a Member of the pool, or the pool itself. */
type Handing = { to: PoolMember } | { to: null };

export function StepsApp() {
  const { locale, signedIn, toggleLanguage } = useAdminSession(pageTitle);
  return (
    <DirectionProvider dir={directionOf(locale)}>
      <AdminHeader locale={locale} signedIn={signedIn} current="steps" onToggleLanguage={toggleLanguage} />
      <main className="mx-auto flex max-w-[1600px] flex-col gap-5 px-6 py-6">
        <SignedOutOrLoading locale={locale} signedIn={signedIn} />
        {typeof signedIn === "object" && <Steps locale={locale} />}
      </main>
    </DirectionProvider>
  );
}

function Steps({ locale }: { locale: Locale }) {
  const w = stepsWords(locale);
  const [reason, setReason] = useState("");
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [number, setNumber] = useState("");
  /** The item shown, with the Project it was found on. */
  const [found, setFound] = useState<(WorkItemStep & { projectId: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [handing, setHanding] = useState<Handing | null>(null);
  const why = reason.trim();
  const numberText = number.trim();

  async function loadProjects() {
    if (!why) return;
    setBusy(true);
    setError(null);
    try {
      setProjects((await api<{ projects: Project[] }>("GET", `/v1/steps/projects?reason=${encodeURIComponent(why)}`)).projects);
    } catch {
      setError(w.loadFailed);
    }
    setBusy(false);
  }

  /**
   * Finds the item numbered `documentNumber` on Project `inProject`: by default what the form says; after a
   * reassign, the item just shown, whatever the form says now. `quiet` keeps the notice.
   */
  async function find({ inProject = projectId, documentNumber = numberText, quiet = false } = {}) {
    if (!why || !inProject || !documentNumber) return;
    setBusy(true);
    setError(null);
    if (!quiet) setNotice(null);
    try {
      const query = new URLSearchParams({ projectId: inProject, documentNumber, reason: why });
      setFound({ ...(await api<WorkItemStep>("GET", `/v1/steps?${query.toString()}`)), projectId: inProject });
    } catch (e) {
      setFound(null);
      setError(e instanceof ApiError && e.status === 404 ? w.notFound : w.findFailed);
    }
    setBusy(false);
  }

  const step = found?.step ?? null;
  const holder = step?.pool.find((m) => m.memberId === step.holderMemberId) ?? null;
  const reassignable = step !== null && !step.draft;
  const poolOfOne = step !== null && step.pool.length < 2;

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-h3 font-bold">{w.title}</h1>
        <p className="max-w-3xl text-[14px] text-muted">{w.subtitle}</p>
      </header>

      <section aria-label={w.reason} className="flex max-w-[860px] flex-col gap-4 rounded-lg border border-border bg-surface p-5">
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
          <Textarea rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={w.reasonPlaceholder} />
        </Field>
        {projects === null ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => void loadProjects()} disabled={busy || !why}>
              {w.load}
            </Button>
            <span className="text-[13px] text-muted">{w.reasonFirst}</span>
          </div>
        ) : (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void find();
            }}
          >
            <label className="flex min-w-[260px] flex-col gap-1.5">
              <span className="text-[14px] font-semibold">{w.project}</span>
              <Select
                aria-label={w.project}
                placeholder={w.chooseProject}
                value={projectId ?? ""}
                onValueChange={(id) => {
                  setProjectId(id);
                  setFound(null);
                }}
                options={projects.map((p) => ({ value: p.id, label: p.name[locale] }))}
              />
            </label>
            <div className="min-w-[260px]">
              <Field label={w.documentNumber}>
                {/* A Document Number always reads left to right. */}
                <Input dir="ltr" value={number} onChange={(e) => setNumber(e.target.value)} placeholder={w.documentNumberPlaceholder} />
              </Field>
            </div>
            <Button type="submit" disabled={busy || !why || !projectId || !numberText}>
              {w.find}
            </Button>
          </form>
        )}
      </section>

      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-md bg-danger-tint px-4 py-3 text-[14px] text-danger-fg">
          <Icon name="alert-triangle" size={16} />
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="flex items-center gap-2 rounded-md bg-info-tint px-4 py-3 text-[14px] text-info-fg">
          <Icon name="info-circle" size={16} />
          {notice}
        </p>
      )}

      {found && (
        <section aria-labelledby="stuck-item" className="flex max-w-[860px] flex-col gap-4 rounded-lg border border-border bg-surface p-5">
          <h2 id="stuck-item" className="text-h4 font-bold">
            {w.itemHeading}{" "}
            <span dir="ltr" className="whitespace-nowrap">
              {found.documentNumber}
            </span>
          </h2>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-[14px]">
            <dt className="text-muted">{w.subject}</dt>
            <dd>{found.title}</dd>
            <dt className="text-muted">{w.type}</dt>
            <dd>{found.typeName[locale]}</dd>
            {step && (
              <>
                <dt className="text-muted">{w.step}</dt>
                <dd>{step.name[locale]}</dd>
                {step.stageName && (
                  <>
                    <dt className="text-muted">{w.stage}</dt>
                    <dd>{step.stageName[locale]}</dd>
                  </>
                )}
                <dt className="text-muted">{w.holdingCompany}</dt>
                <dd>
                  {step.participant.companyName[locale]} <span className="text-muted">· {step.participant.roleName[locale]}</span>
                </dd>
                <dt className="text-muted">{w.holder}</dt>
                <dd>{holder ? holder.name[locale] : <span className="text-muted">{w.inPool}</span>}</dd>
              </>
            )}
          </dl>
          {found.closed ? (
            <p className="text-muted">{w.closed}</p>
          ) : step === null ? (
            <p className="text-muted">{w.noStep}</p>
          ) : step.draft ? (
            <p className="text-muted">{w.draftStep}</p>
          ) : null}
        </section>
      )}

      {found && step && reassignable && (
        <section aria-labelledby="step-pool" className="flex max-w-[860px] flex-col gap-3">
          <h2 id="step-pool" className="text-h4 font-bold">
            {w.poolHeading}
          </h2>
          <p className="text-[14px] text-muted">{w.poolHelp}</p>
          {poolOfOne && <p className="text-[14px] text-muted">{w.poolOfOne}</p>}
          <Table label={w.poolLabel}>
            <TableHeader>
              <TableRow>
                <TableHead>{w.colName}</TableHead>
                <TableHead>{w.colEmail}</TableHead>
                <TableHead>
                  <span className="sr-only">{w.colActions}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {step.pool.map((m) => (
                <TableRow key={m.memberId}>
                  <TableCell>{m.name[locale]}</TableCell>
                  <TableCell>
                    <span dir="ltr" className="[overflow-wrap:anywhere]">
                      {m.email}
                    </span>
                  </TableCell>
                  <TableCell className="text-end">
                    {m.memberId === step.holderMemberId ? (
                      <Badge tone="info">{w.holdsIt}</Badge>
                    ) : (
                      <Button variant="secondary" size="sm" onClick={() => setHanding({ to: m })}>
                        {w.handTo}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {step.status === "picked_up" && !poolOfOne && (
            <div>
              <Button variant="secondary" onClick={() => setHanding({ to: null })}>
                {w.returnToPool}
              </Button>
            </div>
          )}
        </section>
      )}

      <ReasonDialog
        key={handing === null ? "none" : (handing.to?.memberId ?? "pool")}
        w={w}
        open={handing !== null}
        onClose={() => setHanding(null)}
        title={handing?.to ? fill(w.handTitle, { name: handing.to.name[locale] }) : w.returnTitle}
        description={handing?.to ? fill(w.handDescription, { name: handing.to.name[locale] }) : w.returnDescription}
        initialReason={why}
        run={async (given) => {
          const to = handing?.to ?? null;
          try {
            await api("POST", `/v1/work-items/${found!.workItemId}/step/reassign`, { toMemberId: to?.memberId ?? null, reason: given });
          } catch (e) {
            const code = e instanceof ApiError && typeof e.body.error === "string" ? e.body.error : "";
            return (w.refusals as Record<string, string>)[code] ?? w.reassignFailed;
          }
          setNotice(to ? fill(w.reassigned, { name: to.name[locale] }) : w.returned);
          void find({ inProject: found!.projectId, documentNumber: found!.documentNumber, quiet: true });
          return null;
        }}
      />
    </>
  );
}

/**
 * Asks the Engineer for the reason of the reassign (prefilled with the page's, editable) and runs it.
 * `run` answers null when it worked, else what to tell the Engineer; the dialog closes on success.
 */
function ReasonDialog({
  w,
  open,
  onClose,
  title,
  description,
  initialReason,
  run,
}: {
  w: StepsWords;
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  initialReason: string;
  run: (reason: string) => Promise<string | null>;
}) {
  const [reason, setReason] = useState(initialReason);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const given = reason.trim();

  async function confirm() {
    if (!given) return setMessage(w.reasonNeeded);
    setBusy(true);
    setMessage(null);
    const refused = await run(given);
    setBusy(false);
    if (refused === null) onClose();
    else setMessage(refused);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent title={title} description={description} closeLabel={w.close}>
        <Field label={w.reasonDialogLabel} required help={w.reasonDialogHelp}>
          <Textarea rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {message && (
          <p role="alert" className="flex items-center gap-2 rounded-md bg-danger-tint px-3 py-2 text-[14px] text-danger-fg">
            <Icon name="alert-triangle" size={16} />
            {message}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" disabled={busy}>
              {w.cancel}
            </Button>
          </DialogClose>
          <Button onClick={() => void confirm()} disabled={busy || !given}>
            {busy ? w.working : w.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
