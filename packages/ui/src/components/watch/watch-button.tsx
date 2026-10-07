"use client";

import { useState } from "react";
import { Button } from "../button/button.tsx";
import { Icon } from "../icon/icon.tsx";

// The Watch / Watching button on the item page (RP-354; GLOSSARY "Watch";
// design/prompts/views-dashboard-notifications.md §6). It shows the viewer's own
// Watch only: never who else watches the item, nor how many do (visibility.md,
// the Watch row). A toggle: pressed while watching. Presentational: the page
// does the calls; a refusal leaves the state as it was and says so.

/** The button's words, from the app's messages. */
export type WatchButtonLabels = {
  watch: string;
  watching: string;
  refusals: {
    not_found: string;
    unavailable: string;
  };
};

type WatchRefusal = keyof WatchButtonLabels["refusals"];
/** Watch or Unwatch as the page calls it: a refusal by the API's error code. */
export type WatchCall = (watch: boolean) => Promise<{ ok: true } | { ok: false; reason: string }>;

export type WatchButtonProps = {
  labels: WatchButtonLabels;
  /** Whether the viewer watches the item now, as the API answered. */
  watching: boolean;
  /** Called with `true` to watch, `false` to stop. */
  onChange: WatchCall;
};

export function WatchButton({ labels: t, watching: initial, onChange }: WatchButtonProps) {
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
