"use client";

import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";

/**
 * A notification's link to its item. Opening it marks that notification read;
 * if marking fails, the item still opens.
 */
export function NotificationLink({ id, href, unread, children }: { id: string; href: string; unread: boolean; children: ReactNode }) {
  function markRead() {
    if (!unread) return;
    // keepalive: the request finishes even as the page navigates away.
    void fetch("/api/v1/notifications/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
      keepalive: true,
    }).catch(() => undefined);
  }

  return (
    <Link href={href} onClick={markRead} className="font-medium text-primary underline underline-offset-4">
      {children}
    </Link>
  );
}
