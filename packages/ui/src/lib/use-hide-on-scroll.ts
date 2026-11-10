"use client";

import { useEffect, useState } from "react";

// Less than this between two scroll events is a jitter (a finger resting on the glass), not a direction.
const jitter = 8;
// Never hidden this near the top, where the bars cover nothing.
const top = 56;

/**
 * Whether the page's bars should be out of the way: true once the window scrolls down, false again as soon
 * as it scrolls up (RP-1272, the phone's top bar and Project tabs). Always false while `enabled` is false.
 * Also returns `show`, to bring them back at once, e.g. when keyboard focus moves into them.
 */
export function useHideOnScroll(enabled: boolean): [hidden: boolean, show: () => void] {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let last = scrollY;
    const onScroll = () => {
      const y = scrollY;
      if (Math.abs(y - last) < jitter) return;
      setHidden(y > last && y > top);
      last = y;
    };
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, [enabled]);
  return [enabled && hidden, () => setHidden(false)];
}
