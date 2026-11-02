"use client";

import { useEffect, useState } from "react";
import { failed, loaded, loading, type Reading } from "@/lib/transition-gate";

/**
 * GET `/api{path}` once `enabled`: loading until answered, failed for an error or a refusal. A new
 * `again` reads it again, keeping the last answer meanwhile (the create panel's Form after a newer
 * Version, RP-1152); a new `path` reads as loading until its own answer comes.
 */
export function useApiRead<T>(path: string, enabled: boolean, again?: unknown): Reading<T> {
  const [read, setRead] = useState<{ path: string; reading: Reading<T> } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    fetch(`/api${path}`)
      .then((res) => (res.ok ? (res.json() as Promise<T>) : Promise.reject(new Error(String(res.status)))))
      .then((value) => current && setRead({ path, reading: loaded(value) }))
      .catch(() => current && setRead({ path, reading: failed }));
    return () => {
      current = false;
    };
  }, [path, enabled, again]);
  return read !== null && read.path === path ? read.reading : loading;
}
