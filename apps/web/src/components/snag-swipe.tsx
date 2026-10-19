"use client";

import type { Locale, WorkItemActions, WorkItemDetail } from "@rabaed/domain";
import { swipeActionsOf, type SnagSwipe } from "@rabaed/ui";
import { useRef, useState, type ReactNode } from "react";
import { TransitionPopup } from "@/components/transition-opening";

type Transition = WorkItemActions["transitions"][number];

/**
 * The Snag List cards' swipe actions on a phone (RP-630): a card's item is read when it is first
 * swiped, and its own `actions` (the list its page shows) give the buttons, so none is ever shown
 * that the API would refuse. A button opens that Transition's pop-up, as on the item's page and the
 * Kanban, after the Signature and Stamp checks (`TransitionOpening`).
 */
export function useSnagSwipe(locale: Locale): { swipe: SnagSwipe; dialog: ReactNode } {
  // What each item offered when read, for the pop-up of the one taken.
  const offered = useRef(new Map<string, { subject: string; transitions: Transition[] }>());
  const [taking, setTaking] = useState<{ workItemId: string; subject: string; transition: Transition } | null>(null);
  const swipe: SnagSwipe = {
    load: async (workItemId) => {
      const res = await fetch(`/api/v1/work-items/${workItemId}`).catch(() => null);
      if (!res?.ok) return null;
      const item = (await res.json()) as WorkItemDetail;
      offered.current.set(workItemId, { subject: item.title, transitions: item.actions.transitions });
      return swipeActionsOf(item.actions);
    },
    take: (workItemId, key) => {
      const item = offered.current.get(workItemId);
      const transition = item?.transitions.find((t) => t.key === key);
      // Kept while the card is: a pop-up closed without moving the item leaves the same buttons. An item
      // that moved is a new card (its key holds its Stage and Step time), which reads it again.
      if (item && transition) setTaking({ workItemId, subject: item.subject, transition });
    },
  };
  const dialog = taking && (
    <TransitionPopup key={`${taking.workItemId}:${taking.transition.key}`} {...taking} locale={locale} idPrefix="swipe-transition" onClose={() => setTaking(null)} />
  );
  return { swipe, dialog };
}
