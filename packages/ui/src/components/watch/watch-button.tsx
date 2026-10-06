"use client";

import type { Locale } from "@rabaed/domain";
import { useState } from "react";
import { Button } from "../button/button.tsx";
import { Icon } from "../icon/icon.tsx";

// The Watch / Watching button on the item page (RP-354; GLOSSARY "Watch";
// design/prompts/views-dashboard-notifications.md §6). It shows the viewer's own
// Watch only: never who else watches the item, nor how many do (visibility.md,
// the Watch row). A toggle: pressed while watching. Presentational: the page
// does the calls; a refusal leaves the state as it was and says so.

/* eslint-disable rabaed/no-ui-translations -- existing labels, still to move to the app's messages (RP-362 retro) */
const copy = {
  en: {
    watch: "Watch",
    watching: "Watching",
    refusals: {
      not_found: "This item is no longer available to you.",
      unavailable: "That didn't work. Try again.",
    },
  },
  ar: {
    watch: "مراقبة",
    watching: "قيد المراقبة",
    refusals: {
      not_found: "لم يعد هذا البند متاحًا لك.",
      unavailable: "لم ينجح ذلك. حاول مرة أخرى.",
    },
  },
} satisfies Record<Locale, unknown>;
/* eslint-enable rabaed/no-ui-translations */

type WatchRefusal = keyof (typeof copy)["en"]["refusals"];
/** Watch or Unwatch as the page calls it: a refusal by the API's error code. */
export type WatchCall = (watch: boolean) => Promise<{ ok: true } | { ok: false; reason: string }>;

export type WatchButtonProps = {
  locale: Locale;
  /** Whether the viewer watches the item now, as the API answered. */
  watching: boolean;
  /** Called with `true` to watch, `false` to stop. */
  onChange: WatchCall;
};

export function WatchButton({ locale, watching: initial, onChange }: WatchButtonProps) {
  const t = copy[locale];
  const [watching, setWatching] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !watching;
    setPending(true);
    setError(null);
    try {
      const result = await onChange(next);
      if (result.ok) setWatching(next);
      else setError(t.refusals[result.reason as WatchRefusal] ?? t.refusals.unavailable);
    } catch {
      setError(t.refusals.unavailable);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant={watching ? "secondary" : "ghost"} size="sm" aria-pressed={watching} disabled={pending} onClick={() => void toggle()}>
        <Icon name="eye" />
        {watching ? t.watching : t.watch}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
