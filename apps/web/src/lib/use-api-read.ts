"use client";

import { useEffect, useState } from "react";
import { failed, loaded, loading, type Reading } from "@/lib/transition-gate";

/** GET `/api{path}` once `enabled`: loading until answered, failed for an error or a refusal. */
export function useApiRead<T>(path: string, enabled: boolean): Reading<T> {
  const [reading, setReading] = useState<Reading<T>>(loading);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    fetch(`/api${path}`)
      .then((res) => (res.ok ? (res.json() as Promise<T>) : Promise.reject(new Error(String(res.status)))))
      .then((value) => current && setReading(loaded(value)))
      .catch(() => current && setReading(failed));
    return () => {
      current = false;
    };
  }, [path, enabled]);
  return reading;
}
