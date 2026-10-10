import { useSyncExternalStore } from "react";

/**
 * Whether `query` matches, kept up to date. On the server, and in the first
 * render after it, `serverValue` (so the markup matches); then the real value.
 */
export function useMediaQuery(query: string, serverValue = true): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => matchMedia(query).matches,
    () => serverValue,
  );
}
