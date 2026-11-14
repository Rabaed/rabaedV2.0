import { describe, expect, it, vi } from "vitest";
import { duplicateProblemKey, duplicateWorkItem } from "./duplicate-work-item.ts";

// RP-1303: the Submittal Panel's Duplicate and the List row's ⋯ menu Duplicate make one call, this one:
// the same endpoint and body (RP-409), so the panel widens nothing. The API decides what may be copied
// (only the viewer's own Company's work) and refuses the rest.

const id = "5f0c6a1e-2b7d-4c39-9d3e-1a2b3c4d5e6f";

describe("duplicating a Work Item", () => {
  it("posts to the item's duplicate endpoint with a fresh idempotency key, and gives the new Draft's id", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ id: "new-draft" }, { status: 201 }));
    expect(await duplicateWorkItem(id, { fetch })).toEqual({ ok: true, id: "new-draft" });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`/api/v1/work-items/${id}/duplicate`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    const body = JSON.parse(init.body as string) as { idempotencyKey: string };
    expect(Object.keys(body)).toEqual(["idempotencyKey"]);
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("names the row menu's message for each refusal, one map for the List row and the panel", () => {
    expect(duplicateProblemKey("too_large")).toBe("duplicateTooLarge");
    expect(duplicateProblemKey("failed")).toBe("failed");
  });

  // As the List row always did: a key per press. The button itself refuses a second press while one runs.
  it("uses a new key each time, so each press is its own request", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ id: "x" }, { status: 201 }));
    await duplicateWorkItem(id, { fetch });
    await duplicateWorkItem(id, { fetch });
    const keys = fetch.mock.calls.map(([, init]) => (JSON.parse(init.body as string) as { idempotencyKey: string }).idempotencyKey);
    expect(new Set(keys).size).toBe(2);
  });

  it("says when the files are too large to copy, and is a plain failure for any other refusal", async () => {
    const tooLarge = vi.fn(async () => Response.json({ error: "duplicate_files_too_large" }, { status: 409 }));
    expect(await duplicateWorkItem(id, { fetch: tooLarge })).toEqual({ ok: false, reason: "too_large" });
    for (const error of ["not_found", "duplicate_not_allowed", "project_closed"]) {
      const refused = vi.fn(async () => Response.json({ error }, { status: 404 }));
      expect(await duplicateWorkItem(id, { fetch: refused })).toEqual({ ok: false, reason: "failed" });
    }
    const broken = vi.fn(async () => new Response("boom", { status: 500 }));
    expect(await duplicateWorkItem(id, { fetch: broken })).toEqual({ ok: false, reason: "failed" });
  });
});
