import { describe, expect, it } from "vitest";
import { laneOf, newMigration, nextDay, type NewMigrationSeam } from "./migration-new.ts";

const table = `# Migration days

| Day | Issue or spec | Lane | Purpose |
| --- | --- | --- | --- |
`;

// A fake seam: main's and the branches' migrations, the reservations file; it records what is written.
function fakeSeam(overrides: Partial<NewMigrationSeam> = {}) {
  const written = new Map<string, string>();
  const seam: NewMigrationSeam = {
    fetch: () => true,
    remoteMigrations: () => ["20270326000000_sent_back_built_ins.sql", "20270327000000_after_send_back_review_fixes.sql"],
    localMigrations: () => ["20270327000000_after_send_back_review_fixes.sql"],
    reservations: () => [table, table],
    lane: () => "5",
    today: () => "20261015",
    write: (path, text) => {
      written.set(path, text);
    },
    ...overrides,
  };
  return { seam, written };
}

describe("nextDay", () => {
  it("is the calendar day after, across month and year ends", () => {
    expect(nextDay("20270327")).toBe("20270328");
    expect(nextDay("20270228")).toBe("20270301");
    expect(nextDay("20281231")).toBe("20290101");
  });
});

describe("laneOf", () => {
  it("reads the lane from the .env's compose project, else blank", () => {
    expect(laneOf("A=1\nCOMPOSE_PROJECT_NAME=rabaed-lane5\n")).toBe("5");
    expect(laneOf('COMPOSE_PROJECT_NAME="rabaed-lane2"')).toBe("2");
    expect(laneOf("COMPOSE_PROJECT_NAME=rabaed\n")).toBe("");
    expect(laneOf("")).toBe("");
  });
});

describe("migration:new", () => {
  it("takes the day after main's latest migration, writes the header and the reservation row", () => {
    const { seam, written } = fakeSeam();
    const result = newMigration(["card_layout", "--issue", "RP-583"], seam);
    expect(result.ok).toBe(true);
    expect([...written.keys()]).toEqual(["packages/db/migrations/20270328000000_card_layout.sql", "planning/migration-days.md"]);
    expect(written.get("packages/db/migrations/20270328000000_card_layout.sql")).toBe("-- RP-583: card layout.\n");
    expect(written.get("planning/migration-days.md")).toBe(`${table}| 20270328 | RP-583 | 5 | card_layout |\n`);
    expect(result.lines.join("\n")).toContain("packages/db/migrations/20270328000000_card_layout.sql");
    expect(result.lines.join("\n")).toContain("20270328");
  });

  it("goes past a later migration on another remote branch (a queue branch too)", () => {
    const { seam, written } = fakeSeam({ remoteMigrations: () => ["20270327000000_a.sql", "20270402000000_queued.sql"] });
    newMigration(["b", "--issue", "RP-583"], seam);
    expect(written.has("packages/db/migrations/20270403000000_b.sql")).toBe(true);
  });

  it("goes past a later reserved day, on main's file or the branch's", () => {
    const later = `${table}| 20270410 | spec RP-590 | 2 | first ticket |\n`;
    const { seam, written } = fakeSeam({ reservations: () => [table, later] });
    newMigration(["b", "--issue", "RP-583"], seam);
    expect(written.has("packages/db/migrations/20270411000000_b.sql")).toBe(true);
    expect(written.get("planning/migration-days.md")).toBe(`${later}| 20270411 | RP-583 | 5 | b |\n`);
  });

  it("goes past a migration this worktree already created", () => {
    const { seam, written } = fakeSeam({ localMigrations: () => ["20270328000000_first.sql"] });
    newMigration(["second", "--issue", "RP-583"], seam);
    expect(written.has("packages/db/migrations/20270329000000_second.sql")).toBe(true);
  });

  it("leaves the lane blank without one", () => {
    const { seam, written } = fakeSeam({ lane: () => "" });
    newMigration(["b", "--issue", "RP-583"], seam);
    expect(written.get("planning/migration-days.md")).toBe(`${table}| 20270328 | RP-583 |  | b |\n`);
  });

  it("puts the row after the table's last row, before any text after the table", () => {
    const { seam, written } = fakeSeam({ reservations: () => [table, `${table}\nA note.\n`] });
    newMigration(["b", "--issue", "RP-583"], seam);
    expect(written.get("planning/migration-days.md")).toBe(`${table}| 20270328 | RP-583 | 5 | b |\n\nA note.\n`);
  });

  it("takes today in a repository with no migrations or reservations", () => {
    const { seam, written } = fakeSeam({ remoteMigrations: () => [], localMigrations: () => [], reservations: () => ["", ""] });
    newMigration(["first", "--issue", "RP-583"], seam);
    expect(written.has("packages/db/migrations/20261015000000_first.sql")).toBe(true);
    expect(written.get("planning/migration-days.md")).toBe("| 20261015 | RP-583 | 5 | first |\n");
  });

  it("refuses a name that isn't snake_case, writing nothing", () => {
    for (const name of ["CardLayout", "card-layout", "card layout", "_card", "card_", "1card"]) {
      const { seam, written } = fakeSeam();
      const result = newMigration([name, "--issue", "RP-583"], seam);
      expect(result.ok).toBe(false);
      expect(result.lines.join("\n")).toContain("snake_case");
      expect(written.size).toBe(0);
    }
  });

  it("refuses a missing or malformed issue, with the usage", () => {
    for (const args of [["card"], ["card", "--issue"], ["card", "--issue", "583"], ["--issue", "RP-583"]]) {
      const { seam, written } = fakeSeam();
      const result = newMigration(args, seam);
      expect(result.ok).toBe(false);
      expect(result.lines.join("\n")).toContain("Usage: pnpm migration:new <name> --issue RP-nnn");
      expect(written.size).toBe(0);
    }
  });

  it("stops when git fetch fails: the free day needs today's branches", () => {
    const { seam, written } = fakeSeam({ fetch: () => false });
    const result = newMigration(["card", "--issue", "RP-583"], seam);
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("git fetch origin");
    expect(written.size).toBe(0);
  });
});
