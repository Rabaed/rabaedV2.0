"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, Suspense, useContext, useEffect, useRef, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { queryToRemember, rememberedHref, rememberStorage, seenAt, writeRemembered, type Seen } from "@/lib/remembered-module-query";

// A Module tab's last query, kept for the signed-in Member in their own browser (RP-1240; the rules
// are in lib/remembered-module-query). Here: who the Member is, the watch on the URL that writes
// it, and the links back to a tab that read it.

const MemberContext = createContext<string | null>(null);

/** Bumped on every write, here or in another of the browser's tabs, so the links read it again. */
let writes = 0;
const listeners = new Set<() => void>();

function written() {
  writes += 1;
  for (const listener of listeners) listener();
}

/** `useSyncExternalStore`'s hook-up: one `storage` listener (another tab's writes) while any link reads. */
function onWrites(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", written);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", written);
  };
}

/** Watches the page's URL and keeps the query the Member changes on a Module tab. */
function RememberWatch({ memberId }: { memberId: string }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const prev = useRef<Seen>(null);
  useEffect(() => {
    const now = seenAt(pathname, search);
    const query = queryToRemember(prev.current, now);
    prev.current = now;
    if (query === null || !now) return;
    writeRemembered(rememberStorage(), memberId, now, query);
    written();
  }, [pathname, search, memberId]);
  return null;
}

/** Around the signed-in app (it stays mounted from page to page, so it sees the Member move on a tab). */
export function RememberedModuleQueries({ memberId, children }: { memberId: string; children: ReactNode }) {
  return (
    <MemberContext.Provider value={memberId}>
      <Suspense fallback={null}>
        {/* Keyed by the Member: another Member's first page starts afresh, never compared with the last one's. */}
        <RememberWatch key={memberId} memberId={memberId} />
      </Suspense>
      {children}
    </MemberContext.Provider>
  );
}

/**
 * Puts the Member's remembered query on a link to a Module tab that has none of its own. The
 * server, which has no storage, draws the bare link; the browser fills it in once mounted.
 */
export function useRememberedHref(): (href: string) => string {
  const memberId = useContext(MemberContext);
  // The server's snapshot is -1: it draws the bare link, and so does the browser until hydrated.
  const writesSeen = useSyncExternalStore(onWrites, () => writes, () => -1);
  return (href) => (writesSeen < 0 ? href : rememberedHref(rememberStorage(), memberId, href));
}

/** A link back to a Module tab, with the Member's remembered query (the item, New, Imports and Package pages' way back). */
export function RememberedModuleLink({ href, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const remembered = useRememberedHref();
  return <Link href={remembered(href)} {...props} />;
}
