"use client";

import { stageCategories, type AdminWorkflowRead, type BilingualText, type Locale, type Outcome, type OutcomeAction, type StageCategory } from "@rabaed/domain";
import { Badge, Button, Checkbox, Field, Input, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@rabaed/ui";
import { useState } from "react";
import { api, ApiError } from "./api.ts";
import { message } from "./messages.ts";
import { strings, type Strings } from "./strings.ts";

type Props = {
  locale: Locale;
  read: AdminWorkflowRead;
  reason: string;
  /** Asks for the reason when it is missing; true when it was. */
  needReason: () => boolean;
  onChanged: () => void;
};

/** What a refused edit says, in the page's language. */
const refusalText = (s: Strings, error: unknown): string => (error instanceof ApiError && error.status === 409 ? s.exists : s.refused);

/**
 * The Rabaed Default outcome set of the Type and Stage set of its Module (RP-443, WF-20).
 * Every edit is sent with the page's reason and logged in admin_action.
 */
export function DefaultSets({ locale, read, reason, needReason, onChanged }: Props) {
  const s = strings(locale);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  /** Runs an edit with the reason; the sets are read again after it. */
  const edit = async (path: string, body: Record<string, unknown>): Promise<boolean> => {
    if (needReason()) return false;
    try {
      await api("POST", path, { ...body, reason: reason.trim() });
      setNotice({ ok: true, text: s.done });
      onChanged();
      return true;
    } catch (error) {
      setNotice({ ok: false, text: refusalText(s, error) });
      return false;
    }
  };

  const typePath = `/v1/workflows/${encodeURIComponent(read.type.code)}`;
  const stagePath = `/v1/stages/${read.moduleKey}`;
  const moved = <T,>(items: T[], index: number, by: -1 | 1): T[] | null => {
    const to = index + by;
    if (to < 0 || to >= items.length) return null;
    const next = [...items];
    [next[index], next[to]] = [next[to]!, next[index]!];
    return next;
  };

  return (
    <div className="flex flex-col gap-8">
      {notice && (
        <p role={notice.ok ? "status" : "alert"} className={notice.ok ? "text-success" : "text-danger"}>
          {notice.text}
        </p>
      )}
      <OutcomeSet
        locale={locale}
        outcomes={read.outcomeSet}
        onAdd={(outcome) => edit(`${typePath}/outcomes`, outcome)}
        onChange={(code, name, actions) => edit(`${typePath}/outcomes/${encodeURIComponent(code)}`, { name, actions })}
        onMove={(index, by) => {
          const codes = moved(
            read.outcomeSet.map((o) => o.code),
            index,
            by,
          );
          return codes ? edit(`${typePath}/outcomes/order`, { codes }) : Promise.resolve(false);
        }}
      />
      <StageSet
        locale={locale}
        moduleKey={read.moduleKey}
        stages={read.stages}
        onAdd={(stage) => edit(stagePath, stage)}
        onRename={(key, name) => edit(`${stagePath}/${encodeURIComponent(key)}`, { name })}
        onMove={(index, by) => {
          const keys = moved(
            read.stages.map((st) => st.key),
            index,
            by,
          );
          return keys ? edit(`${stagePath}/order`, { keys }) : Promise.resolve(false);
        }}
      />
    </div>
  );
}

// eslint-disable-next-line rabaed/no-avoid-terms -- an outcome's follow-up actions: the outcome set's own term (workflow-engine.md).
const followUps = (actions: readonly OutcomeAction[], s: Strings): string => {
  if (actions.length === 0) return s.none;
  return actions.map((a) => (a.kind === "offer_revision" ? s.offerRevision : a.kind === "offer_replacement" ? s.offerReplacement : `${s.createItems} ${a.type}`)).join(", ");
};

function OutcomeSet({
  locale,
  outcomes,
  onAdd,
  onChange,
  onMove,
}: {
  locale: Locale;
  outcomes: Outcome[];
  onAdd: (outcome: Outcome) => Promise<boolean>;
  onChange: (code: string, name: BilingualText, actions: OutcomeAction[]) => Promise<boolean>;
  onMove: (index: number, by: -1 | 1) => Promise<boolean>;
}) {
  const s = strings(locale);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <section aria-labelledby="outcomes-heading" className="flex flex-col gap-3">
      <h2 id="outcomes-heading" className="text-lg font-semibold">
        {s.outcomesHeading}
      </h2>
      <p className="max-w-3xl text-muted">{s.outcomesHelp}</p>
      <Table label={s.outcomesHeading}>
        <TableHeader>
          <TableRow>
            <TableHead>{s.colCode}</TableHead>
            <TableHead>{s.colOutcome}</TableHead>
            <TableHead>{s.colClosing}</TableHead>
            <TableHead>{s.colPolarity}</TableHead>
            <TableHead>{s.colFollowUpActions}</TableHead>
            <TableHead>{s.colEdit}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {outcomes.map((o, index) =>
            editing === o.code ? (
              <TableRow key={o.code}>
                <TableCell colSpan={6}>
                  <OutcomeForm
                    locale={locale}
                    initial={o}
                    fixedCode
                    submitLabel={s.save}
                    onCancel={() => setEditing(null)}
                    onSubmit={async (next) => {
                      const ok = await onChange(o.code, next.name, next.actions);
                      if (ok) setEditing(null);
                    }}
                  />
                </TableCell>
              </TableRow>
            ) : (
              <TableRow key={o.code}>
                <TableCell>
                  <span dir="ltr" className="font-semibold">
                    {o.code}
                  </span>
                </TableCell>
                <TableCell>
                  <span lang="en" dir="ltr">
                    {o.name.en}
                  </span>
                  <br />
                  <span lang="ar" dir="rtl" className="text-muted">
                    {o.name.ar}
                  </span>
                </TableCell>
                <TableCell>{o.closing ? s.closing : s.notClosing}</TableCell>
                <TableCell>
                  <Badge tone={o.polarity === "positive" ? "success" : "danger"}>{o.polarity === "positive" ? s.positive : s.negative}</Badge>
                </TableCell>
                <TableCell>{followUps(o.actions, s)}</TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(o.code)}>
                      {s.edit}
                      <span className="sr-only"> {o.code}</span>
                    </Button>
                    <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => void onMove(index, -1)}>
                      {s.moveUp}
                      <span className="sr-only"> {o.code}</span>
                    </Button>
                    <Button size="sm" variant="ghost" disabled={index === outcomes.length - 1} onClick={() => void onMove(index, 1)}>
                      {s.moveDown}
                      <span className="sr-only"> {o.code}</span>
                    </Button>
                  </span>
                </TableCell>
              </TableRow>
            ),
          )}
        </TableBody>
      </Table>
      <div className="rounded-sm border border-border bg-surface p-4">
        <h3 className="mb-3 font-semibold">{s.addOutcome}</h3>
        <OutcomeForm locale={locale} submitLabel={s.add} onSubmit={async (next) => void (await onAdd(next))} />
      </div>
    </section>
  );
}

/** The fields of an outcome: the code, closing and result only while it is new. */
function OutcomeForm({
  locale,
  initial,
  fixedCode = false,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  locale: Locale;
  initial?: Outcome;
  fixedCode?: boolean;
  submitLabel: string;
  onSubmit: (outcome: Outcome) => Promise<void>;
  onCancel?: () => void;
}) {
  const s = strings(locale);
  const [code, setCode] = useState(initial?.code ?? "");
  const [nameEn, setNameEn] = useState(initial?.name.en ?? "");
  const [nameAr, setNameAr] = useState(initial?.name.ar ?? "");
  const [closing, setClosing] = useState(initial?.closing ?? true);
  const [polarity, setPolarity] = useState<Outcome["polarity"]>(initial?.polarity ?? "positive");
  const [revision, setRevision] = useState(initial?.actions.some((a) => a.kind === "offer_revision") ?? false);
  const [replacement, setReplacement] = useState(initial?.actions.some((a) => a.kind === "offer_replacement") ?? false);
  const [itemsType, setItemsType] = useState(initial?.actions.find((a) => a.kind === "create_items")?.type ?? "");

  const actions = (): OutcomeAction[] => [
    ...(revision ? [{ kind: "offer_revision" as const }] : []),
    ...(replacement ? [{ kind: "offer_replacement" as const }] : []),
    ...(itemsType.trim() ? [{ kind: "create_items" as const, type: itemsType.trim() }] : []),
  ];
  const submit = async () => {
    await onSubmit({ code: code.trim(), name: { en: nameEn.trim(), ar: nameAr.trim() }, closing, polarity, actions: actions() });
    if (!initial) {
      setCode("");
      setNameEn("");
      setNameAr("");
    }
  };
  const complete = code.trim() !== "" && nameEn.trim() !== "" && nameAr.trim() !== "";

  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label={s.colCode} required>
        <Input dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} disabled={fixedCode} maxLength={32} />
      </Field>
      <Field label={s.colNameEn} required>
        <Input dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} maxLength={200} />
      </Field>
      <Field label={s.colNameAr} required>
        <Input dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} maxLength={200} />
      </Field>
      <Field label={s.colPolarity}>
        <Select
          value={polarity}
          onValueChange={(v) => setPolarity(v as Outcome["polarity"])}
          disabled={fixedCode}
          options={[
            { value: "positive", label: s.positive },
            { value: "negative", label: s.negative },
          ]}
        />
      </Field>
      <Field label={s.colClosing} layout="inline">
        <Checkbox checked={closing} onCheckedChange={(v) => setClosing(v === true)} disabled={fixedCode} />
      </Field>
      <Field label={s.offerRevision} layout="inline">
        <Checkbox checked={revision} onCheckedChange={(v) => setRevision(v === true)} />
      </Field>
      <Field label={s.offerReplacement} layout="inline">
        <Checkbox checked={replacement} onCheckedChange={(v) => setReplacement(v === true)} />
      </Field>
      <Field label={`${s.createItems} (${s.createItemsType})`}>
        <Input dir="ltr" value={itemsType} onChange={(e) => setItemsType(e.target.value.toUpperCase())} maxLength={6} />
      </Field>
      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" disabled={!complete}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            {s.cancel}
          </Button>
        )}
      </div>
    </form>
  );
}

function StageSet({
  locale,
  moduleKey,
  stages,
  onAdd,
  onRename,
  onMove,
}: {
  locale: Locale;
  moduleKey: string;
  stages: AdminWorkflowRead["stages"];
  onAdd: (stage: { key: string; name: BilingualText; category: StageCategory }) => Promise<boolean>;
  onRename: (key: string, name: BilingualText) => Promise<boolean>;
  onMove: (index: number, by: -1 | 1) => Promise<boolean>;
}) {
  const s = strings(locale);
  const [editing, setEditing] = useState<string | null>(null);
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [addEn, setAddEn] = useState("");
  const [addAr, setAddAr] = useState("");
  const [key, setKey] = useState("");
  const [category, setCategory] = useState<StageCategory>("in_progress");
  const moduleName = message(locale, `projectTabs.${moduleKey}`);

  return (
    <section aria-labelledby="stages-heading" className="flex flex-col gap-3">
      <h2 id="stages-heading" className="text-lg font-semibold">
        {s.stagesHeading}
      </h2>
      <p className="max-w-3xl text-muted">{s.stagesHelp(moduleName)}</p>
      <Table label={s.stagesHeading}>
        <TableHeader>
          <TableRow>
            <TableHead>{s.colKey}</TableHead>
            <TableHead>{s.colStage}</TableHead>
            <TableHead>{s.colCategory}</TableHead>
            <TableHead>{s.colEdit}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stages.map((st, index) =>
            editing === st.key ? (
              <TableRow key={st.key}>
                <TableCell colSpan={4}>
                  <form
                    className="grid gap-3 sm:grid-cols-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void onRename(st.key, { en: nameEn.trim(), ar: nameAr.trim() }).then((ok) => ok && setEditing(null));
                    }}
                  >
                    <Field label={s.colNameEn} required>
                      <Input dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} maxLength={200} />
                    </Field>
                    <Field label={s.colNameAr} required>
                      <Input dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} maxLength={200} />
                    </Field>
                    <div className="flex items-end gap-2">
                      <Button type="submit" disabled={nameEn.trim() === "" || nameAr.trim() === ""}>
                        {s.save}
                      </Button>
                      <Button variant="ghost" onClick={() => setEditing(null)}>
                        {s.cancel}
                      </Button>
                    </div>
                  </form>
                </TableCell>
              </TableRow>
            ) : (
              <TableRow key={st.key}>
                <TableCell>
                  <span dir="ltr" className="font-semibold">
                    {st.key}
                  </span>
                </TableCell>
                <TableCell>
                  <span lang="en" dir="ltr">
                    {st.name.en}
                  </span>
                  <br />
                  <span lang="ar" dir="rtl" className="text-muted">
                    {st.name.ar}
                  </span>
                </TableCell>
                <TableCell>{s.categories[st.category] ?? st.category}</TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setNameEn(st.name.en);
                        setNameAr(st.name.ar);
                        setEditing(st.key);
                      }}
                    >
                      {s.edit}
                      <span className="sr-only"> {st.key}</span>
                    </Button>
                    <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => void onMove(index, -1)}>
                      {s.moveUp}
                      <span className="sr-only"> {st.key}</span>
                    </Button>
                    <Button size="sm" variant="ghost" disabled={index === stages.length - 1} onClick={() => void onMove(index, 1)}>
                      {s.moveDown}
                      <span className="sr-only"> {st.key}</span>
                    </Button>
                  </span>
                </TableCell>
              </TableRow>
            ),
          )}
        </TableBody>
      </Table>
      <form
        className="grid gap-3 rounded-sm border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          void onAdd({ key: key.trim(), name: { en: addEn.trim(), ar: addAr.trim() }, category }).then((ok) => {
            if (ok) {
              setKey("");
              setAddEn("");
              setAddAr("");
            }
          });
        }}
      >
        <h3 className="font-semibold sm:col-span-2 lg:col-span-4">{s.addStage}</h3>
        <Field label={s.colKey} required>
          <Input dir="ltr" value={key} onChange={(e) => setKey(e.target.value)} maxLength={63} />
        </Field>
        <Field label={s.colNameEn} required>
          <Input dir="ltr" value={addEn} onChange={(e) => setAddEn(e.target.value)} maxLength={200} />
        </Field>
        <Field label={s.colNameAr} required>
          <Input dir="rtl" value={addAr} onChange={(e) => setAddAr(e.target.value)} maxLength={200} />
        </Field>
        <Field label={s.colCategory}>
          <Select value={category} onValueChange={(v) => setCategory(v as StageCategory)} options={stageCategories.map((c) => ({ value: c, label: s.categories[c] ?? c }))} />
        </Field>
        <div className="sm:col-span-2 lg:col-span-4">
          <Button type="submit" disabled={key.trim() === "" || addEn.trim() === "" || addAr.trim() === ""}>
            {s.add}
          </Button>
        </div>
      </form>
    </section>
  );
}
