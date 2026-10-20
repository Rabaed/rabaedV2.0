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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from "@rabaed/ui";
import { Fragment, useEffect, useState } from "react";
import { AdminHeader, SignedOutOrLoading, useAdminSession } from "./admin-header.tsx";
import { ApiError, api } from "./api.ts";
import { recordsWords, recordTime, type RecordsWords } from "./records-messages.ts";

// Rabaed Admin -> Records (RP-670, spec RP-632; ADR 0023): the Record Job Monitor. A Rabaed
// Engineer gives a reason (first: every read is logged with it, V9), then reads the record jobs
// that are failing or dead, with their error, and the records whose checks failed. A dead job
// is retried (a new job; the dead one stays as it was), a record is re-produced, and a record's
// history shows its Re-produce requests and the checks that ran. Customers read none of this.

const pageTitle = (locale: Locale) => recordsWords(locale).title;

interface RecordJob {
  outboxId: string;
  kind: "record" | "reproduce";
  workItemId: string;
  projectName: BilingualText;
  documentNumber: string | null;
  state: "failing" | "dead";
  error: string;
  attempts: number;
  lastRanAt: string | null;
  nextTryAt: string | null;
}

interface RecordAlert {
  workItemId: string;
  projectName: BilingualText;
  documentNumber: string | null;
  status: "published" | "failed_checks" | "job_failed";
  problems: string[];
}

interface RecordHistory {
  requests: {
    requestedAt: string;
    engineerEmail: string;
    reason: string;
    outcome: "replaced" | "waiting" | "job_failed" | "checks_failed";
    replacedSha256: string | null;
    newSha256: string | null;
  }[];
  checks: { runKind: "closure" | "reproduce"; passed: boolean; problems: string[]; ranAt: string }[];
}

export function RecordsApp() {
  const { locale, signedIn, toggleLanguage } = useAdminSession(pageTitle);
  return (
    <DirectionProvider dir={directionOf(locale)}>
      <AdminHeader locale={locale} signedIn={signedIn} current="records" onToggleLanguage={toggleLanguage} />
      <main className="mx-auto flex max-w-[1600px] flex-col gap-5 px-6 py-6">
        <SignedOutOrLoading locale={locale} signedIn={signedIn} />
        {typeof signedIn === "object" && <Records locale={locale} />}
      </main>
    </DirectionProvider>
  );
}

/** What a failed call says to the Engineer: the refusal's own message when it has one, else `fallback`. */
const failure = (error: unknown, known: Record<string, string>, fallback: string) =>
  (error instanceof ApiError && typeof error.body.error === "string" ? known[error.body.error] : undefined) ?? fallback;

/** A time as `yyyy-mm-dd hh:mm` (UTC), left to right. */
function Time({ iso, none }: { iso: string | null; none: string }) {
  return (
    <span dir="ltr" className="whitespace-nowrap">
      {recordTime(iso, none)}
    </span>
  );
}

function DocumentNumber({ value, none }: { value: string | null; none: string }) {
  return value ? <span dir="ltr">{value}</span> : <span className="text-muted">{none}</span>;
}

function Records({ locale }: { locale: Locale }) {
  const w = recordsWords(locale);
  const [reason, setReason] = useState("");
  /** The reason the lists were read with: changing it and loading again reads them again. */
  const [readWith, setReadWith] = useState<string | null>(null);
  const [jobs, setJobs] = useState<RecordJob[] | null>(null);
  const [alerts, setAlerts] = useState<RecordAlert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState<RecordJob | null>(null);
  const [reproducing, setReproducing] = useState<RecordAlert | null>(null);
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const why = reason.trim();

  async function load(with_: string = why) {
    if (!with_) return;
    setBusy(true);
    setError(null);
    setHistoryOf(null);
    try {
      const query = `?reason=${encodeURIComponent(with_)}`;
      const [j, a] = await Promise.all([
        api<{ jobs: RecordJob[] }>("GET", `/v1/record-jobs${query}`),
        api<{ alerts: RecordAlert[] }>("GET", `/v1/documental-record-alerts${query}`),
      ]);
      setJobs(j.jobs);
      // A job that gave up is the jobs table's row: the alerts keep to records whose checks failed.
      setAlerts(a.alerts.filter((alert) => alert.status !== "job_failed"));
      setReadWith(with_);
    } catch {
      setError(w.loadFailed);
    }
    setBusy(false);
  }

  const changed = readWith !== null && readWith !== why;
  const statusWord = (status: RecordAlert["status"]) => (status === "published" ? w.statusPublished : w.statusFailedChecks);

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-h3 font-bold">{w.title}</h1>
        <p className="text-[14px] text-muted">{w.subtitle}</p>
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
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => void load()} disabled={busy || !why}>
            {readWith === null ? w.load : w.reload}
          </Button>
          <span className="text-[13px] text-muted">{readWith === null ? w.reasonFirst : changed ? w.reasonChanged : ""}</span>
        </div>
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

      {jobs && (
        <section aria-labelledby="record-jobs" className="flex flex-col gap-3">
          <h2 id="record-jobs" className="text-h4 font-bold">
            {w.jobsHeading}
          </h2>
          <p className="max-w-3xl text-[14px] text-muted">{w.jobsHelp}</p>
          {jobs.length === 0 ? (
            <p className="text-muted">{w.noJobs}</p>
          ) : (
            <Table label={w.jobsLabel}>
              <TableHeader>
                <TableRow>
                  <TableHead>{w.colDocumentNumber}</TableHead>
                  <TableHead>{w.colProject}</TableHead>
                  <TableHead>{w.colKind}</TableHead>
                  <TableHead>{w.colState}</TableHead>
                  <TableHead>{w.colAttempts}</TableHead>
                  <TableHead>{w.colLastRan}</TableHead>
                  <TableHead>{w.colNextTry}</TableHead>
                  <TableHead>{w.colError}</TableHead>
                  <TableHead>
                    <span className="sr-only">{w.colActions}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.outboxId}>
                    <TableCell>
                      <DocumentNumber value={job.documentNumber} none={w.noDocumentNumber} />
                    </TableCell>
                    <TableCell>{job.projectName[locale]}</TableCell>
                    <TableCell>{job.kind === "record" ? w.kindRecord : w.kindReproduce}</TableCell>
                    <TableCell>
                      <Badge tone={job.state === "dead" ? "danger" : "warning"}>{job.state === "dead" ? w.stateDead : w.stateFailing}</Badge>
                    </TableCell>
                    <TableCell>
                      <span dir="ltr">{job.attempts}</span>
                    </TableCell>
                    <TableCell>
                      <Time iso={job.lastRanAt} none={w.noTime} />
                    </TableCell>
                    <TableCell>
                      <Time iso={job.nextTryAt} none={w.noTime} />
                    </TableCell>
                    <TableCell>
                      <code dir="ltr" className="block max-w-[420px] font-mono text-[12.5px] [overflow-wrap:anywhere]">
                        {job.error}
                      </code>
                    </TableCell>
                    <TableCell>
                      {job.state === "dead" && (
                        <Button variant="secondary" size="sm" onClick={() => setRetrying(job)}>
                          {w.retry}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      )}

      {alerts && (
        <section aria-labelledby="record-alerts" className="flex flex-col gap-3">
          <h2 id="record-alerts" className="text-h4 font-bold">
            {w.alertsHeading}
          </h2>
          <p className="max-w-3xl text-[14px] text-muted">{w.alertsHelp}</p>
          {alerts.length === 0 ? (
            <p className="text-muted">{w.noAlerts}</p>
          ) : (
            <Table label={w.alertsLabel}>
              <TableHeader>
                <TableRow>
                  <TableHead>{w.colDocumentNumber}</TableHead>
                  <TableHead>{w.colProject}</TableHead>
                  <TableHead>{w.colStatus}</TableHead>
                  <TableHead>{w.colProblems}</TableHead>
                  <TableHead>
                    <span className="sr-only">{w.colActions}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((alert) => (
                  <Fragment key={alert.workItemId}>
                    <TableRow>
                      <TableCell>
                        <DocumentNumber value={alert.documentNumber} none={w.noDocumentNumber} />
                      </TableCell>
                      <TableCell>{alert.projectName[locale]}</TableCell>
                      <TableCell>
                        <Badge tone={alert.status === "published" ? "warning" : "danger"}>{statusWord(alert.status)}</Badge>
                      </TableCell>
                      <TableCell>
                        <ul className="flex max-w-[520px] flex-col gap-1">
                          {alert.problems.map((problem, index) => (
                            <li key={index}>
                              <code dir="ltr" className="block font-mono text-[12.5px] [overflow-wrap:anywhere]">
                                {problem}
                              </code>
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                      <TableCell>
                        <span className="flex flex-wrap gap-2">
                          <Button variant="secondary" size="sm" onClick={() => setReproducing(alert)}>
                            {w.reproduce}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-expanded={historyOf === alert.workItemId}
                            onClick={() => setHistoryOf(historyOf === alert.workItemId ? null : alert.workItemId)}
                          >
                            {historyOf === alert.workItemId ? w.hideHistory : w.history}
                          </Button>
                        </span>
                      </TableCell>
                    </TableRow>
                    {historyOf === alert.workItemId && readWith && (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <History locale={locale} workItemId={alert.workItemId} reason={readWith} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      )}

      <ReasonDialog
        key={retrying?.outboxId ?? "retry"}
        w={w}
        open={retrying !== null}
        onClose={() => setRetrying(null)}
        title={w.retryTitle}
        description={w.retryDescription}
        initialReason={why}
        run={async (given) => {
          try {
            await api("POST", `/v1/record-jobs/${retrying!.outboxId}/retry`, { reason: given });
          } catch (e) {
            // A job retried or replaced meanwhile: the list is stale.
            return failure(e, { not_found: w.retryNotFound, already_queued: w.retryAlreadyQueued }, w.retryFailed);
          }
          setNotice(w.retried);
          void load(readWith ?? why);
          return null;
        }}
      />
      <ReasonDialog
        key={reproducing?.workItemId ?? "reproduce"}
        w={w}
        open={reproducing !== null}
        onClose={() => setReproducing(null)}
        title={w.reproduceTitle}
        description={w.reproduceDescription}
        initialReason={why}
        run={async (given) => {
          try {
            await api("POST", `/v1/work-items/${reproducing!.workItemId}/documental-record/reproduce`, { reason: given });
          } catch (e) {
            return failure(e, { not_found: w.reproduceNotFound, already_queued: w.reproduceAlreadyQueued }, w.reproduceFailed);
          }
          setNotice(w.reproduceQueued);
          return null;
        }}
      />
    </>
  );
}

/**
 * Asks the Engineer for the reason of one action (prefilled with the page's, editable) and runs it.
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
  w: RecordsWords;
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

/** A record's history: its Re-produce requests and the checks that ran (read with the page's reason). */
function History({ locale, workItemId, reason }: { locale: Locale; workItemId: string; reason: string }) {
  const w = recordsWords(locale);
  const [history, setHistory] = useState<RecordHistory | "failed" | null>(null);
  useEffect(() => {
    api<RecordHistory>("GET", `/v1/work-items/${workItemId}/documental-record/history?reason=${encodeURIComponent(reason)}`).then(setHistory, () => setHistory("failed"));
  }, [workItemId, reason]);
  if (history === null) return <p className="text-muted">{w.historyLoading}</p>;
  if (history === "failed") return <p role="alert">{w.historyFailed}</p>;

  const outcome = (o: RecordHistory["requests"][number]["outcome"]) =>
    ({ replaced: w.outcomeReplaced, waiting: w.outcomeWaiting, job_failed: w.outcomeJobFailed, checks_failed: w.outcomeChecksFailed })[o];
  return (
    <div className="flex flex-col gap-4 py-2">
      <section aria-label={w.historyRequests} className="flex flex-col gap-2">
        <h3 className="text-[14px] font-semibold">{w.historyRequests}</h3>
        {history.requests.length === 0 ? (
          <p className="text-muted">{w.noRequests}</p>
        ) : (
          <Table label={w.historyRequests}>
            <TableHeader>
              <TableRow>
                <TableHead>{w.colRequestedAt}</TableHead>
                <TableHead>{w.colEngineer}</TableHead>
                <TableHead>{w.colReason}</TableHead>
                <TableHead>{w.colOutcome}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.requests.map((request) => (
                <TableRow key={request.requestedAt + request.reason}>
                  <TableCell>
                    <Time iso={request.requestedAt} none={w.noTime} />
                  </TableCell>
                  <TableCell>
                    <span dir="ltr">{request.engineerEmail}</span>
                  </TableCell>
                  <TableCell>{request.reason}</TableCell>
                  <TableCell>
                    <span className="flex flex-col gap-1">
                      <span>{outcome(request.outcome)}</span>
                      {request.replacedSha256 && request.newSha256 && (
                        <span className="text-[12px] text-muted">
                          {w.replacedFingerprint}: <code dir="ltr" className="font-mono [overflow-wrap:anywhere]">{request.replacedSha256}</code>
                          <br />
                          {w.newFingerprint}: <code dir="ltr" className="font-mono [overflow-wrap:anywhere]">{request.newSha256}</code>
                        </span>
                      )}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
      <section aria-label={w.historyChecks} className="flex flex-col gap-2">
        <h3 className="text-[14px] font-semibold">{w.historyChecks}</h3>
        {history.checks.length === 0 ? (
          <p className="text-muted">{w.noChecks}</p>
        ) : (
          <Table label={w.historyChecks}>
            <TableHeader>
              <TableRow>
                <TableHead>{w.colRun}</TableHead>
                <TableHead>{w.colRequestedAt}</TableHead>
                <TableHead>{w.colResult}</TableHead>
                <TableHead>{w.colProblems}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.checks.map((check) => (
                <TableRow key={check.ranAt + check.runKind}>
                  <TableCell>{check.runKind === "closure" ? w.runClosure : w.runReproduce}</TableCell>
                  <TableCell>
                    <Time iso={check.ranAt} none={w.noTime} />
                  </TableCell>
                  <TableCell>
                    <Badge tone={check.passed ? "success" : "danger"}>{check.passed ? w.passed : w.failed}</Badge>
                  </TableCell>
                  <TableCell>
                    {check.problems.map((problem, index) => (
                      <code key={index} dir="ltr" className="block font-mono text-[12.5px] [overflow-wrap:anywhere]">
                        {problem}
                      </code>
                    ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
