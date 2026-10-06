import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AllowListed, type Kind, latestKinds, leakChannelProblems, repoMigrations } from "./check-leak-channels.ts";

// Kinds that are not channels of their own, with the leak-channel row (its
// Channel cell, exactly) that covers them. A notification kind is what
// happened, shown in the bell and sent by email: the one channel
// "Notifications and emails".
const allowList: readonly AllowListed[] = [
  { table: "notification", kind: "step_reached", row: "Notifications and emails" },
  { table: "notification", kind: "watched_event", row: "Notifications and emails" },
  { table: "notification", kind: "sent_back", row: "Notifications and emails" },
  { table: "notification", kind: "vacancy", row: "Notifications and emails" },
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

describe("the repository", () => {
  it("has a leak-channel row in docs/visibility.md for every notification and outbox kind", () => {
    const kinds = latestKinds(repoMigrations(process.cwd()));
    expect(kinds.filter((k) => k.table === "outbox").map((k) => k.kind)).toContain("digest");
    expect(kinds.filter((k) => k.table === "notification").map((k) => k.kind)).toContain("step_reached");
    expect(leakChannelProblems(readFileSync("docs/visibility.md", "utf8"), kinds, allowList)).toEqual([]);
  });
});
