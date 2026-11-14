// Duplicate (RP-409): a new Draft with the item's Subject and the viewer's own Company's answers and
// Documents, as new files. One call for every place that offers it, the List row's ⋯ menu and the
// Submittal Panel's bar (RP-1303), so neither can widen it: the API decides what is copied, and
// refuses anyone the item's `actions.duplicate` doesn't offer it to.

export type DuplicateResult = { ok: true; id: string } | { ok: false; reason: "too_large" | "failed" };

/** Duplicates the item; a key per call, so one press makes one Draft. */
export async function duplicateWorkItem(workItemId: string, deps: { fetch: (url: string, init: RequestInit) => Promise<Response> } = { fetch: (url, init) => fetch(url, init) }): Promise<DuplicateResult> {
  const res = await deps.fetch(`/api/v1/work-items/${workItemId}/duplicate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
  });
  if (!res.ok) {
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, reason: error === "duplicate_files_too_large" ? "too_large" : "failed" };
  }
  return { ok: true, id: ((await res.json()) as { id: string }).id };
}
