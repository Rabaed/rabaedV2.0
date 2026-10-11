"use client";

import type { AdminWorkflowRead, AdminWorkflowSummary, Locale, WorkflowDefinition, WorkflowProblem } from "@rabaed/domain";
import { Badge, Button, Field, Input, Select, WorkflowBuilder, workflowBuilderLabels, type WorkflowBuilderLabels, type WorkflowPublishResult, type WorkflowSaveState } from "@rabaed/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "./api.ts";
import { DefaultSets } from "./default-sets.tsx";
import { builderNames, message, messagesOf } from "./messages.ts";
import { strings } from "./strings.ts";

type Notice = { kind: "ok" | "error"; text: string } | null;

/**
 * One Rabaed Default Workflow in the builder (RP-443, WF-20). The builder keeps its edits in the
 * page; "Save draft" and the builder's Publish send them with the reason typed above, which
 * Rabaed Admin logs against the Engineer (V9). Validate is the server's check and asks for none.
 */
export function WorkflowEditor({ typeCode, locale }: { typeCode: string; locale: Locale }) {
  const s = strings(locale);
  const [read, setRead] = useState<AdminWorkflowRead | "failed" | "missing" | null>(null);
  const [types, setTypes] = useState<AdminWorkflowSummary[]>([]);
  const [reason, setReason] = useState("");
  const [reasonMissing, setReasonMissing] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [problems, setProblems] = useState<readonly WorkflowProblem[]>([]);
  const [saveState, setSaveState] = useState<WorkflowSaveState>({ kind: "opened" });
  const [copyFrom, setCopyFrom] = useState("");
  const latest = useRef<WorkflowDefinition | null>(null);
  const dirty = useRef(false);
  const known = useRef<readonly WorkflowProblem[]>([]);
  const reasonInput = useRef<HTMLInputElement>(null);
  const api_ = `/v1/workflows/${encodeURIComponent(typeCode)}`;

  const load = useCallback(async () => {
    try {
      const next = await api<AdminWorkflowRead>("GET", api_);
      latest.current = next.workflow.draft?.definition ?? next.workflow.published?.definition ?? { steps: [], transitions: [], layout: {} };
      dirty.current = false;
      setRead(next);
      return next;
    } catch (error) {
      setRead(error instanceof ApiError && error.status === 404 ? "missing" : "failed");
      return null;
    }
  }, [api_]);
  useEffect(() => {
    void load();
    api<{ types: AdminWorkflowSummary[] }>("GET", "/v1/workflows").then((r) => setTypes(r.types), () => undefined);
  }, [load]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const show = (found: readonly WorkflowProblem[]) => {
    known.current = found;
    setProblems(found);
  };
  const check = useCallback(
    async (definition: WorkflowDefinition): Promise<readonly WorkflowProblem[]> => {
      try {
        const found = (await api<{ problems: WorkflowProblem[] }>("POST", `${api_}/validate`, { definition })).problems;
        show(found);
        return found;
      } catch {
        return known.current;
      }
    },
    [api_],
  );
  // The draft as it opens is checked once.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !read || typeof read === "string" || !latest.current) return;
    opened.current = true;
    void check(latest.current);
  }, [read, check]);

  const needReason = (): boolean => {
    if (reason.trim() !== "") return false;
    setReasonMissing(true);
    setNotice({ kind: "error", text: s.reasonNeeded });
    reasonInput.current?.focus();
    return true;
  };

  const onChange = useCallback((definition: WorkflowDefinition) => {
    latest.current = definition;
    dirty.current = true;
    setSaveState({ kind: "unsaved" });
  }, []);

  const saveDraft = async () => {
    if (needReason() || !latest.current) return;
    setSaveState({ kind: "saving" });
    setNotice(null);
    try {
      await api("POST", `${api_}/draft`, { definition: latest.current, reason: reason.trim() });
      dirty.current = false;
      setSaveState({ kind: "saved", at: new Date() });
      setNotice({ kind: "ok", text: s.saved });
      void check(latest.current);
    } catch {
      setSaveState({ kind: "failed" });
      setNotice({ kind: "error", text: s.saveFailed });
    }
  };

  const onValidate = useCallback(async () => check(latest.current!), [check]);

  const onPublish = async (changeNote: string): Promise<WorkflowPublishResult> => {
    if (needReason()) return { ok: false, problems: known.current };
    try {
      // The builder's change note is the Version's (RP-555); the reason is what admin_action logs (V9).
      const { versionNo } = await api<{ versionNo: number }>("POST", `${api_}/publish`, { definition: latest.current, reason: reason.trim(), changeNote });
      setNotice({ kind: "ok", text: s.published(versionNo) });
      opened.current = false;
      await load();
      return { ok: true, versionNo };
    } catch (error) {
      const found = error instanceof ApiError ? (error.body.problems as WorkflowProblem[] | undefined) : undefined;
      if (found) show(found);
      return { ok: false, problems: found ?? known.current };
    }
  };

  const duplicate = async () => {
    if (needReason() || copyFrom === "") return;
    setNotice(null);
    try {
      await api("POST", `${api_}/duplicate`, { fromTypeCode: copyFrom, reason: reason.trim() });
      opened.current = false;
      await load();
      setNotice({ kind: "ok", text: s.duplicated });
    } catch {
      setNotice({ kind: "error", text: s.refused });
    }
  };

  const positions = typeof read === "object" && read ? read.positions : [];
  const labels = useMemo<WorkflowBuilderLabels>(
    () =>
      workflowBuilderLabels({
        t: messagesOf(locale, "workflowBuilder"),
        tMap: messagesOf(locale, "workflowMap"),
        tRules: messagesOf(locale, "workflowRules"),
        tRoles: messagesOf(locale, "projects.roles"),
        positions,
        locale,
        names: builderNames(),
      }),
    [locale, positions],
  );

  if (read === null) return <p className="text-muted">{s.loading}</p>;
  if (read === "failed") return <p role="alert">{s.loadFailed}</p>;
  if (read === "missing") {
    return (
      <p role="alert">
        {s.notFound}{" "}
        <a href="#/" className="text-brand underline">
          {s.back}
        </a>
      </p>
    );
  }

  const { workflow } = read;
  const draftVersion = workflow.draft?.versionNo ?? Math.max(0, ...workflow.publishedVersions) + 1;
  const start = workflow.draft?.definition ?? workflow.published?.definition ?? { steps: [], transitions: [], layout: {} };
  const others = types.filter((t) => t.code !== typeCode);

  return (
    <div className="flex flex-col gap-4">
      <section aria-label={read.type.name[locale]} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold">
            <span dir="ltr">{read.type.code}</span> · {read.type.name[locale]}
          </h1>
          <Badge>{message(locale, `projectTabs.${read.moduleKey}`)}</Badge>
          {workflow.publishedVersions.map((v) => (
            <Badge key={v} tone={v === Math.max(...workflow.publishedVersions) ? "brand" : "neutral"}>
              <span dir="ltr">{s.version(v)}</span>
            </Badge>
          ))}
          {workflow.draft && <Badge tone="warning">{s.draftWaiting}</Badge>}
        </div>

        <div className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-sm border border-border bg-surface p-4">
          <Field label={s.reasonLabel} help={s.reasonHelp} required error={reasonMissing && reason.trim() === "" ? s.reasonNeeded : undefined} className="min-w-72 flex-1">
            <Input
              ref={reasonInput}
              value={reason}
              maxLength={1000}
              onChange={(e) => {
                setReason(e.target.value);
                setReasonMissing(false);
              }}
            />
          </Field>
          <Button onClick={() => void saveDraft()}>{saveState.kind === "saving" ? s.saving : s.saveDraft}</Button>
          <div className="flex flex-wrap items-end gap-2" role="group" aria-label={s.duplicateHeading}>
            <Field label={s.duplicateFrom} help={s.duplicateHelp} className="min-w-56">
              <Select
                value={copyFrom}
                onValueChange={setCopyFrom}
                placeholder={s.chooseType}
                options={others.map((t) => ({ value: t.code, label: `${t.code} · ${t.name[locale]}` }))}
              />
            </Field>
            <Button variant="secondary" onClick={() => void duplicate()} disabled={copyFrom === ""}>
              {s.duplicate}
            </Button>
          </div>
        </div>
        {notice && (
          <p role={notice.kind === "error" ? "alert" : "status"} className={notice.kind === "error" ? "text-danger" : "text-success"}>
            {notice.text}
          </p>
        )}
      </section>

      <div className="relative h-[calc(100dvh-14rem)] min-h-[640px] overflow-hidden rounded-sm border border-border">
        <WorkflowBuilder
          // A publish or a copy starts the builder again from what the server has.
          key={`${draftVersion}:${workflow.publishedVersions.length}:${workflow.draft ? JSON.stringify(workflow.draft.definition).length : 0}`}
          name={(workflow.draft?.name ?? workflow.name)[locale]}
          versionNo={draftVersion}
          published={workflow.published}
          definition={start}
          stages={read.stages}
          outcomes={read.outcomes}
          positions={read.positions}
          form={read.form}
          screens={read.screens}
          running={read.running}
          locale={locale}
          labels={labels}
          problems={problems}
          saveState={saveState}
          backHref="#/"
          onChange={onChange}
          onValidate={onValidate}
          onPublish={onPublish}
        />
      </div>

      <DefaultSets
        locale={locale}
        read={read}
        reason={reason}
        needReason={needReason}
        onChanged={() => {
          // The Stage and outcome sets feed the builder's pickers; its own edits stay.
          void api<AdminWorkflowRead>("GET", api_).then((next) => setRead((current) => (typeof current === "object" && current ? { ...current, stages: next.stages, outcomes: next.outcomes, outcomeSet: next.outcomeSet } : next)));
        }}
      />
    </div>
  );
}
