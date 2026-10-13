import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `node scripts/resolve-visibility.ts` (RP-562), run in the middle of a merge that conflicted in
// docs/visibility.md. Git merges by line, so two branches that each add a row at the end of a
// table, or each add a sentence to the same long row, conflict (five of the last 40 merges). This
// merges what is certain and leaves git's markers, for those rows only, where it is not:
//   - rows (a table row, keyed by its first cell; a "- **Vn." bullet, keyed by Vn) that only one
//     side added or changed are taken; rows both sides added or changed are kept, once each;
//   - a row both sides changed is merged word by word when the changes do not touch the same
//     words; the same words changed two ways, or a row one side deleted and the other changed,
//     stop it and the row is named. A rule is never silently rewritten.
// The text of docs/visibility.md is unchanged by this: it only decides how the merge is made.

const file = "docs/visibility.md";

export type Merged = { text: string; stuck: string[] };

type MergeFile = { text: string; clean: boolean };

/** `git merge-file -p` of three texts (works outside a repository); `clean` is false when it left conflict markers. */
function gitMergeFile(ours: string, base: string, theirs: string, labels: [string, string, string]): MergeFile {
  const dir = mkdtempSync(join(tmpdir(), "rabaed-merge-file-"));
  try {
    const paths = [ours, base, theirs].map((text, i) => {
      const path = join(dir, String(i));
      writeFileSync(path, text);
      return path;
    });
    const result = spawnSync("git", ["merge-file", "-p", "--diff3", "-L", labels[0], "-L", labels[1], "-L", labels[2], ...paths], { encoding: "utf8" });
    if (result.status === null || result.status < 0 || result.status > 127) throw new Error(`git merge-file failed: ${result.stderr}`);
    return { text: result.stdout, clean: result.status === 0 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The words of a row, one per line, so git merges inside the row. */
const words = (row: string) => `${row.split(" ").join("\n")}\n`;

/** One row merged word by word; null when the two sides changed the same words. */
function mergeRow(base: string, ours: string, theirs: string): string | null {
  const merged = gitMergeFile(words(ours), words(base), words(theirs), ["ours", "base", "theirs"]);
  return merged.clean ? merged.text.replace(/\n$/, "").split("\n").join(" ") : null;
}

/** What names a row across versions: a table row's first cell, a rule bullet's V number, else the whole line. */
export function rowKey(line: string): string {
  const cell = /^\|\s*(.*?)\s*\|/.exec(line);
  if (cell) return cell[1]!;
  const rule = /^- \*\*(V\d+)\b/.exec(line);
  return rule ? rule[1]! : line;
}

type Hunk = { base: string[]; ours: string[]; theirs: string[] };

/** A hunk of rows resolved, or the key of the row it cannot decide. */
function resolveHunk({ base, ours, theirs }: Hunk): { lines: string[] } | { stuck: string } {
  const maps = [base, ours, theirs].map((lines) => {
    const map = new Map<string, string>();
    for (const line of lines) {
      const key = rowKey(line);
      if (map.has(key)) return key;
      map.set(key, line);
    }
    return map;
  });
  const duplicate = maps.find((m): m is string => typeof m === "string");
  if (duplicate !== undefined) return { stuck: duplicate };
  const [b, o, t] = maps as Map<string, string>[];

  // Order: ours as it is; each row only theirs has goes after the row before it in theirs.
  const order = [...o!.keys()];
  const theirKeys = [...t!.keys()];
  theirKeys.forEach((key, i) => {
    if (order.includes(key)) return;
    const previous = theirKeys[i - 1];
    const at = previous === undefined ? -1 : order.indexOf(previous);
    if (at >= 0) order.splice(at + 1, 0, key);
    else if (base.length === 0) order.push(key);
    else order.unshift(key);
  });
  // A row that only theirs kept and ours deleted still has its place via the base order.
  for (const key of b!.keys()) if (!order.includes(key) && t!.has(key)) order.push(key);

  const lines: string[] = [];
  for (const key of order) {
    const [kb, ko, kt] = [b!.get(key), o!.get(key), t!.get(key)];
    let line: string | undefined;
    if (ko === kt) line = ko;
    else if (ko === kb) line = kt;
    else if (kt === kb) line = ko;
    else if (kb === undefined || ko === undefined || kt === undefined) return { stuck: key };
    else {
      const merged = mergeRow(kb, ko, kt);
      if (merged === null) return { stuck: key };
      line = merged;
    }
    if (line !== undefined) lines.push(line);
  }
  return { lines };
}

/** The three versions of docs/visibility.md merged: `stuck` names the rows left between conflict markers in `text`. */
export function mergeVisibility(base: string, ours: string, theirs: string): Merged {
  const first = gitMergeFile(ours, base, theirs, ["ours", "base", "theirs"]);
  if (first.clean) return { text: first.text, stuck: [] };

  const out: string[] = [];
  const stuck: string[] = [];
  const lines = first.text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.startsWith("<<<<<<< ")) {
      out.push(lines[i]!);
      continue;
    }
    const start = i;
    const hunk: Hunk = { ours: [], base: [], theirs: [] };
    let side: keyof Hunk = "ours";
    for (i++; !lines[i]!.startsWith(">>>>>>> "); i++) {
      if (lines[i]!.startsWith("||||||| ")) side = "base";
      else if (lines[i] === "=======") side = "theirs";
      else hunk[side].push(lines[i]!);
    }
    const resolved = resolveHunk(hunk);
    if ("lines" in resolved) out.push(...resolved.lines);
    else {
      stuck.push(resolved.stuck);
      out.push(...lines.slice(start, i + 1));
    }
  }
  return { text: out.join("\n"), stuck };
}

const show = (stage: number) => {
  const result = spawnSync("git", ["show", `:${stage}:${file}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return result.status === 0 ? result.stdout : null;
};

/** Run during a merge: merges docs/visibility.md from the index's three stages into the working tree. */
function main() {
  const [base, ours, theirs] = [show(1), show(2), show(3)];
  if (ours === null || theirs === null) {
    console.error(`${file} is not in conflict. Run this in the middle of a merge (git merge, or git merge-tree's replay) that stopped on it.`);
    process.exit(2);
  }
  const { text, stuck } = mergeVisibility(base ?? "", ours, theirs);
  writeFileSync(file, text);
  if (stuck.length > 0) {
    console.error(`${file}: merged what both sides left apart; still in conflict, between <<<<<<< and >>>>>>>: ${stuck.map((k) => `'${k}'`).join(", ")}. Resolve those by hand, then git add ${file}.`);
    process.exit(1);
  }
  console.log(`${file}: merged both sides. Read the diff, then git add ${file} and finish the merge.`);
}

if (import.meta.main) main();
