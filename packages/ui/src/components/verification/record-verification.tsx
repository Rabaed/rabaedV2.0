"use client";

import { copyMatch, formatDayMonthYear, printedIn, type CopyMatch, type Locale, type PrintedText, type RecordVerification } from "@rabaed/domain";
import { useId, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Badge } from "../data/badge.tsx";
import { KeyValues } from "../data/key-values.tsx";
import { TitledCard } from "../data/titled-card.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { Button, buttonVariants } from "../button/button.tsx";
import { Field } from "../form/field.tsx";
import { Input } from "../form/input.tsx";
import { Icon } from "../icon/icon.tsx";

// The public verification page of a Documental Record (RP-157; visibility.md, the Verification page
// row): genuine or replaced, what the record's first page prints, its signers, and a check of a copy
// in the browser, which fingerprints the dropped PDF with Web Crypto and uploads nothing. A record
// sealed with a test key (UAT, RP-1042) is never shown as genuine: the page says it is a test record. Interim,
// built from the kit's parts with no reference screen yet (RP-665; restyle RP-666).

export type RecordVerificationLabels = {
  genuine: string;
  /** "This record was replaced by a corrected copy on {date}", given the date as the page writes it. */
  replaced: (date: string) => ReactNode;
  replacedHint: string;
  /** "Test record: not a valid record", for a record sealed with a test key (RP-1042). */
  testKey: string;
  testKeyHint: string;
  documentNumber: string;
  project: string;
  outcome: string;
  sealed: string;
  signers: string;
  checkCopy: string;
  checkCopyHint: string;
  chooseFile: string;
  checking: string;
  original: string;
  /** "This copy was replaced by a corrected copy on {date}: …", given the date as the page writes it. */
  copyReplaced: (date: string) => ReactNode;
  different: string;
  noFile: string;
};

/** The SHA-256 of a file's bytes, in hex, worked out in the browser: nothing leaves it. */
async function fingerprintOf(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const day = (iso: string, locale: Locale) => formatDayMonthYear(new Date(iso), locale);

type Check = { state: "idle" } | { state: "checking" } | { state: "done"; fileName: string; match: CopyMatch } | { state: "failed" };

/** Drop a PDF, or choose one: told whether it is the original, a replaced copy, or not this record. */
export function CopyCheck({
  fingerprints,
  locale,
  labels,
}: {
  fingerprints: RecordVerification["fingerprints"];
  locale: Locale;
  labels: RecordVerificationLabels;
}) {
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [over, setOver] = useState(false);
  const hintId = useId();

  async function checkFile(file: File | undefined) {
    if (!file) return setCheck({ state: "failed" });
    setCheck({ state: "checking" });
    try {
      setCheck({ state: "done", fileName: file.name, match: copyMatch(await fingerprintOf(file), fingerprints) });
    } catch {
      setCheck({ state: "failed" });
    }
  }
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    void checkFile(event.dataTransfer.files[0]);
  };
  const onChoose = (event: ChangeEvent<HTMLInputElement>) => {
    void checkFile(event.target.files?.[0]);
    event.target.value = "";
  };

  return (
    <TitledCard title={labels.checkCopy} level={2}>
      <div
        data-testid="copy-drop"
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center gap-3 rounded-md border-2 border-dashed border-border px-4 py-6 text-center",
          over && "border-brand bg-brand-tint",
        )}
      >
        <Icon name="file-text" size={28} className="text-muted" />
        <p id={hintId} className="max-w-sm text-body text-muted">
          {labels.checkCopyHint}
        </p>
        <label
          className={cn(
            buttonVariants({ variant: "secondary" }),
            "w-fit cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
          )}
        >
          <Icon name="upload" size={16} />
          {labels.chooseFile}
          <input type="file" accept="application/pdf,.pdf" aria-describedby={hintId} onChange={onChoose} className="sr-only" />
        </label>
      </div>
      <div aria-live="polite" className="mt-3 empty:hidden">
        {check.state === "checking" && <p className="text-body text-muted">{labels.checking}</p>}
        {check.state === "failed" && <CopyResult tone="danger" icon="circle-x" text={labels.noFile} />}
        {check.state === "done" && (
          <CopyResult
            tone={check.match.kind === "original" ? "success" : "danger"}
            icon={check.match.kind === "original" ? "circle-check" : "circle-x"}
            fileName={check.fileName}
            text={
              check.match.kind === "original"
                ? labels.original
                : check.match.kind === "replaced"
                  ? labels.copyReplaced(day(check.match.replacedAt, locale))
                  : labels.different
            }
          />
        )}
      </div>
    </TitledCard>
  );
}

function CopyResult({ tone, icon, text, fileName }: { tone: "success" | "danger"; icon: "circle-check" | "circle-x"; text: ReactNode; fileName?: string }) {
  return (
    <div
      data-testid="copy-result"
      data-tone={tone}
      className={cn("flex items-start gap-2 rounded-md px-3 py-2.5 text-body", tone === "success" ? "bg-success-tint text-success-fg" : "bg-danger-tint text-danger-fg")}
    >
      <Icon name={icon} size={20} className="mt-0.5 shrink-0" />
      <p className="min-w-0">
        {fileName && (
          <bdi dir="auto" className="block font-semibold break-all">
            {fileName}
          </bdi>
        )}
        {text}
      </p>
    </div>
  );
}

/** A found record: its status, what its first page prints, its signers, and the copy check. */
export function RecordVerificationView({
  verification,
  locale,
  labels,
}: {
  verification: RecordVerification;
  locale: Locale;
  labels: RecordVerificationLabels;
}) {
  const v = verification;
  const genuine = v.status === "genuine";
  const test = v.testKey === true;
  const status: ReactNode = v.status === "genuine" ? labels.genuine : labels.replaced(day(v.replacedAt, locale));
  const good = genuine && !test;
  // As the record printed it: in the page's language when the record printed it, else in the one it did.
  const printed = (text: PrintedText) => <bdi dir="auto">{printedIn(text, locale)}</bdi>;
  return (
    <div className="flex flex-col gap-4" data-testid="record-verification">
      <div
        role="status"
        data-testid="verification-status"
        data-tone={good ? "success" : "warning"}
        className={cn("flex items-start gap-3 rounded-lg px-4 py-3", good ? "bg-success-tint text-success-fg" : "bg-warning-tint text-warning-fg")}
      >
        <Icon name={good ? "circle-check" : "alert-triangle"} size={24} className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="font-display text-h6 font-semibold">{test ? labels.testKey : status}</p>
          {test && <p className="mt-1 text-body">{labels.testKeyHint}</p>}
          {test && !genuine && <p className="mt-1 text-body">{status}</p>}
          {!genuine && <p className="mt-1 text-body">{labels.replacedHint}</p>}
        </div>
      </div>
      <TitledCard title={<bdi dir="auto">{v.subject}</bdi>} level={2}>
        <KeyValues
          items={[
            { key: "number", label: labels.documentNumber, value: v.documentNumber ? <DocNo value={v.documentNumber} /> : "—" },
            { key: "project", label: labels.project, value: printed(v.project) },
            {
              key: "outcome",
              label: labels.outcome,
              value: (
                <Badge tone="neutral">
                  {v.outcome.code && <bdi dir="ltr">{v.outcome.code}</bdi>}
                  {printed(v.outcome.name)}
                </Badge>
              ),
            },
            { key: "sealed", label: labels.sealed, value: day(v.sealedAt, locale) },
          ]}
        />
      </TitledCard>
      <TitledCard title={labels.signers} level={2} bodyClassName="px-5 py-2">
        <ul className="divide-y divide-border-subtle">
          {v.signers.map((s, i) => (
            <li key={i} className="flex flex-col gap-0.5 py-2.5">
              <span className="font-semibold">{printed(s.name)}</span>
              <span className="text-[13px] text-muted">
                <bdi dir="auto">{[...s.positions.map((p) => printedIn(p, locale)), printedIn(s.company, locale)].join(" · ")}</bdi>
              </span>
            </li>
          ))}
        </ul>
      </TitledCard>
      <CopyCheck fingerprints={v.fingerprints} locale={locale} labels={labels} />
    </div>
  );
}

export type VerificationCodeFormLabels = {
  title: string;
  hint: string;
  code: string;
  documentNumber: string;
  submit: string;
};

/**
 * Verification Code and Document Number, posted to `action` (a server action in the app). Plain
 * inputs: the Document Number is typed left to right in either language.
 */
export function VerificationCodeForm({
  action,
  labels,
  defaultCode = "",
  defaultDocumentNumber = "",
  refusal,
}: {
  action: string | ((data: FormData) => void | Promise<void>);
  labels: VerificationCodeFormLabels;
  defaultCode?: string;
  defaultDocumentNumber?: string;
  /** Why the last attempt found nothing: no such record (whatever was wrong), or too many attempts. */
  refusal?: { title: string; body: string };
}) {
  return (
    <TitledCard title={labels.title} level={2}>
      <form action={action} className="flex flex-col gap-4">
        {refusal && (
          <div role="alert" data-testid="verification-refusal" className="flex items-start gap-2 rounded-md bg-danger-tint px-3 py-2.5 text-danger-fg">
            <Icon name="alert-circle" size={20} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold">{refusal.title}</p>
              <p className="text-body">{refusal.body}</p>
            </div>
          </div>
        )}
        <p className="text-body text-muted">{labels.hint}</p>
        <Field label={labels.code} required>
          <Input
            name="code"
            dir="ltr"
            maxLength={20}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="XXXX-XXXX"
            defaultValue={defaultCode}
            className="font-mono tracking-wider"
          />
        </Field>
        <Field label={labels.documentNumber} required>
          <Input name="documentNumber" dir="ltr" maxLength={200} autoComplete="off" spellCheck={false} defaultValue={defaultDocumentNumber} />
        </Field>
        <Button type="submit" className="w-full sm:w-fit">
          {labels.submit}
        </Button>
      </form>
    </TitledCard>
  );
}
