"use client";

import { scopesFittingTrade, type ScopeChoice } from "@rabaed/domain";
import { useId } from "react";
import { Checkbox } from "../form/checkbox.tsx";
import { useFieldControl, type FieldControlProps } from "../form/field.tsx";
import { Select } from "../form/select.tsx";

// The Built-in Fields' controls (form-engine.md §1; RP-270): Trade and Location
// pick one of the values offered, Scopes pick any of the chosen Trade's Scopes,
// and a chosen Scope's Sub-scopes. The page decides what is offered (the values
// the filler's Visibility covers, active Scopes); the renderer only filters by Trade.

/** One value offered for Trade or Location, labelled in the viewer's language. */
export type BuiltInChoice = { id: string; label: string };

/** What the Built-in Fields offer, and how the read view names the answers. */
export type BuiltInChoices = {
  trades: readonly BuiltInChoice[];
  /** In tree order; the label carries the depth. */
  locations: readonly BuiltInChoice[];
  /** Each Scope before its Sub-scopes. */
  scopes: readonly (ScopeChoice & { label: string })[];
};

export const noChoices: BuiltInChoices = { trades: [], locations: [], scopes: [] };

/** The Built-in Fields' words, from the app's messages. */
export type BuiltInFieldLabels = { choose: string; chooseTradeFirst: string; noScopes: string };

/** Trade or Location: one of the values offered. */
export function BuiltInSelect({
  value,
  choices,
  labels,
  onChange,
}: {
  value: string;
  choices: readonly BuiltInChoice[];
  labels: BuiltInFieldLabels;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={value}
      placeholder={labels.choose}
      options={choices.map((c) => ({ value: c.id, label: c.label }))}
      onValueChange={onChange}
    />
  );
}

/**
 * Scopes: a checkbox for each Scope of the chosen Trade; once a Scope is chosen,
 * one for each of its Sub-scopes beneath it. Unchoosing a Scope unchooses its
 * Sub-scopes. Answers keep the order the Project lists them in.
 */
export function ScopesChecklist({
  chosen,
  tradeId,
  scopes,
  labels,
  onChange,
}: {
  chosen: readonly string[];
  tradeId: string;
  scopes: BuiltInChoices["scopes"];
  labels: BuiltInFieldLabels;
  onChange: (value: string[]) => void;
}) {
  const generated = useId();
  const { id = generated, labelId, "aria-describedby": describedBy } = useFieldControl<FieldControlProps>({});
  if (!tradeId) {
    return (
      <p id={id} className="text-sm text-muted">
        {labels.chooseTradeFirst}
      </p>
    );
  }
  const ofTrade = scopes.filter((s) => s.tradeId === tradeId);
  if (ofTrade.length === 0) {
    return (
      <p id={id} className="text-sm text-muted">
        {labels.noScopes}
      </p>
    );
  }
  const toggle = (scopeId: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(scopeId);
    else next.delete(scopeId);
    const ordered = scopes.filter((s) => next.has(s.id)).map((s) => s.id);
    onChange(scopesFittingTrade(ordered, tradeId, scopes));
  };
  const row = (scope: ScopeChoice & { label: string }) => {
    const itemId = `${id}-${scope.id}`;
    return (
      <div key={scope.id} className="flex items-center gap-2">
        <Checkbox
          id={itemId}
          required={false}
          checked={chosen.includes(scope.id)}
          onCheckedChange={(state) => toggle(scope.id, state === true)}
        />
        <label htmlFor={itemId} className="text-body text-text">
          {scope.label}
        </label>
      </div>
    );
  };
  return (
    <div role="group" id={id} aria-labelledby={labelId} aria-describedby={describedBy} className="flex flex-col gap-3">
      {ofTrade
        .filter((s) => s.parentId === null)
        .map((s) => {
          const subScopes = ofTrade.filter((sub) => sub.parentId === s.id);
          return (
            <div key={s.id} className="flex flex-col gap-3">
              {row(s)}
              {chosen.includes(s.id) && subScopes.length > 0 && (
                <div className="flex flex-col gap-3 ps-7">{subScopes.map(row)}</div>
              )}
            </div>
          );
        })}
    </div>
  );
}

/** The read view of a Built-in Field's answer: the chosen values' labels; none when unanswered. */
export function builtInAnswerLabels(type: "trade" | "location" | "scopes", value: unknown, choices: BuiltInChoices): string[] {
  const ids = Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
  const offered: readonly BuiltInChoice[] =
    type === "trade" ? choices.trades : type === "location" ? choices.locations : choices.scopes;
  return ids.map((id) => offered.find((c) => c.id === id)?.label).filter((label): label is string => !!label);
}
