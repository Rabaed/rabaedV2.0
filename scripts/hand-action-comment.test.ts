import { describe, expect, it } from "vitest";
import { commentOnHandAction, handAction, overHttp, type HandActionGitHub, type IssueEvent, type PrComment } from "./hand-action-comment.ts";
import { pnpmQueueComment } from "./queue-marker.ts";

// RP-1195 item 3: a `reviewed` label, auto-merge or a queue entry made by hand gets one comment
// naming who did it, so the session learns why Reviewed required fails (or what `pnpm queue` skipped).

const HEAD = "a".repeat(40);
const REPO = "Rabaed/rabaedV2.0";

/** A pull_request_target payload as GitHub sends it, cut to the fields the script reads. */
const payload = (action: string, extra: Record<string, unknown> = {}) => ({
  action,
  pull_request: { number: 640, head: { sha: HEAD, repo: { full_name: REPO } }, auto_merge: null },
  repository: { full_name: REPO },
  sender: { login: "mmhaleess90", type: "User" },
  ...extra,
});

describe("handAction", () => {
  it("names a person who added reviewed by hand", () => {
    expect(handAction("pull_request_target", payload("labeled", { label: { name: "reviewed" } }), { comments: [] })).toEqual({
      kind: "reviewed",
      actor: "mmhaleess90",
      pr: 640,
      head: HEAD,
      failsReviewedRequired: true,
    });
  });

  it.each([
    ["reviewed-add's login", { login: "github-actions[bot]", type: "Bot" }],
    ["any Bot account", { login: "renovate", type: "Bot" }],
    ["a login ending [bot]", { login: "some-app[bot]", type: "User" }],
  ])("says nothing when %s adds reviewed", (_, sender) => {
    expect(handAction("pull_request_target", payload("labeled", { label: { name: "reviewed" }, sender }), { comments: [] })).toBeUndefined();
  });

  it("says nothing for another label, another event or a fork's PR", () => {
    const labeled = payload("labeled", { label: { name: "infra" } });
    expect(handAction("pull_request_target", labeled, { comments: [] })).toBeUndefined();
    expect(handAction("pull_request", payload("labeled", { label: { name: "reviewed" } }), { comments: [] })).toBeUndefined();
    expect(handAction("pull_request_target", payload("synchronize"), { comments: [] })).toBeUndefined();
    const fork = payload("labeled", { label: { name: "reviewed" } });
    fork.pull_request.head.repo = { full_name: "someone/rabaedV2.0" };
    expect(handAction("pull_request_target", fork, { comments: [] })).toBeUndefined();
  });

  it("names who turned auto-merge on", () => {
    const event = payload("auto_merge_enabled", { pull_request: { ...payload("x").pull_request, auto_merge: { enabled_by: { login: "mmhaleess90" } } } });
    expect(handAction("pull_request_target", event, { comments: [] })).toMatchObject({ kind: "auto-merge", actor: "mmhaleess90", failsReviewedRequired: true });
  });

  describe("a queue entry", () => {
    const MARKED_AT = "2026-11-02T10:00:00Z";
    const marker = (sha: string, user = { login: "mmhaleess90", type: "User" }, author_association = "OWNER", created_at = MARKED_AT) => ({
      body: `Queued by \`pnpm queue\`.\n<!-- pnpm-queue: ${sha} -->`,
      user,
      author_association,
      created_at,
    });
    const enqueued = () => payload("enqueued");
    const added = (created_at: string) => ({ event: "added_to_merge_queue", created_at });
    const left = (created_at: string) => ({ event: "removed_from_merge_queue", created_at });
    const ownEntry = [added("2026-11-02T10:00:01Z")];

    it("says nothing for the entry `pnpm queue` marked just before it", () => {
      expect(handAction("pull_request_target", enqueued(), { comments: [marker(HEAD)], events: ownEntry })).toBeUndefined();
      // The same second counts: GitHub's times are whole seconds.
      expect(handAction("pull_request_target", enqueued(), { comments: [marker(HEAD)], events: [added(MARKED_AT)] })).toBeUndefined();
    });

    // RP-1195 review: queue-marker.ts builds the marker, this script matches it inline; the two must change together.
    it("matches the comment queue-marker.ts builds, for that head only", () => {
      const built = (sha: string) => ({ body: pnpmQueueComment(sha), user: { login: "mmhaleess90", type: "User" }, author_association: "OWNER", created_at: MARKED_AT });
      expect(handAction("pull_request_target", enqueued(), { comments: [built(HEAD)], events: ownEntry })).toBeUndefined();
      expect(handAction("pull_request_target", enqueued(), { comments: [built("b".repeat(40))], events: ownEntry })).toMatchObject({ kind: "queue" });
    });

    it("does not count a marker typed after a button entry", () => {
      const after = marker(HEAD, undefined, undefined, "2026-11-02T10:01:00Z");
      expect(handAction("pull_request_target", enqueued(), { comments: [after], events: ownEntry })).toMatchObject({ kind: "queue" });
      // Only the head's newest marker counts, and another head's newer marker does not hide this head's.
      expect(handAction("pull_request_target", enqueued(), { comments: [marker(HEAD), after], events: ownEntry })).toMatchObject({ kind: "queue" });
      expect(handAction("pull_request_target", enqueued(), { comments: [marker(HEAD), marker("b".repeat(40), undefined, undefined, "2026-11-02T10:01:00Z")], events: ownEntry })).toBeUndefined();
    });

    it("takes the time it runs when no queue entry is listed yet", () => {
      expect(handAction("pull_request_target", enqueued(), { comments: [marker(HEAD)], events: [], now: new Date("2026-11-02T10:00:30Z") })).toBeUndefined();
      expect(handAction("pull_request_target", enqueued(), { comments: [marker(HEAD)], events: [], now: new Date("2026-11-02T09:59:00Z") })).toMatchObject({ kind: "queue" });
    });

    // RP-1195 follow-up (Main 6): a marker from an entry that was later dropped does not excuse a button re-entry.
    it("does not count a marker once the PR left the queue after it", () => {
      const reentered = [added("2026-11-02T10:00:01Z"), left("2026-11-02T10:20:00Z"), added("2026-11-02T10:30:00Z")];
      expect(handAction("pull_request_target", enqueued(), { comments: [marker(HEAD)], events: reentered })).toMatchObject({ kind: "queue" });
      // A drop in the marker's own second counts as after it (#639's review: same-second drops).
      expect(handAction("pull_request_target", enqueued(), { comments: [marker(HEAD)], events: [added(MARKED_AT), left(MARKED_AT), added("2026-11-02T10:05:00Z")] })).toMatchObject({ kind: "queue" });
      // A removal of an earlier entry, before the marker, does not.
      expect(handAction("pull_request_target", enqueued(), { comments: [marker(HEAD)], events: [added("2026-11-02T09:00:00Z"), left("2026-11-02T09:59:00Z"), ...ownEntry] })).toBeUndefined();
    });

    it("does not count a marker followed by two entries, even with no removal listed", () => {
      expect(handAction("pull_request_target", enqueued(), { comments: [marker(HEAD)], events: [...ownEntry, added("2026-11-02T10:30:00Z")] })).toMatchObject({ kind: "queue" });
    });

    it("does not count a marker when the PR's events, or one of their times, could not be read", () => {
      expect(handAction("pull_request_target", enqueued(), { comments: [marker(HEAD)] })).toMatchObject({ kind: "queue" });
      expect(handAction("pull_request_target", enqueued(), { comments: [marker(HEAD)], events: [{ event: "removed_from_merge_queue" }, ...ownEntry] })).toMatchObject({ kind: "queue" });
    });

    it("names who queued it when no marker names the head, and says Reviewed required still passes", () => {
      expect(handAction("pull_request_target", payload("enqueued"), { comments: [marker("b".repeat(40))] })).toEqual({
        kind: "queue",
        actor: "mmhaleess90",
        pr: 640,
        head: HEAD,
        failsReviewedRequired: false,
      });
    });

    it("counts a marker only from a person with access to the repository", () => {
      const stranger = marker(HEAD, { login: "someone", type: "User" }, "NONE");
      const bot = marker(HEAD, { login: "github-actions[bot]", type: "Bot" }, "NONE");
      expect(handAction("pull_request_target", payload("enqueued"), { comments: [stranger, bot] })).toMatchObject({ kind: "queue" });
    });

    it("says Reviewed required fails when auto-merge put it there", () => {
      const event = payload("enqueued", { pull_request: { ...payload("x").pull_request, auto_merge: { enabled_by: { login: "mmhaleess90" } } } });
      expect(handAction("pull_request_target", event, { comments: [] })).toMatchObject({ kind: "queue", failsReviewedRequired: true });
    });
  });
});

/** A fake GitHub holding the PR's comments; records what gets posted. */
const github = (comments: PrComment[] = [], events: () => IssueEvent[] = () => []) => {
  const posted: { pr: number; body: string }[] = [];
  const seam: HandActionGitHub = {
    comments: async () => comments,
    events: async () => events(),
    postComment: async (pr, body) => {
      posted.push({ pr, body });
    },
  };
  return { seam, posted };
};

describe("commentOnHandAction", () => {
  const reviewed = payload("labeled", { label: { name: "reviewed" } });
  const ownMarker = `<!-- hand-action: reviewed mmhaleess90 ${HEAD} -->`;

  it("names the person, says it fails Reviewed required and how to undo it", async () => {
    const { seam, posted } = github();
    await commentOnHandAction("pull_request_target", reviewed, seam);
    expect(posted).toEqual([
      {
        pr: 640,
        body: `${ownMarker}\n\`mmhaleess90\` added the \`reviewed\` label by hand: this fails Reviewed required. Remove it (\`gh pr edit 640 --remove-label reviewed\`) and run \`pnpm queue 640\`.`,
      },
    ]);
  });

  it("tells auto-merge to be turned off", async () => {
    const { seam, posted } = github();
    await commentOnHandAction("pull_request_target", payload("auto_merge_enabled"), seam);
    expect(posted[0]?.body).toContain("`mmhaleess90` turned auto-merge on: this fails Reviewed required. Turn it off (`gh pr merge 640 --disable-auto`) and run `pnpm queue 640`.");
    expect(posted[0]?.body).toContain(`<!-- hand-action: auto-merge mmhaleess90 ${HEAD} -->`);
  });

  it("says a button entry skips `pnpm queue`'s checks, not that it fails Reviewed required", async () => {
    const { seam, posted } = github();
    await commentOnHandAction("pull_request_target", payload("enqueued"), seam);
    expect(posted[0]?.body).toContain(
      "`mmhaleess90` put this PR in the merge queue without `pnpm queue`: this skips `pnpm queue`'s checks. Remove it from the queue and run `pnpm queue 640`.",
    );
  });

  it("says an auto-merge entry fails Reviewed required", async () => {
    const { seam, posted } = github();
    const event = payload("enqueued", { pull_request: { ...payload("x").pull_request, auto_merge: { enabled_by: { login: "mmhaleess90" } } } });
    await commentOnHandAction("pull_request_target", event, seam);
    expect(posted[0]?.body).toContain("without `pnpm queue`: this fails Reviewed required. Remove it from the queue");
  });

  // RP-1195 review: auto-merge's own comment already says what to undo; the entry it makes needs no second one.
  it("posts nothing for an auto-merge entry when the head's auto-merge comment is there", async () => {
    const autoMerged = { body: `<!-- hand-action: auto-merge someone ${HEAD} -->\ntext`, user: { login: "github-actions[bot]", type: "Bot" } };
    const event = payload("enqueued", { pull_request: { ...payload("x").pull_request, auto_merge: { enabled_by: { login: "mmhaleess90" } } } });
    const { seam, posted } = github([autoMerged]);
    expect(await commentOnHandAction("pull_request_target", event, seam)).toBeUndefined();
    expect(posted).toEqual([]);
    // Another head's, a person's copy, or a button entry with auto-merge off still gets its comment.
    const other = github([{ ...autoMerged, body: `<!-- hand-action: auto-merge someone ${"b".repeat(40)} -->` }, { ...autoMerged, user: { login: "someone", type: "User" } }]);
    await commentOnHandAction("pull_request_target", event, other.seam);
    expect(other.posted).toHaveLength(1);
    const button = github([autoMerged]);
    await commentOnHandAction("pull_request_target", payload("enqueued"), button.seam);
    expect(button.posted).toHaveLength(1);
  });

  describe("a `pnpm queue` marker and the PR's queue events (RP-1195 follow-up)", () => {
    const queueComment = { body: pnpmQueueComment(HEAD), user: { login: "mmhaleess90", type: "User" }, author_association: "OWNER", created_at: "2026-11-02T10:00:00Z" };
    const entry = () => payload("enqueued");

    it("comments on a button entry after the marker's entry was dropped", async () => {
      const { seam, posted } = github([queueComment], () => [
        { event: "added_to_merge_queue", created_at: "2026-11-02T10:00:01Z" },
        { event: "removed_from_merge_queue", created_at: "2026-11-02T10:20:00Z" },
        { event: "added_to_merge_queue", created_at: "2026-11-02T10:30:00Z" },
      ]);
      await commentOnHandAction("pull_request_target", entry(), seam);
      expect(posted).toHaveLength(1);
      expect(posted[0]?.body).toContain("without `pnpm queue`");
    });

    it("posts nothing for the marker's own entry", async () => {
      const { seam, posted } = github([queueComment], () => [{ event: "added_to_merge_queue", created_at: "2026-11-02T10:00:01Z" }]);
      expect(await commentOnHandAction("pull_request_target", entry(), seam)).toBeUndefined();
      expect(posted).toEqual([]);
    });

    it("comments when the events cannot be read", async () => {
      const { seam, posted } = github([queueComment], () => {
        throw new Error("GitHub GET â€¦ answered 403");
      });
      await commentOnHandAction("pull_request_target", entry(), seam);
      expect(posted).toHaveLength(1);
    });
  });

  it("posts once per action: a re-run finds its own comment", async () => {
    const { seam, posted } = github([{ body: `${ownMarker}\nold text`, user: { login: "github-actions[bot]", type: "Bot" } }]);
    expect(await commentOnHandAction("pull_request_target", reviewed, seam)).toBeUndefined();
    expect(posted).toEqual([]);
  });

  it("posts again for a new head or another person, and when a person typed the marker", async () => {
    const typed = { body: ownMarker, user: { login: "someone", type: "User" }, author_association: "OWNER" };
    const { seam, posted } = github([typed]);
    await commentOnHandAction("pull_request_target", reviewed, seam);
    const later = payload("labeled", { label: { name: "reviewed" }, sender: { login: "other", type: "User" } });
    await commentOnHandAction("pull_request_target", later, seam);
    expect(posted.map((each) => each.body.split("\n")[0])).toEqual([ownMarker, `<!-- hand-action: reviewed other ${HEAD} -->`]);
  });

  it("posts nothing for an event with nothing to say", async () => {
    const { seam, posted } = github();
    expect(await commentOnHandAction("pull_request_target", payload("synchronize"), seam)).toBeUndefined();
    expect(posted).toEqual([]);
  });

  it("keeps a backtick in a login from breaking out of its code span", async () => {
    const { seam, posted } = github();
    await commentOnHandAction("pull_request_target", payload("auto_merge_enabled", { sender: { login: "a`b", type: "User" } }), seam);
    expect(posted[0]?.body).toContain("`ab` turned auto-merge on");
  });
});

describe("overHttp", () => {
  const answering = (pages: unknown[][], status = 200) => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const page = Number(new URL(url).searchParams.get("page") ?? "1");
      return new Response(JSON.stringify(pages[page - 1] ?? []), { status });
    }) as typeof fetch;
    return { calls, github: overHttp(REPO, "t0ken", fetcher) };
  };

  it("reads every page of the PR's comments", async () => {
    const full = Array.from({ length: 100 }, (_, at) => ({ body: `c${at}` }));
    const { calls, github } = answering([full, [{ body: "last" }]]);
    expect(await github.comments(640)).toHaveLength(101);
    expect(calls.map((call) => call.url)).toEqual([
      `https://api.github.com/repos/${REPO}/issues/640/comments?per_page=100&page=1`,
      `https://api.github.com/repos/${REPO}/issues/640/comments?per_page=100&page=2`,
    ]);
    expect(new Headers(calls[0]?.init?.headers).get("Authorization")).toBe("Bearer t0ken");
  });

  it("reads every page of the PR's issue events", async () => {
    const full = Array.from({ length: 100 }, () => ({ event: "labeled", created_at: "2026-11-02T10:00:00Z" }));
    const { calls, github } = answering([full, [{ event: "removed_from_merge_queue", created_at: "2026-11-02T10:00:00Z" }]]);
    expect(await github.events(640)).toHaveLength(101);
    expect(calls.map((call) => call.url)).toEqual([
      `https://api.github.com/repos/${REPO}/issues/640/events?per_page=100&page=1`,
      `https://api.github.com/repos/${REPO}/issues/640/events?per_page=100&page=2`,
    ]);
  });

  it("posts a comment on the PR", async () => {
    const { calls, github } = answering([], 201);
    await github.postComment(640, "hello");
    expect(calls[0]?.url).toBe(`https://api.github.com/repos/${REPO}/issues/640/comments`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ body: "hello" });
  });

  it("fails on an error answer", async () => {
    const { github } = answering([], 403);
    await expect(github.comments(640)).rejects.toThrow("GitHub GET repos/Rabaed/rabaedV2.0/issues/640/comments?per_page=100&page=1 answered 403");
  });
});
