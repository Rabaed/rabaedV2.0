"use client";

import type { BilingualText, Locale } from "@rabaed/domain";
import { Avatar } from "../data/avatar.tsx";
import { Icon, type IconName } from "../icon/icon.tsx";
import type { ActionSheetEffect } from "./action-sheet-model.ts";

/**
 * Parts of the Submittal Panel's Action Form sheet (RP-1237, gap table v3 rows 29, 30 and 39; the owner's
 * Anatomy V3 frames 11–17). Presentational: the app works out the effects (`actionSheetEffects`) and names
 * the signer, and gives every word.
 */

export type ActionSheetEffectsLabels = {
  /** "What happens when you confirm". */
  title: string;
  stage: (stage: string) => string;
  told: (company: string) => string;
  comments: (count: number, company: string | null) => string;
  revision: (company: string | null) => string;
  record: (code: string) => string;
};

const icons: Record<ActionSheetEffect["kind"], IconName> = {
  stage: "circle-check",
  told: "bell",
  comments: "list-check",
  revision: "git-branch",
  record: "file-text",
};

/** "What happens when you confirm" (row 30): one line per effect, wrapping into columns as the sheet widens. */
export function ActionSheetEffects({ effects, labels, locale }: { effects: readonly ActionSheetEffect[]; labels: ActionSheetEffectsLabels; locale: Locale }) {
  if (effects.length === 0) return null;
  const text = (effect: ActionSheetEffect) => {
    switch (effect.kind) {
      case "stage":
        return labels.stage(effect.name[locale]);
      case "told":
        return labels.told(effect.company[locale]);
      case "comments":
        return labels.comments(effect.count, effect.company?.[locale] ?? null);
      case "revision":
        return labels.revision(effect.company?.[locale] ?? null);
      case "record":
        return labels.record(effect.code);
    }
  };
  return (
    <section aria-label={labels.title} data-sheet-effects="" className="rounded-[12px] bg-surface-subtle px-3 py-3 shadow-[inset_0_0_0_1px_var(--border-subtle)]">
      <h3 className="mb-2 text-[11.5px] font-bold tracking-[0.06em] text-muted uppercase rtl:tracking-normal">{labels.title}</h3>
      <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-[13px] text-text-secondary sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        {effects.map((effect) => (
          <li key={effect.kind} className="flex items-start gap-2">
            <Icon name={icons[effect.kind]} size={16} className="mt-0.5 shrink-0 text-muted" />
            <span>{text(effect)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * "Signs as ‹name› · ‹Position›" (row 39): who the Transition is signed as, beside the sheet's buttons: the
 * Position the Step is narrowed to, else the Step's own name; none without either.
 */
export function ActionSheetSigner({ name, position, signsAs, locale }: { name: BilingualText; position: string | null; signsAs: string; locale: Locale }) {
  return (
    <p data-sheet-signer="" className="me-auto flex min-w-0 items-center gap-2 text-[13px] text-text-secondary">
      <Avatar name={name[locale]} size="sm" decorative />
      <span className="min-w-0">
        {signsAs} <span className="font-semibold text-text">{name[locale]}</span>
        {position && <span className="text-muted"> · {position}</span>}
      </span>
    </p>
  );
}
