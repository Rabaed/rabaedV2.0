"use client";

import { useState } from "react";
import { cn } from "../../lib/cn.ts";
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
  /**
   * `topBar`: the Work Item page's top-bar button (RP-1151 row 4): the eye, or a bell on the brand
   * tint while watching; its words hidden under 560px, still its name.
   */
  look?: "default" | "topBar";
};

export function WatchButton({ labels, watching: initial, onChange, look = "default" }: WatchButtonProps) {
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
      else setError(labels.refusals[result.reason as WatchRefusal] ?? labels.refusals.unavailable);
    } catch {
      setError(labels.refusals.unavailable);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {look === "topBar" ? (
        <Button
          variant="secondary"
          size="sm"
          aria-pressed={watching}
          disabled={pending}
          onClick={() => void toggle()}
          className={cn("gap-1.5", watching && "bg-brand-tint text-brand-fg shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--brand)_35%,transparent)]")}
        >
          <Icon name={watching ? "bell-ringing" : "eye"} size={16} />
          <span className="wip-label">{watching ? labels.watching : labels.watch}</span>
        </Button>
      ) : (
        <Button variant={watching ? "secondary" : "ghost"} size="sm" aria-pressed={watching} disabled={pending} onClick={() => void toggle()}>
          <Icon name="eye" />
          {watching ? labels.watching : labels.watch}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
}
