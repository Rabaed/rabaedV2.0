import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AllowListed, type Kind, latestKinds, leakChannelProblems, prTemplateProblems, repoMigrations } from "./check-leak-channels.ts";

// Kinds that are not channels of their own, with the leak-channel row (its
// Channel cell, exactly) that covers them. A notification kind is what
// happened, shown in the bell and sent by email: the one channel
// "Notifications and emails". The outbox's `notification` and `email` kinds
// deliver that same channel, so they are listed here with it rather than
// passing because their names happen to appear in the row's words.
const allowList: readonly AllowListed[] = [
  { table: "outbox", kind: "notification", row: "Notifications and emails" },
  { table: "outbox", kind: "email", row: "Notifications and emails" },
  { table: "notification", kind: "step_reached", row: "Notifications and emails" },
  { table: "notification", kind: "watched_event", row: "Notifications and emails" },
  { table: "notification", kind: "sent_back", row: "Notifications and emails" },
  { table: "notification", kind: "package_submitted", row: "Notifications and emails" },
  // RP-155: "record ready" (the bell only) is delivered like any notification; a Re-produce is a job of the record itself.
  { table: "outbox", kind: "record_ready", row: "Notifications and emails" },
  { table: "notification", kind: "record_ready", row: "Notifications and emails" },
  { table: "outbox", kind: "documental_record_reproduce", row: "Documental Record" },
  // RP-621: the worker prints a Working Copy a Member asked for; it goes only to who asks, through the api.
  { table: "outbox", kind: "working_copy", row: "Working Copy" },
];

function visibility(channels: string[]): string {
  return [
    "# Visibility",
    "",
    "| Layer | Question |",
    "|---|---|",
    "| Digest | Not the leak-channel table |",
    "",
    "## Leak channels",
    "",
    "| Channel | Rule |",
    "|---|---|",
    ...channels.map((channel) => `| ${channel} | Sent only to Members with access. |`),
    "",
    "## Scenario matrix",
    "",
    "| # | Scenario |",
    "|---|---|",
    "| 1 | A step age report reaches C1 |",
  ].join("\n");
}

const migration = "packages/db/migrations/9_digest.sql";
const outbox = (...kinds: string[]): Kind[] => kinds.map((kind) => ({ table: "outbox", kind, file: migration }));
const notification = (...kinds: string[]): Kind[] => kinds.map((kind) => ({ table: "notification", kind, file: migration }));

describe("latestKinds", () => {
  it("reads the kinds of the newest migration that defines each constraint, inline or added", () => {
    const migrations = [
      {
        file: "packages/db/migrations/1_outbox.sql",
        text: [
          "create table outbox (",
          "  id uuid primary key,",
          "  kind text not null check (kind in ('notification')),",
          "  payload jsonb not null check (jsonb_typeof(payload) = 'object')",
          ");",
          "create table notification (",
          "  kind text not null check (kind in ('step_reached')),",
          "  outbox_id uuid not null",
          ");",
        ].join("\n"),
      },
      {
        file: "packages/db/migrations/2_more.sql",
        text: [
          "alter table notification drop constraint notification_kind_check;",
          "alter table notification add constraint notification_kind_check",
          "  check (kind in ('step_reached', 'sent_back'));",
        ].join("\n"),
      },
    ];
    expect(latestKinds(migrations)).toEqual([
      { table: "outbox", kind: "notification", file: "packages/db/migrations/1_outbox.sql" },
      { table: "notification", kind: "step_reached", file: "packages/db/migrations/2_more.sql" },
      { table: "notification", kind: "sent_back", file: "packages/db/migrations/2_more.sql" },
    ]);
  });
});

describe("leakChannelProblems", () => {
  it("finds nothing wrong when every kind names a channel row, in words, singular or plural", () => {
    const markdown = visibility(["Notifications and emails", "Daily email digest", "Step Age reports"]);
    expect(leakChannelProblems(markdown, outbox("notification", "email", "digest", "step_age_report"), [])).toEqual([]);
  });

  it("names a kind with no channel row, the migration that allows it and the file to edit", () => {
    const markdown = visibility(["Notifications and emails", "Step Age reports"]);
    expect(leakChannelProblems(markdown, outbox("notification", "digest"), [])).toEqual([
      `outbox kind 'digest' (allowed by ${migration}) has no row in the leak-channel table of docs/visibility.md: add one there, or, if it is not a channel of its own, allow-list it with its row in scripts/check-leak-channels.test.ts`,
    ]);
  });

  it("does not take a word inside a longer one, nor a row outside the leak-channel table", () => {
    const markdown = visibility(["Undigested lists"]);
    expect(leakChannelProblems(markdown, outbox("digest"), [])).toHaveLength(1);
  });

  it("accepts an allow-listed kind whose row is in the table, and names one whose row is not", () => {
    const allowList = [
      { table: "notification", kind: "sent_back", row: "Notifications and emails" },
      { table: "notification", kind: "vacancy", row: "Vacancy notices" },
    ] as const;
    expect(leakChannelProblems(visibility(["Notifications and emails"]), notification("sent_back", "vacancy"), allowList)).toEqual([
      `notification kind 'vacancy' is allow-listed in scripts/check-leak-channels.test.ts under the row "Vacancy notices", which is not in the leak-channel table of docs/visibility.md: fix the allow-list or the row`,
    ]);
  });

  it("names an allow-list entry for a kind no migration allows any more", () => {
    const allowList = [{ table: "notification", kind: "gone", row: "Notifications and emails" }] as const;
    expect(leakChannelProblems(visibility(["Notifications and emails"]), [], allowList)).toEqual([
      `notification kind 'gone' is allow-listed in scripts/check-leak-channels.test.ts but packages/db/migrations no longer allows it: remove it from the allow-list`,
    ]);
  });
});

function template(channels: string[]): string {
  return [
    "## What changed",
    "",
    "- [ ] Not a checkbox of the channel list",
    "",
    "## Leak channels",
    "",
    ...channels.map((channel) => `- [ ] ${channel}`),
    "",
    "## Scenarios",
    "",
    "- [ ] Added or updated",
  ].join("\n");
}

describe("prTemplateProblems", () => {
  it("finds nothing wrong when the template lists every channel row in order, ticked or not", () => {
    const markdown = visibility(["Search and filters", "Daily email digest"]);
    expect(prTemplateProblems(markdown, template(["Search and filters", "Daily email digest"]))).toEqual([]);
    const ticked = template(["Search and filters", "Daily email digest"]).replace("- [ ] Daily", "- [x] Daily");
    expect(prTemplateProblems(markdown, ticked)).toEqual([]);
  });

  it("names a channel row the template is missing, with the line to add", () => {
    expect(prTemplateProblems(visibility(["Search and filters", "Daily email digest"]), template(["Search and filters"]))).toEqual([
      `leak channel 'Daily email digest' (docs/visibility.md) is missing from .github/pull_request_template.md: add the line "- [ ] Daily email digest" to its Leak channels list`,
    ]);
  });

  it("names a channel listed twice, and a list out of the table's order", () => {
    const markdown = visibility(["Links", "Linked from"]);
    expect(prTemplateProblems(markdown, template(["Links", "Linked from", "Links"]))).toEqual([
      "'Links' is listed more than once in .github/pull_request_template.md's Leak channels list: keep one",
    ]);
    expect(prTemplateProblems(markdown, template(["Linked from", "Links"]))).toEqual([
      ".github/pull_request_template.md's Leak channels list is not in docs/visibility.md's table order: Links, Linked from",
    ]);
  });

  it("names a channel the template lists that the table no longer has", () => {
    expect(prTemplateProblems(visibility(["Search and filters"]), template(["Search and filters", "Pins"]))).toEqual([
      "'Pins' in .github/pull_request_template.md's Leak channels list is not a row of docs/visibility.md's leak-channel table: rename or remove it",
    ]);
  });

  it("reads only the Leak channels section's checkboxes", () => {
    expect(prTemplateProblems(visibility(["Links"]), "## Leak channels\n\n- [ ] Links\n\n## Scenarios\n\n- [ ] Pins\n")).toEqual([]);
    expect(prTemplateProblems(visibility(["Links"]), "## Summary\n\n- [ ] Links\n")).toEqual([
      `leak channel 'Links' (docs/visibility.md) is missing from .github/pull_request_template.md: add the line "- [ ] Links" to its Leak channels list`,
    ]);
  });
});

describe("the repository", () => {
  it("has a PR template whose Leak channels list is docs/visibility.md's leak-channel table (RP-112)", () => {
    expect(prTemplateProblems(readFileSync("docs/visibility.md", "utf8"), readFileSync(".github/pull_request_template.md", "utf8"))).toEqual([]);
  });

  it("has a leak-channel row in docs/visibility.md for every notification and outbox kind", () => {
    const kinds = latestKinds(repoMigrations(process.cwd()));
    expect(kinds.filter((k) => k.table === "outbox").map((k) => k.kind)).toContain("digest");
    expect(kinds.filter((k) => k.table === "notification").map((k) => k.kind)).toContain("step_reached");
    expect(leakChannelProblems(readFileSync("docs/visibility.md", "utf8"), kinds, allowList)).toEqual([]);
  });
});
