"use client";

import {
  formatNumber,
  forwardKinds,
  offersRevision,
  outcomeLook,
  type BilingualText,
  type Locale,
  type Outcome,
  type SignedInMember,
  type WorkItemDetail,
  type WorkItemHistory,
  type WorkItemWorkflowMap,
} from "@rabaed/domain";
import {
  Badge,
  Button,
  Icon,
  SaveStatus,
  SubmittalPanelCodeMenu,
  SubmittalPanelWaiting,
  sameName,
  submittalPanelBar,
  actionSheetEffects,
  transitionCodes,
  type SubmittalPanelBarTransition,
  type SubmittalPanelCodeMenuItem,
} from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { DownloadRecordButton } from "@/components/download-record-button";
import { DownloadWorkingCopyButton } from "@/components/download-working-copy-button";
import { OpenerAlert, useTransitionOpener } from "@/components/work-item-actions";
import { useSaveDraft, useWorkItemForm } from "@/components/work-item-form";
import { WorkItemRevision, useCreateRevision } from "@/components/work-item-revision";
import { transitionGoesTo } from "@/lib/transition-goes-to";
import { useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";

/**
 * The Submittal Panel's action bar (RP-1237, gap table v3 rows 22–28 and 48–51; the owner's Anatomy V3
 * part 9), the same at every size and at Full, which is the item's page: Download PDF always, then exactly
 * what the engine offers this Member (`submittalPanelBar`): Edit for the Form's holder (then Save Draft and
 * the saved time), Discard Revision, Create Revision or a replacement, the Transitions that issue no code
 * as buttons with the Workflow's labels, Return to pool, Pick up, and the code Transitions in the "Issue
 * Review Code ▾" menu, the primary, last. With nothing to press, a chip says where it waits. Each
 * Transition opens its Action Form through the Signature and Stamp checks, as before.
 */
export function SubmittalPanelActionBar({
  item,
  locale,
  outcomes,
  map,
  me,
  events,
  editing,
  onEdit,
}: {
  item: WorkItemDetail;
  locale: Locale;
  /** The item's Type's outcomes on the Project, in their order: a code's colour and what it does. */
  outcomes: readonly Outcome[];
  /** The Workflow map read: which Review Code each offered Transition issues. */
  map: WorkItemWorkflowMap | null;
  /** The viewer, once read: their own Company is never named as where a Transition goes. */
  me: SignedInMember | null;
  /** The history as the viewer may read it: who Submitted it here, for a Send Back's line. */
  events: WorkItemHistory["events"];
  editing: boolean;
  onEdit: () => void;
}) {
  const t = useTranslations("submittalPanel.bar");
  const tActions = useTranslations("workItems.actions");
  const tPopup = useTranslations("workItems.actions.popup");
  const tForm = useTranslations("workItems.form");
  const tSheet = useTranslations("submittalPanel.sheet");
  const form = useWorkItemForm();
  const saveDraft = useSaveDraft(locale);

  const codes = transitionCodes(item.actions.transitions, map?.definition ?? null);
  const outcomeOf = (code: string | undefined) => (code ? outcomes.find((o) => o.code === code) : undefined);
  const lookOf = (code: string | undefined) => {
    const outcome = outcomeOf(code);
    return outcome ? outcomeLook(outcome, [...outcomes]) : undefined;
  };
  const mine = me?.company.legalName ?? null;
  const own = (company: BilingualText) => mine !== null && sameName(company, mine);
  // A code goes to the raiser; a Send Back to whoever Submitted it here: the newest shared move by another
  // Company, which the viewer reads by its Company's name (V14: the hand-overs are shown). Never the viewer's own.
  const raiser = item.raisedBy.companyName;
  const submitter =
    [...events].reverse().find((e) => e.type === "transition" && e.audience === "shared" && e.by.companyName && !own(e.by.companyName))?.by.companyName ?? raiser;
  const where = (tr: SubmittalPanelBarTransition) => {
    const outcome = outcomeOf(codes[tr.key]);
    const goes = transitionGoesTo({ kind: tr.kind, offersRevision: outcome ? offersRevision(outcome) : false });
    const to = goes === "back" && tr.kind === "send_back" ? submitter : raiser;
    return { outcome, goes, to, named: goes !== null && !own(to) };
  };

  /** What a choice does, in one line (rows 24, 25): who is told, whether a Revision follows, where its Comments go. */
  const lineOf = (tr: SubmittalPanelBarTransition): string | undefined => {
    const { outcome, goes, to, named } = where(tr);
    if (tr.kind === "send_back") return named ? t("sendBack", { company: to[locale] }) : undefined;
    if (goes === "back") return named ? t("back", { company: to[locale] }) : t("backOwn");
    if (goes !== "closes") return undefined;
    const comments = outcome?.actions.some((a) => a.kind === "create_items") ? ` ${t("comments")}` : "";
    return `${named ? t("closes", { company: to[locale] }) : t("closesOwn")}${comments}`;
  };

  /** The Position the viewer's Step names, as the Workflow map words it ("Consultant Manager"); null without one. */
  const roleOf = (): string | null => {
    const step = map?.definition.steps.find((x) => x.key === item.step?.key);
    const actor = step?.actor;
    if (!actor || !("role" in actor) || !actor.positions?.[0]) return null;
    const position = actor.positions[0];
    return map?.positions.find((p) => p.role === actor.role && p.key === position)?.name[locale] ?? null;
  };
  const opener = useTransitionOpener(item.id, item.actions, locale, (tr) => {
    const code = codes[tr.key] ?? null;
    const { goes, to, named } = where(tr);
    return {
      code,
      look: lookOf(code ?? undefined),
      documentNumber: item.documentNumber,
      goesTo: !named ? null : goes === "back" ? tPopup("goesBackTo", { company: to[locale] }) : tPopup("closesFor", { company: to[locale] }),
      // Only a code's Remarks reach the raiser with the signer's name (V14); a move inside a Company promises nothing.
      remarksReader: tr.kind === "close" && code !== null && !own(raiser) ? raiser[locale] : null,
      ownCompany: mine?.[locale] ?? "",
      // The panel's sheet (RP-1237 rows 29, 30, 39): what it does, what happens on confirm, and who signs.
      sheet: {
        line: lineOf(tr),
        effects: (answers) => {
          const { outcome } = where(tr);
          const opens = outcome?.actions.some((a) => a.kind === "create_items") ?? false;
          return actionSheetEffects({
            transitionKey: tr.key,
            definition: map?.definition ?? null,
            stages: map?.stages ?? [],
            told: named ? to : null,
            code,
            offersRevision: outcome ? offersRevision(outcome) : false,
            // Code B's rows become its Comments (workflow-engine.md, the Screen's `items_to_create`).
            comments: opens ? (Array.isArray(answers.items_to_create) ? answers.items_to_create.length : 0) : null,
          });
        },
        effectsLabels: {
          title: tSheet("title"),
          stage: (stage) => tSheet("stage", { stage }),
          told: (company) => tSheet("told", { company }),
          comments: (count, company) => (company ? tSheet("comments", { count, n: formatNumber(count, locale), company }) : tSheet("commentsOwn", { count, n: formatNumber(count, locale) })),
          revision: (company) => (company ? tSheet("revision", { company }) : tSheet("revisionOwn")),
          record: (recorded) => tSheet("record", { code: recorded }),
        },
        signer: me ? { name: me.member.fullName, role: roleOf() ?? me.company.legalName[locale], signsAs: tSheet("signsAs") } : null,
        confirm: code ? tSheet("issue", { code }) : undefined,
      },
    };
  });

  const menuItem = (tr: SubmittalPanelBarTransition): SubmittalPanelCodeMenuItem => ({
    key: tr.key,
    ...(codes[tr.key] ? { code: codes[tr.key]!, look: lookOf(codes[tr.key]) } : {}),
    title: tr.label[locale],
    line: lineOf(tr),
    proposed: tr.proposed ? tActions("proposed") : undefined,
  });

  const waitingLabels = { pool: (count: number) => t("pool", { count, n: formatNumber(count, locale) }), pickedUp: (name: string) => t("pickedUp", { name }), viewOnly: t("viewOnly") };
  const bar = submittalPanelBar({ actions: item.actions, codes, heldBy: item.heldBy, stepAgeWeeks: item.stepAgeWeeks });
  const busy = opener.calls.pending || opener.waiting;
  const proposing = item.actions.transitions.some((tr) => tr.proposed);
  // Only a move forward is the primary (Send for review, Sign & submit); a Return, a Send Back or a Cancel never is.
  const primary = (tr: SubmittalPanelBarTransition) => forwardKinds.includes(tr.kind) && (!proposing || tr.proposed === true);
  const byKey = new Map(item.actions.transitions.map((tr) => [tr.key, tr]));
  const save = editing && form?.editable && saveDraft ? saveDraft : null;

  const returnToPool = bar.returnToPool && (
    <Button variant="secondary" disabled={opener.calls.pending} onClick={() => void opener.calls.send("return-to-pool")} className="gap-2">
      <Icon name="arrow-back-up" size={17} />
      {tActions("returnToPool")}
    </Button>
  );
  const transitionButton = (tr: SubmittalPanelBarTransition, variant: "primary" | "secondary") => (
    <Button key={tr.key} variant={variant} disabled={busy} aria-busy={opener.waiting || undefined} onClick={() => opener.open(tr)} className="gap-2">
      {tr.label[locale]}
      {tr.proposed && <Badge tone="neutral">{tActions("proposed")}</Badge>}
    </Button>
  );

  return (
    <>
      <OpenerAlert opener={opener} className="basis-full" />
      {save && form && <SaveStatus locale={locale} savedAt={form.savedAt} changedByOthers={save.changedByOthers} />}
      {/* Where it waits when the viewer has nothing to press: before Download PDF (V3 frame 19); the pool's chip after it, beside Pick up (frame 18). */}
      {bar.chip && bar.chip.kind !== "pool" && (
        <SubmittalPanelWaiting
          chip={bar.chip}
          locale={locale}
          labels={waitingLabels}
        />
      )}
      {/* Its Documental Record once closed, its Working Copy while open (V7): always there, for everyone. */}
      {item.outcome ? <DownloadRecordButton workItemId={item.id} status={item.documentalRecord} /> : <DownloadWorkingCopyButton workItemId={item.id} />}
      {bar.chip?.kind === "pool" && (
        <SubmittalPanelWaiting
          chip={bar.chip}
          locale={locale}
          labels={waitingLabels}
        />
      )}
      {bar.edit &&
        (save ? (
          <Button variant="secondary" disabled={save.button.disabled} onClick={() => void save.run()} className="gap-2">
            <Icon name="device-floppy" size={17} />
            {tForm(save.button.label)}
          </Button>
        ) : (
          <Button variant="secondary" onClick={onEdit} className="gap-2">
            <Icon name="pencil" size={17} />
            {t("edit")}
          </Button>
        ))}
      {bar.discardRevision && <WorkItemRevision workItemId={item.id} projectId={item.projectId} canCreate={false} canDiscard look="page" />}
      {bar.createRevision && <CreateRevisionButton key={item.id} workItemId={item.id} />}
      {bar.createReplacement && <CreateReplacementButton key={item.id} workItemId={item.id} />}
      {/* The other moves first (a Return, a Cancel), then the forward one; Return to pool just before the primary (row 49): the menu, or else the forward one. */}
      {bar.buttons.filter((tr) => !primary(tr)).map((tr) => transitionButton(tr, "secondary"))}
      {!bar.menu && returnToPool}
      {bar.buttons.filter(primary).map((tr) => transitionButton(tr, "primary"))}
      {bar.pickUp && (
        <Button disabled={opener.calls.pending} onClick={() => void opener.calls.send("pick-up")} className="gap-2">
          <Icon name="hand-grab" size={17} />
          {tActions("pickUp")}
        </Button>
      )}
      {bar.menu && returnToPool}
      {bar.menu && (
        <SubmittalPanelCodeMenu
          label={t("menu")}
          codes={bar.menu.codes.map(menuItem)}
          others={bar.menu.others.map(menuItem)}
          disabled={busy}
          busy={opener.waiting}
          onSelect={(key) => {
            const tr = byKey.get(key);
            if (tr) opener.open(tr);
          }}
        />
      )}
      {opener.dialogs}
    </>
  );
}

/**
 * Create Revision (only where the API offers it: after Code C), the item page's own call
 * (`useCreateRevision`): the new Revision opens in the panel, as a Draft.
 */
export function CreateRevisionButton({ workItemId }: { workItemId: string }) {
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
      <Button variant="secondary" disabled={pending} onClick={() => void run()} className="gap-2">
        <Icon name="git-branch" size={17} />
        {t("create")}
      </Button>
    </span>
  );
}

/**
 * Create replacement (RP-435), as the API offers it: on an item closed with an outcome that offers one.
 * The new Draft opens at once. The call carries an idempotency key, kept until it succeeds, so a double
 * click or a retry creates one.
 */
function CreateReplacementButton({ workItemId }: { workItemId: string }) {
  const t = useTranslations("replacement");
  const router = useRouter();
  const key = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setPending(true);
    setError(null);
    try {
      key.current ??= crypto.randomUUID();
      const res = await fetch(`/api/v1/work-items/${workItemId}/replacements`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: key.current }),
      });
      if (!res.ok) {
        const { error: reason } = (await res.json().catch(() => ({}))) as { error?: string };
        setError(t.has(`refusals.${reason}`) ? t(`refusals.${reason}`) : t("refusals.unavailable"));
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
      <Button variant="secondary" disabled={pending} onClick={() => void run()} className="gap-2">
        <Icon name="copy" size={17} />
        {t("create")}
      </Button>
    </span>
  );
}
