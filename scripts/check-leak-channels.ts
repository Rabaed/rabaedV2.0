import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { migrationsDir } from "./migrations.ts";

// Every notification and outbox kind is a way news of a Work Item leaves the
// database, so each must have a row in the leak-channel table of
// docs/visibility.md (CODING_STANDARDS.md: "A new channel adds a row to the
// leak-channel table"). The daily digest (RP-358) shipped without one and only
// the epic review caught it (RP-375).
//
// Checked by scripts/check-leak-channels.test.ts, in the unit project. A kind
// that is not a channel of its own is allow-listed there, with its row.

const visibilityFile = "docs/visibility.md";

/** The tables whose `kind` check constraint lists channels. */
export const channelTables = ["notification", "outbox"] as const;
export type ChannelTable = (typeof channelTables)[number];

export type Migration = { file: string; text: string };
export type Kind = { table: ChannelTable; kind: string; file: string };

const isChannelTable = (table: string): table is ChannelTable => (channelTables as readonly string[]).includes(table);
const kindList = String.raw`check\s*\(\s*kind\s+in\s*\(([^)]*)\)\s*\)`;
const addedCheck = new RegExp(String.raw`alter\s+table\s+(\w+)\s+add\s+constraint\s+\w+_kind_check\s+${kindList}`, "gi");
const createdTable = /create\s+table\s+(?:if\s+not\s+exists\s+)?(\w+)\s*\(([\s\S]*?)\n\);/gi;
const inlineCheck = new RegExp(String.raw`^\s*kind\s+text\b[^\n]*?${kindList}`, "im");

const kindsIn = (list: string) => [...list.matchAll(/'([^']*)'/g)].map((m) => m[1]!);

/** The kinds each channel table allows, as the newest migration (by file name) that defines its `kind` check says. */
export function latestKinds(migrations: Migration[]): Kind[] {
  const latest = new Map<ChannelTable, Kind[]>();
  const sorted = migrations.toSorted((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  for (const { file, text } of sorted) {
    const found: { index: number; table: string; list: string }[] = [];
    for (const m of text.matchAll(createdTable)) {
      const check = m[2]!.match(inlineCheck);
      if (check) found.push({ index: m.index, table: m[1]!, list: check[1]! });
    }
    for (const m of text.matchAll(addedCheck)) found.push({ index: m.index, table: m[1]!, list: m[2]! });
    found.sort((a, b) => a.index - b.index);
    for (const { table, list } of found) {
      if (isChannelTable(table)) latest.set(table, kindsIn(list).map((kind) => ({ table, kind, file })));
    }
  }
  return [...latest.values()].flat();
}

/** A kind that is not a channel of its own, and the leak-channel row (its Channel cell, exactly) that covers it. */
export type AllowListed = { table: ChannelTable; kind: string; row: string };

const testFile = "scripts/check-leak-channels.test.ts";

/** The Channel cell of every row of the "Leak channels" table. */
export function leakChannelRows(markdown: string): string[] {
  const lines = markdown.split("\n");
  const heading = lines.findIndex((line) => line.startsWith("## Leak channels"));
  if (heading < 0) return [];
  const rows: string[] = [];
  let inTable = false;
  for (let i = heading + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("#")) break;
    if (!line.startsWith("|")) {
      if (inTable) break;
      continue;
    }
    if (!inTable) {
      inTable = true;
      i++; // the header row, then this skips the |---| row
      continue;
    }
    rows.push(line.split("|")[1]!.trim());
  }
  return rows;
}

// "step_age_report" names "Step Age reports": its words, in order, each at the start of a word.
const namedBy = (kind: string) => new RegExp(String.raw`\b${kind.split("_").join(String.raw`\s+`)}`, "i");

/** What is wrong between the kinds the migrations allow and the leak-channel table; empty when nothing is. */
export function leakChannelProblems(markdown: string, kinds: Kind[], allowList: readonly AllowListed[]): string[] {
  const rows = leakChannelRows(markdown);
  const problems: string[] = [];
  for (const { table, kind, file } of kinds) {
    const allowed = allowList.find((entry) => entry.table === table && entry.kind === kind);
    if (allowed) {
      if (!rows.includes(allowed.row)) {
        problems.push(
          `${table} kind '${kind}' is allow-listed in ${testFile} under the row "${allowed.row}", which is not in the leak-channel table of ${visibilityFile}: fix the allow-list or the row`,
        );
      }
    } else if (!rows.some((row) => namedBy(kind).test(row))) {
      problems.push(
        `${table} kind '${kind}' (allowed by ${file}) has no row in the leak-channel table of ${visibilityFile}: add one there, or, if it is not a channel of its own, allow-list it with its row in ${testFile}`,
      );
    }
  }
  for (const { table, kind } of allowList) {
    if (!kinds.some((k) => k.table === table && k.kind === kind)) {
      problems.push(`${table} kind '${kind}' is allow-listed in ${testFile} but ${migrationsDir} no longer allows it: remove it from the allow-list`);
    }
  }
  return problems;
}

/** Every migration in the repository. */
export function repoMigrations(repo: string): Migration[] {
  return readdirSync(join(repo, migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .map((name) => ({ file: `${migrationsDir}/${name}`, text: readFileSync(join(repo, migrationsDir, name), "utf8") }));
}
