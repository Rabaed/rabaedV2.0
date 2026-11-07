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

function onWrites(listener: () => void) {
  listeners.add(listener);
  const fromOtherTab = () => {
    writes += 1;
    listener();
  };
  window.addEventListener("storage", fromOtherTab);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", fromOtherTab);
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
    writes += 1;
    for (const listener of listeners) listener();
  }, [pathname, search, memberId]);
  return null;
}

/** Around the signed-in app (it stays mounted from page to page, so it sees the Member move on a tab). */
export function RememberedModuleQueries({ memberId, children }: { memberId: string; children: ReactNode }) {
  return (
    <MemberContext.Provider value={memberId}>
      <Suspense fallback={null}>
        <RememberWatch memberId={memberId} />
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
  const mounted = useSyncExternalStore(onWrites, () => writes, () => -1);
  return (href) => (mounted < 0 ? href : rememberedHref(rememberStorage(), memberId, href));
}

/** A link back to a Module tab, with the Member's remembered query (the item page's way back). */
export function RememberedModuleLink({ href, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const remembered = useRememberedHref();
  return <Link href={remembered(href)} {...props} />;
}
