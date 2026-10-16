// Five Mains write ADRs and glossary entries at once (planning/parallel-sessions.md,
// "How a Main works"). Two Mains can each add ADR 0023 under different file names, or
// define the same term in two places, and git merges both without a conflict (RP-613).

/** The ADR numbers used by more than one file in docs/adr, with their files. */
export function duplicateAdrNumbers(files: readonly string[]): string[] {
  const byNumber = new Map<string, string[]>();
  for (const file of files) {
    const number = /^(\d{4})-/.exec(file)?.[1];
    if (number === undefined) continue;
    byNumber.set(number, [...(byNumber.get(number) ?? []), file]);
  }
  return [...byNumber].filter(([, named]) => named.length > 1).map(([number, named]) => `ADR ${number}: ${named.join(", ")}`);
}

/** The terms GLOSSARY.md defines (`**Term**:` lines) more than once, ignoring case, with their line numbers. */
export function duplicateGlossaryTerms(glossary: string): string[] {
  const byTerm = new Map<string, { term: string; lines: number[] }>();
  glossary.split(/\r?\n/).forEach((line, i) => {
    const term = /^\*\*(.+)\*\*:\s*$/.exec(line)?.[1];
    if (term === undefined) return;
    const key = term.trim().toLowerCase();
    const seen = byTerm.get(key) ?? { term, lines: [] };
    seen.lines.push(i + 1);
    byTerm.set(key, seen);
  });
  return [...byTerm.values()].filter((t) => t.lines.length > 1).map((t) => `${t.term}: lines ${t.lines.join(", ")}`);
}
